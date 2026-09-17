import assert from "node:assert/strict";
import crypto from "node:crypto";
import { afterEach, beforeEach, test } from "node:test";
import { once } from "node:events";
import http from "node:http";
import { WebSocket } from "ws";
import { AuthorizedDeviceRegistry } from "../src/authorized-devices.js";
import { deviceIdFromHost } from "../src/config.js";
import { createEspwayServer } from "../src/server.js";
import { attachWebSocketHeartbeat } from "../src/authenticated-tunnel.js";
import {
  AUTH_PROTOCOL,
  computeAuthMac,
  deriveSessionKeys,
  signFrame,
  verifyFrame,
} from "../src/protocol.js";
import { TUNNEL_PROTOCOL_V2 } from "../src/tunnel-metadata.js";

const V2_HOST = "tunnel.devices.example.com";

const config = {
  port: 0,
  domain: "devices.example.com",
  baseDomain: "devices.example.com",
  adminHost: "admin.devices.example.com",
  installerHost: "install.devices.example.com",
  tunnelHost: V2_HOST,
  portalHost: "devices.example.com",
  requestTimeoutMs: 120,
  maxBodyBytes: 4096,
  maxStreamsPerDevice: 8,
  firmwareDir: ".",
  httpFirmwareOrigin: "http://firmware.example.test",
  maxFirmwareBytes: 1048576,
  otaOperatorToken: "test-operator-secret",
  authorizedDevices: new AuthorizedDeviceRegistry({
    devices: {
      "esp-a4f912": { enabled: true },
      "esp-dead00": { enabled: false },
    },
  }),
  tokens: new Map([
    ["esp-a4f912", "secret"],
    ["esp-dead00", "disabled-secret"],
  ]),
};
let app, base, sockets;

beforeEach(async () => {
  app = createEspwayServer(config);
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  base = `http://127.0.0.1:${app.server.address().port}`;
  sockets = [];
});
afterEach(async () => {
  for (const ws of sockets) ws.terminate();
  app.wss.close();
  await new Promise((resolve) => app.server.close(resolve));
});

function connect({
  deviceId = "esp-a4f912",
  token = "secret",
  deviceName = "Authenticated test",
  signedHello = true,
  capabilities = ["aead-selective", "http-ota", "mqtt"],
} = {}) {
  return new Promise((resolve, reject) => {
    const ws = newV2Socket();
    const onMessage = (raw) => {
      const message = JSON.parse(raw);
      if (message.type === "challenge") {
        const deviceNonce = "ab".repeat(32);
        ws.testSession = {
          ...deriveSessionKeys(
            token,
            deviceId,
            message.serverNonce,
            deviceNonce,
          ),
          sendSequence: 1n,
          expectedReceiveSequence: 1n,
        };
        ws.send(
          JSON.stringify({
            type: "auth",
            authProtocol: AUTH_PROTOCOL,
            deviceId,
            deviceNonce,
            authMac: computeAuthMac(
              token,
              deviceId,
              message.serverNonce,
              deviceNonce,
            ),
            deviceName,
            hardware: "simulator",
            application: "led-demo",
            firmwareVersion: "0.1.0",
            frameworkVersion: "0.2.0-experimental",
          }),
        );
      } else if (ws.testSession) {
        const frame = verifyFrame(ws.testSession, "S2C", raw, 8192);
        if (frame?.type === "hello-ack") {
          if (!signedHello) {
            ws.off("message", onMessage);
            resolve(ws);
            return;
          }
          sendFrame(ws, {
            type: "hello",
            tunnelProtocol: TUNNEL_PROTOCOL_V2,
            deviceId,
            deviceName,
            hardware: "simulator",
            application: "led-demo",
            applicationVersion: "0.1.0",
            frameworkVersion: "0.2.0-experimental",
            capabilities,
          });
        } else if (frame?.type === "hello-verified") {
          ws.off("message", onMessage);
          resolve(ws);
        }
      }
    };
    ws.on("message", onMessage);
    ws.on("error", reject);
  });
}

