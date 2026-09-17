import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import { afterEach, beforeEach, test } from "node:test";
import { WebSocket } from "ws";
import { AuthorizedDeviceRegistry } from "../src/authorized-devices.js";
import { AUTH_PROTOCOL, computeAuthMac, deriveSessionKeys, signFrame, verifyFrame } from "../src/protocol.js";
import { createEspwayServer } from "../src/server.js";
import { TUNNEL_PROTOCOL_V2 } from "../src/tunnel-metadata.js";

const DEVICE_ID = "esp-a4f912";
const TOKEN = "secret";
const DEVICE_HOST = `${DEVICE_ID}.devices.example.com`;
const TUNNEL_HOST = "tunnel.devices.example.com";
const config = {
  port: 0, baseDomain: "devices.example.com", adminHost: "admin.devices.example.com",
  requestTimeoutMs: 120, maxBodyBytes: 4096, maxStreamsPerDevice: 8,
  firmwareDir: ".", httpFirmwareOrigin: "http://firmware.example.test",
  maxFirmwareBytes: 1048576, otaOperatorToken: "operator-secret",
  authorizedDevices: new AuthorizedDeviceRegistry({ devices: { [DEVICE_ID]: { enabled: true } } }),
  tokens: new Map([[DEVICE_ID, TOKEN]]),
};
let app;
let base;
let sockets;

beforeEach(async () => {
  app = createEspwayServer(config);
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  base = `http://127.0.0.1:${app.server.address().port}`;
  sockets = [];
});
afterEach(async () => {
  for (const socket of sockets) socket.terminate();
  app.wss.close();
  await new Promise((resolve) => app.server.close(resolve));
});

function socketFor(host = TUNNEL_HOST) {
  const socket = new WebSocket(base.replace("http", "ws") + "/tunnel", { headers: { Host: host } });
  sockets.push(socket);
  return socket;
}
function hello(capabilities = ["aead-selective", "http-ota", "mqtt"]) {
  return { type: "hello", tunnelProtocol: TUNNEL_PROTOCOL_V2, deviceId: DEVICE_ID,
    deviceName: "V2 device", hardware: "esp8266", application: "thermostat-demo",
    applicationVersion: "0.2.0", frameworkVersion: "0.2.0", capabilities };
}
function sendSigned(socket, message) {
  socket.send(signFrame(socket.testSession, "C2S", message));
}
function connectV2({ signedHello = true, capabilities } = {}) {
  return new Promise((resolve, reject) => {
    const socket = socketFor();
    const onMessage = (raw) => {
      const message = JSON.parse(raw);
      if (message.type === "challenge") {
        const deviceNonce = "ab".repeat(32);
        socket.testSession = { ...deriveSessionKeys(TOKEN, DEVICE_ID, message.serverNonce, deviceNonce),
          sendSequence: 1n, expectedReceiveSequence: 1n };
        socket.challenge = message;
        socket.send(JSON.stringify({ type: "auth", authProtocol: AUTH_PROTOCOL, deviceId: DEVICE_ID,
          deviceNonce, authMac: computeAuthMac(TOKEN, DEVICE_ID, message.serverNonce, deviceNonce) }));
        return;
      }
      const frame = verifyFrame(socket.testSession, "S2C", raw, 8192);
      if (frame?.type === "hello-ack") {
        socket.helloAck = frame;
        if (!signedHello) { socket.off("message", onMessage); return resolve(socket); }
        sendSigned(socket, hello(capabilities));
      } else if (frame?.type === "hello-verified") {
        socket.off("message", onMessage);
        resolve(socket);
      }
    };
    socket.on("message", onMessage);
    socket.on("error", reject);
  });
}
function deviceRequest(path, options = {}) {
  const target = new URL(base);
  const body = Buffer.from(options.body || "");
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: target.hostname, port: target.port, path,
      method: options.method || "GET", headers: { Host: DEVICE_HOST, ...(options.headers || {}),
        ...(body.length ? { "Content-Length": body.length } : {}) } }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    request.on("error", reject);
    request.end(body);
  });
}