function newV2Socket() {
  const ws = new WebSocket(base.replace("http", "ws") + "/tunnel", {
    headers: { Host: V2_HOST },
  });
  sockets.push(ws);
  return ws;
}

function sendFrame(ws, message) {
  ws.send(signFrame(ws.testSession, "C2S", message), { binary: false });
}

function readFrame(ws, raw) {
  return verifyFrame(ws.testSession, "S2C", raw, 8192);
}
function deviceFetch(path = "/", options = {}) {
  const target = new URL(base);
  const body = options.body ? Buffer.from(options.body) : Buffer.alloc(0);

  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        path,
        method: options.method || "GET",
        headers: {
          Host: "esp-a4f912.devices.example.com",
          ...(options.headers || {}),
          ...(body.length ? { "Content-Length": body.length } : {}),
        },
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          resolve({
            status: response.statusCode,
            headers: response.headers,
            text: async () => Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );

    request.on("error", reject);
    if (body.length) request.write(body);
    request.end();
  });
}

function tlsAsk(domain) {
  return fetch(
    `${base}/internal/tls-ask?domain=${encodeURIComponent(domain)}`,
  );
}

async function waitUntil(predicate, timeoutMs = 500) {
  const deadline = Date.now() + timeoutMs;

  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error("condition was not met before timeout");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
function responder(ws, delay = 0) {
  ws.on("message", (raw) => {
    const m = readFrame(ws, raw);
    if (!m) return;
    if (m.type === "close")
      setTimeout(() => {
        sendFrame(ws, {
          type: "open",
          streamId: m.streamId,
          status: 200,
          headers: { "content-type": "text/plain" },
        });
        sendFrame(ws, {
          type: "data",
          streamId: m.streamId,
          data: Buffer.from(m.streamId).toString("base64"),
        });
        sendFrame(ws, { type: "close", streamId: m.streamId });
      }, delay);
  });
}

test("parses device hosts and rejects invalid IDs", () => {
  assert.equal(
    deviceIdFromHost("esp-a4f912.devices.example.com:18080", config.baseDomain),
    "esp-a4f912",
  );
  assert.equal(
    deviceIdFromHost("esp-a4f912.localhost", config.baseDomain),
    "esp-a4f912",
  );
  assert.equal(
    deviceIdFromHost("evil!.devices.example.com", config.baseDomain),
    null,
  );
});

test("TLS ask allows an enabled authorized device", async () => {
  const response = await tlsAsk("esp-a4f912.devices.example.com");
  assert.equal(response.status, 200);
});

test("TLS ask allows only the configured admin infrastructure hostname", async () => {
  assert.equal((await tlsAsk("admin.devices.example.com")).status, 200);
  assert.equal((await tlsAsk("admin.devices.example.com.evil.test")).status, 403);
  assert.equal((await tlsAsk("admin.legacy.example.test")).status, 403);
});

test(
  "TLS ask allows only the public installer infrastructure hostname",
  async () => {
    const allowed = await tlsAsk("install.devices.example.com");
    assert.equal(allowed.status, 200);

    const denied = [
      "installer.legacy.example.test",
      "install.other.example.com",
      "install.legacy.example.test.evil.test",
      "other.legacy.example.test",
    ];
    for (const domain of denied) {
      const response = await tlsAsk(domain);
      assert.equal(response.status, 403, domain);
    }
  },
);

test("TLS ask allows the configured portal but not the HTTP-only tunnel", async () => {
  assert.equal((await tlsAsk("devices.example.com")).status, 200);
  assert.equal((await tlsAsk("tunnel.devices.example.com")).status, 403);
  assert.equal((await tlsAsk("portal.legacy.example.test")).status, 403);
  assert.equal((await tlsAsk("devices.example.com.evil.test")).status, 403);
});

test("TLS ask rejects unknown and disabled devices", async () => {
  const unknown = await tlsAsk("esp-abcdef.devices.example.com");
  const disabled = await tlsAsk("esp-dead00.devices.example.com");

  assert.equal(unknown.status, 403);
  assert.equal(disabled.status, 403);
});

test("TLS ask rejects domains outside the exact device namespace", async () => {
  const cases = [
    "esp-a4f912.example.com",
    "esp-a4f912.devices.example.com.evil.test",
    "esp-a4f912.sub.devices.example.com",
    "esp-invalid.devices.example.com",
    "portal.devices.example.com",
    "",
  ];

  for (const domain of cases) {
    const response = await tlsAsk(domain);
    assert.equal(response.status, 403, domain || "empty hostname");
  }
});
test("rejects unknown device token", async () => {
  const ws = newV2Socket();
  ws.on("message", (raw) => {
    const challenge = JSON.parse(raw);
    const deviceNonce = "cd".repeat(32);
    ws.send(
      JSON.stringify({
        type: "auth",
        authProtocol: AUTH_PROTOCOL,
        deviceId: "esp-a4f912",
        deviceNonce,
        authMac: computeAuthMac(
          "wrong",
          "esp-a4f912",
          challenge.serverNonce,
          deviceNonce,
        ),
      }),
    );
  });
  const [code] = await once(ws, "close");
  assert.equal(code, 4003);
  assert.equal(app.registry.get("esp-a4f912"), undefined);
});

test("authenticates a device without transmitting its token", async () => {
  const ws = await connect();
  assert.equal(app.registry.get("esp-a4f912").connected, true);
  assert.equal(app.registry.get("esp-a4f912").deviceName, "Authenticated test");
  ws.close();
});

test("rejects an authenticated but disabled device", async () => {
  const ws = newV2Socket();
  ws.on("message", (raw) => {
    const challenge = JSON.parse(raw);
    const deviceNonce = "12".repeat(32);
    ws.send(
      JSON.stringify({
        type: "auth",
        authProtocol: AUTH_PROTOCOL,
        deviceId: "esp-dead00",
        deviceNonce,
        authMac: computeAuthMac(
          "disabled-secret",
          "esp-dead00",
          challenge.serverNonce,
          deviceNonce,
        ),
      }),
    );
  });
  const [code] = await once(ws, "close");
  assert.equal(code, 4003);
});

test("rejects a frame sent before authentication", async () => {
  const ws = newV2Socket();
  ws.on("open", () => ws.send(JSON.stringify({ type: "close" })));
  const [code] = await once(ws, "close");
  assert.equal(code, 4003);
});

test("rejects an invalid device ID", async () => {
  const ws = newV2Socket();

  ws.on("message", () => {
    ws.send(
      JSON.stringify({
        type: "auth",
        authProtocol: AUTH_PROTOCOL,
        deviceId: "../../invalid",
        deviceNonce: "ef".repeat(32),
        authMac: "00".repeat(32),
      }),
    );
  });

  const [code] = await once(ws, "close");
  assert.equal(code, 4003);
  assert.equal(app.registry.list().length, 0);
});
test("device becomes online and offline", async () => {
  const ws = await connect();
  assert.equal(app.registry.get("esp-a4f912").connected, true);

  ws.close();
  await waitUntil(() => app.registry.get("esp-a4f912").connected === false);

  assert.equal(app.registry.get("esp-a4f912").connected, false);
});
test("offline device returns 503", async () => {
  const response = await deviceFetch();
  assert.equal(response.status, 503);
  assert.match(await response.text(), /currently offline/);
});
test("stale tunnel heartbeat marks the device offline before HTTP or OTA waits", async () => {
  await connect();
  const serverSocket = [...app.wss.clients][0];
  const previousLastSeen = app.registry.get("esp-a4f912").lastSeen;
  serverSocket.removeAllListeners("pong");
  serverSocket.espwayAwaitingPong = true;
  serverSocket.espwayPingSentAt = 0;
  attachWebSocketHeartbeat(app.wss, { intervalMs: 10, timeoutMs: 35 });

  await waitUntil(
    () => app.registry.get("esp-a4f912")?.connected === false,
    250,
  );

  const offline = app.registry.get("esp-a4f912");
  assert.equal(offline.online, false);
  assert.ok(offline.lastDisconnectAt);
  assert.ok(offline.lastSeen >= previousLastSeen);
  assert.equal((await deviceFetch()).status, 503);
  assert.equal(
    (await app.deviceManager.ota("esp-a4f912", {
      applicationVersion: "0.1.0",
    })).error,
    "device_offline",
  );
});
test("rejects a malformed OTA command before tunnelling", async () => {
  const ws = await connect();
  const response = await deviceFetch("/api/ota/remote", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-ESPway-Operator-Token": config.otaOperatorToken,
    },
    body: "{",
  });
  assert.equal(response.status, 400);
  assert.deepEqual(JSON.parse(await response.text()), {
    error: "invalid_json",
  });
  assert.equal(app.broker.pending.size, 0);
  assert.equal(ws.readyState, WebSocket.OPEN);
});
test("rejects OTA without operator credentials", async () => {
  const ws = await connect();
  const response = await deviceFetch("/api/ota/remote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(response.status, 403);
  assert.deepEqual(JSON.parse(await response.text()), {
    error: "ota_operator_unauthorized",
  });
  assert.equal(app.broker.pending.size, 0);
  assert.equal(ws.readyState, WebSocket.OPEN);
});
test("rejects OTA with invalid operator credentials", async () => {
  const ws = await connect();
  const response = await deviceFetch("/api/ota/remote", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-ESPway-Operator-Token": "invalid-test-token",
    },
    body: "{}",
  });
  assert.equal(response.status, 403);
  assert.equal(app.broker.pending.size, 0);
  assert.equal(ws.readyState, WebSocket.OPEN);
});
test("disables operator OTA when its credential is not configured", async () => {
  const ws = await connect();
  const previousToken = config.otaOperatorToken;
  config.otaOperatorToken = "";
  try {
    const response = await deviceFetch("/api/ota/remote", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-ESPway-Operator-Token": previousToken,
      },
      body: "{}",
    });
    assert.equal(response.status, 503);
    assert.deepEqual(JSON.parse(await response.text()), {
      error: "ota_operator_authorization_disabled",
    });
    assert.equal(app.broker.pending.size, 0);
    assert.equal(ws.readyState, WebSocket.OPEN);
  } finally {
    config.otaOperatorToken = previousToken;
  }
});
test("prepares and tunnels controlled OTA metadata", async () => {
  const firmware = Buffer.from("integration firmware");
  const sha256 = crypto.createHash("sha256").update(firmware).digest("hex");
  const previousResolve = app.firmwareRegistry.resolve;
  app.firmwareRegistry.resolve = async (
    hardware,
    application,
    version,
    options,
  ) => {
    assert.deepEqual(
      { hardware, application, version, options },
      {
        hardware: "esp8266",
        application: "test-app",
        version: "0.2.0-test",
        options: { allowDeprecated: false },
      },
    );
    return {
      id: "esp8266/test-app/0.2.0-test",
      file: "firmware.bin",
      applicationVersion: "0.2.0-test",
      sha256,
      size: firmware.length,
    };
  };
  config.httpFirmwareOrigin = "http://firmware.example.test";
  try {
    const ws = await connect();
    const frames = [];
    ws.on("message", (raw) => {
      const frame = readFrame(ws, raw);
      if (!frame) return;
      frames.push(frame);
      if (frame.type === "close") {
        sendFrame(ws, {
          type: "open",
          streamId: frame.streamId,
          status: 202,
          headers: { "content-type": "application/json" },
        });
        sendFrame(ws, { type: "close", streamId: frame.streamId });
      }
    });
    const response = await deviceFetch("/api/ota/remote", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-ESPway-Operator-Token": config.otaOperatorToken,
      },
      body: JSON.stringify({
        hardware: "esp8266",
        application: "test-app",
        applicationVersion: "0.2.0-test",
      }),
    });
    const responseBody = await response.text();
    assert.equal(response.status, 202, responseBody);
    const body = Buffer.concat(
      frames
        .filter((frame) => frame.type === "data")
        .map((frame) => Buffer.from(frame.data, "base64")),
    );
    assert.deepEqual(JSON.parse(body), {
      url: "http://firmware.example.test/firmware/esp8266/test-app/0.2.0-test/firmware.bin",
      sha256,
      firmwareVersion: "0.2.0-test",
      size: firmware.length,
    });
  } finally {
    app.firmwareRegistry.resolve = previousResolve;
  }
});
test("tunnels and correlates simultaneous requests", async () => {
  const ws = await connect();
  responder(ws, 5);
  const responses = await Promise.all([
    deviceFetch("/one"),
    deviceFetch("/two"),
    deviceFetch("/three"),
  ]);
  assert.deepEqual(
    responses.map((r) => r.status),
    [200, 200, 200],
  );
  const bodies = await Promise.all(responses.map((r) => r.text()));
  assert.equal(new Set(bodies).size, 3);
});
test("times out stalled request and sends cancel", async () => {
  const ws = await connect();
  const messages = [];
  ws.on("message", (raw) => {
    const message = readFrame(ws, raw);
    if (message) messages.push(message);
  });

  const response = await deviceFetch("/slow");
  assert.equal(response.status, 504);
  await waitUntil(() => messages.some((message) => message.type === "cancel"));
});
test("unknown stream is rejected without crashing", async () => {
  const ws = await connect();
  const received = once(ws, "message");
  sendFrame(ws, { type: "close", streamId: "missing" });
  const [raw] = await received;
  assert.equal(readFrame(ws, raw).code, "unknown_stream");
  assert.equal(app.registry.get("esp-a4f912").connected, true);
});
test("abnormal close fails pending request and marks offline", async () => {
  const ws = await connect();
  const pending = deviceFetch("/pending");
  await waitUntil(() => app.broker.pending.size === 1);

  ws.terminate();

  const response = await pending;
  assert.equal(response.status, 503);
  await waitUntil(() => app.registry.get("esp-a4f912").connected === false);
  assert.equal(app.registry.get("esp-a4f912").connected, false);
});

test("closes the session on an invalid frame MAC", async () => {
  const ws = await connect();
  const valid = signFrame(ws.testSession, "C2S", {
    type: "close",
    streamId: "missing",
  });
  const tampered = Buffer.from(
    valid
      .toString()
      .replace(/"mac":"(.)/, (_, digit) => `"mac":"${digit === "0" ? "1" : "0"}`),
  );
  ws.send(tampered, { binary: false });
  const [code] = await once(ws, "close");
  assert.equal(code, 4004);
});

test("closes the session on a replayed frame", async () => {
  const ws = await connect();
  const wire = signFrame(ws.testSession, "C2S", {
    type: "close",
    streamId: "missing",
  });
  ws.send(wire, { binary: false });
  await once(ws, "message");
  ws.send(wire, { binary: false });
  const [code] = await once(ws, "close");
  assert.equal(code, 4004);
});

test("closes the session on a skipped frame sequence", async () => {
  const ws = await connect();
  ws.testSession.sendSequence++;
  sendFrame(ws, { type: "close", streamId: "missing" });
  const [code] = await once(ws, "close");
  assert.equal(code, 4004);
});

test("closes a new session receiving a frame from an old session", async () => {
  const first = await connect();
  const oldWire = signFrame(first.testSession, "C2S", {
    type: "close",
    streamId: "missing",
  });
  first.close();
  await once(first, "close");

  const second = await connect();
  second.send(oldWire, { binary: false });
  const [code] = await once(second, "close");
  assert.equal(code, 4004);
});