test("challenge exposes only the final protocols", async () => {
  const socket = await connectV2({ signedHello: false });
  assert.equal(socket.challenge.tunnelProtocol, TUNNEL_PROTOCOL_V2);
  assert.equal(socket.challenge.authProtocol, AUTH_PROTOCOL);
  assert.equal(socket.challenge.protocolVersion, undefined);
  assert.equal(socket.helloAck.authProtocol, AUTH_PROTOCOL);
});
test("authentication alone registers no metadata", async () => {
  await connectV2({ signedHello: false });
  assert.equal(app.registry.get(DEVICE_ID), undefined);
});
test("signed hello registers verified metadata", async () => {
  await connectV2();
  const device = app.registry.get(DEVICE_ID);
  assert.equal(device.transport, "ws-hmac");
  assert.equal(device.tunnelProtocol, TUNNEL_PROTOCOL_V2);
  assert.equal(device.metadataVerified, true);
  assert.deepEqual(device.capabilities, ["aead-selective", "http-ota", "mqtt"]);
});
test("unknown optional capabilities are ignored", async () => {
  await connectV2({ capabilities: ["mqtt", "future"] });
  assert.deepEqual(app.registry.get(DEVICE_ID).capabilities, ["mqtt"]);
});
for (const [name, capabilities] of [["duplicate", ["mqtt", "mqtt"]],
  ["excessive", Array.from({ length: 9 }, (_, i) => `cap-${i}`)]]) {
  test(`${name} capabilities reject hello`, async () => {
    const socket = await connectV2({ signedHello: false });
    const closed = once(socket, "close");
    sendSigned(socket, hello(capabilities));
    assert.equal((await closed)[0], 4006);
    assert.equal(app.registry.get(DEVICE_ID), undefined);
  });
}
test("invalid capability structure rejects hello", async () => {
  const socket = await connectV2({ signedHello: false });
  const closed = once(socket, "close");
  sendSigned(socket, { ...hello(), capabilities: "mqtt" });
  assert.equal((await closed)[0], 4006);
});
test("application frame before hello fails closed", async () => {
  const socket = await connectV2({ signedHello: false });
  const closed = once(socket, "close");
  sendSigned(socket, { type: "open", streamId: "early" });
  assert.equal((await closed)[0], 4006);
});
test("bad signed hello MAC closes the session", async () => {
  const socket = await connectV2({ signedHello: false });
  const closed = once(socket, "close");
  const frame = signFrame(socket.testSession, "C2S", hello());
  frame[20] ^= 1;
  socket.send(frame);
  assert.equal((await closed)[0], 4004);
});
test("skipped signed hello sequence closes the session", async () => {
  const socket = await connectV2({ signedHello: false });
  signFrame(socket.testSession, "C2S", { type: "discarded" });
  const closed = once(socket, "close");
  sendSigned(socket, hello());
  assert.equal((await closed)[0], 4004);
});
test("a second verified session replaces the first", async () => {
  const first = await connectV2();
  const closed = once(first, "close");
  const second = await connectV2();
  assert.equal((await closed)[0], 4001);
  assert.equal(second.readyState, WebSocket.OPEN);
});
for (const host of [DEVICE_HOST, "attacker.example.test"]) {
  test(`${host} cannot select the tunnel`, async () => {
    const socket = socketFor(host);
    await new Promise((resolve) => { socket.once("error", resolve); socket.once("close", resolve); });
    assert.equal(app.registry.get(DEVICE_ID), undefined);
  });
}
test("OTA requires signed http-ota capability", async () => {
  await connectV2({ capabilities: ["mqtt"] });
  const response = await deviceRequest("/api/ota/remote", { method: "POST",
    headers: { "X-ESPway-Operator-Token": config.otaOperatorToken }, body: "{}" });
  assert.equal(response.status, 409);
  assert.equal(JSON.parse(response.body).error, "http_ota_not_supported");
});
