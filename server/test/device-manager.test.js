import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";

import { AuthorizedDeviceRegistry } from "../src/authorized-devices.js";
import { DeviceManager } from "../src/device-manager.js";
import { FirmwareRegistry } from "../src/firmware-registry.js";
import { compareSemver } from "../src/semver.js";
import { computeOtaProof } from "../src/ota-authorization.js";
import { createEspwayServer } from "../src/server.js";

const repositoryRoot = new URL("../../", import.meta.url);
const firmwareDir = fileURLToPath(new URL("firmware-repository/", repositoryRoot));
const caddyFile = new URL("caddy/Caddyfile", repositoryRoot);
const adminHost = "admin.devices.example.com";
let app;
let base;
let registryPath;

function request(path, { method = "GET", host = adminHost, body, headers = {} } = {}) {
  const target = new URL(base);
  const payload = body === undefined ? null : Buffer.from(
    typeof body === "string" ? body : JSON.stringify(body),
  );
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: target.hostname,
      port: target.port,
      path,
      method,
      headers: {
        Host: host,
        ...headers,
        ...(payload ? { "content-length": payload.length } : {}),
      },
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve({ status: res.statusCode, raw, json: () => JSON.parse(raw) });
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function post(path, body, headers = {}) {
  return request(path, {
    method: "POST",
    body,
    headers: {
      "content-type": "application/json",
      "x-espway-admin-request": "1",
      ...headers,
    },
  });
}

function adminWrite(method, path, body, headers = {}) {
  return request(path, {
    method,
    body,
    headers: {
      "content-type": "application/json",
      "x-espway-admin-request": "1",
      ...headers,
    },
  });
}

beforeEach(async () => {
  const directory = await mkdtemp(join(tmpdir(), "espway-manager-"));
  registryPath = join(directory, "devices.json");
  await writeFile(registryPath, JSON.stringify({
    version: 1,
    devices: {
      "esp-a4f912": {
        enabled: true,
        deviceName: "<script>alert(1)</script>",
        hardware: "esp8266",
        application: "espway-base",
        applicationVersion: "0.1.0",
        frameworkVersion: "0.2.0",
        lastSeen: "2026-09-08T10:00:00.000Z",
      },
      "esp-dead00": { enabled: false },
    },
  }));
  app = createEspwayServer({
    port: 0,
    baseDomain: "devices.example.com",
    adminHost,
    requestTimeoutMs: 100,
    maxBodyBytes: 4096,
    maxStreamsPerDevice: 8,
    firmwareDir,
    httpFirmwareOrigin: "http://tunnel.devices.example.com",
    maxFirmwareBytes: 1048576,
    otaOperatorToken: "",
    deviceRegistryFile: registryPath,
    tokens: new Map([["esp-a4f912", "legacy-secret"]]),
  });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  base = `http://127.0.0.1:${app.server.address().port}`;
});

afterEach(async () => {
  app.wss.close();
  app.server.closeAllConnections();
  await new Promise((resolve) => app.server.close(resolve));
});

test("admin list merges offline records with Registry firmware state", async () => {
  const response = await request("/api/admin/devices");
  assert.equal(response.status, 200);
  const devices = response.json();
  const device = devices.find((item) => item.deviceId === "esp-a4f912");
  assert.equal(device.online, false);
  assert.equal(device.firmware.state, "update_available");
  assert.equal(device.firmware.latestReleasedVersion, "0.2.3");
  assert.equal(device.deviceUrl, "https://esp-a4f912.devices.example.com/");
  assert.doesNotMatch(response.raw, /legacy-secret|"token"|password/i);
});

test("admin list exposes verified live metadata without socket internals", async () => {
  app.registry.connect({
    deviceId: "esp-a4f912",
    deviceName: "Live device",
    hardware: "esp8266",
    application: "espway-base",
    applicationVersion: "0.1.0",
    frameworkVersion: "0.2.0",
    transport: "ws-hmac",
    tunnelProtocol: "espway-tunnel/2",
    metadataVerified: true,
    capabilities: ["aead-selective", "http-ota"],
  }, { privateSessionKey: "never-public" });
  const response = await request("/api/admin/devices");
  const device = response.json().find((item) => item.deviceId === "esp-a4f912");
  assert.equal(device.online, true);
  assert.equal(device.transport, "ws-hmac");
  assert.equal(device.metadataVerified, true);
  assert.deepEqual(device.capabilities, ["aead-selective", "http-ota"]);
  assert.doesNotMatch(response.raw, /privateSessionKey|never-public|socket/);
});

test("admin detail returns a device and rejects unknown or invalid IDs", async () => {
  assert.equal((await request("/api/admin/devices/esp-a4f912")).status, 200);
  assert.equal((await request("/api/admin/devices/esp-ffffff")).status, 404);
  assert.equal((await request("/api/admin/devices/..%2Fsecret")).status, 404);
});

test("admin UI is host-isolated and uses textContent for untrusted values", async () => {
  assert.equal((await request("/")).status, 200);
  assert.equal((await request("/", { host: "attacker.example" })).status, 404);
  assert.equal((await request("/api/admin/devices", { host: "esp-a4f912.devices.example.com" })).status, 404);
  const script = await request("/admin.js");
  assert.equal(script.status, 200);
  assert.match(script.raw, /textContent/);
  assert.doesNotMatch(script.raw, /innerHTML/);
});

test(
  "admin Cancel is a non-submit button that closes and resets the dialog",
  async () => {
    const page = await request("/");
    const script = await request("/admin.js");
    assert.match(page.raw, /id="dialog-cancel" type="button"/);
    assert.match(
      script.raw,
      /cancelButton\.addEventListener\("click", closeDialog\)/,
    );
    assert.match(
      script.raw,
      /function closeDialog\(\)[\s\S]*dialogForm\.reset\(\)[\s\S]*dialog\.close\(\)/,
    );
  },
);

test("admin registration UX keeps machine credentials behind the curtain", async () => {
  const script = await request("/admin.js");
  assert.match(
    script.raw,
    /const submittedAction = confirmAction;[\s\S]*try[\s\S]*{[\s\S]*await submittedAction\?\.\(\);/,
  );
  assert.match(
    script.raw,
    /dialog\.open && confirmAction === submittedAction/,
  );
  assert.match(script.raw, /Register this device in ProgHard Link/);
  assert.match(script.raw, /You do not need to copy a Device ID or token/);
  assert.doesNotMatch(script.raw, /Paste this token into the Device token field/);
});

test("account and token UX require password and one-time token confirmations", async () => {
  const html = await request("/");
  const script = await request("/admin.js");
  assert.match(html.raw, /ProgHard Link/);
  assert.match(html.raw, /id="my-account"/);
  assert.match(script.raw, /Current password/);
  assert.match(script.raw, /Confirm new password/);
  assert.match(script.raw, /This token will only be shown once/);
  assert.match(script.raw, /I have saved this token/);
  assert.match(script.raw, /Revoke API token\?/);
  assert.match(script.raw, /Delete user\?/);
});

test("device UX exposes useful status and integration guidance without secrets", async () => {
  const script = await request("/admin.js");
  assert.match(script.raw, /Last seen/);
  assert.match(script.raw, /Never connected/);
  assert.match(script.raw, /Remote HTTPS API/);
  assert.match(script.raw, /Copy URL/);
  assert.match(script.raw, /<personal-api-token>/);
  assert.match(script.raw, /Local MQTT/);
  assert.doesNotMatch(script.raw, /Authorization: Bearer [A-Za-z0-9_-]{20}/);
});

test("device registration and long actions provide actionable guarded UX", async () => {
  const script = await request("/admin.js");
  assert.match(script.raw, /value === "espway-base" \? "ProgHard Link Base"/);
  assert.match(script.raw, /\["Application", applicationLabel\(enrollment\.application\)\]/);
  assert.match(script.raw, /Register device/);
  assert.match(script.raw, /Device registered successfully/);
  assert.match(script.raw, /confirmButton\.disabled = true/);
  assert.match(script.raw, /friendlyError/);
  assert.match(script.raw, /Created:/);
  assert.match(script.raw, /Last used:/);
});

test("autonomous Caddy delegates admin authentication to the application", async () => {
  const caddy = await readFile(caddyFile, "utf8");
  assert.match(caddy, /admin\.\{\$ESPWAY_DOMAIN\}/);
  assert.match(caddy, /reverse_proxy server:3000/);
  assert.doesNotMatch(caddy, /basic_auth|basicauth|password/i);
});

test("creates a device atomically and returns its token only once", async () => {
  const created = await post("/api/admin/devices", {
    deviceId: "esp-bb22cc",
    deviceName: "Workshop",
  });
  assert.equal(created.status, 201);
  assert.match(created.json().token, /^[a-f0-9]{64}$/);
  assert.equal(app.authorizedDevices.isEnabled("esp-bb22cc"), true);

  const stored = JSON.parse(await readFile(registryPath, "utf8"));
  assert.equal(stored.devices["esp-bb22cc"].token, created.json().token);
  const detail = await request("/api/admin/devices/esp-bb22cc");
  assert.doesNotMatch(detail.raw, /token|password/i);
});

test("created device token is immediately available to authentication", async () => {
  const created = (await post("/api/admin/devices", {
    deviceId: "esp-1122aa",
  })).json();
  assert.equal(
    app.authorizedDevices.getToken("esp-1122aa", new Map()),
    created.token,
  );
});

test("observations persist useful metadata without persisting online state", async () => {
  await app.authorizedDevices.recordObservation("esp-a4f912", {
    deviceName: "Observed",
    hardware: "esp8266",
    application: "espway-base",
    applicationVersion: "0.1.0",
    frameworkVersion: "0.2.0",
    lastSeen: "2026-09-09T10:00:00.000Z",
    connected: true,
  });
  const stored = JSON.parse(await readFile(registryPath, "utf8"));
  assert.equal(stored.devices["esp-a4f912"].lastSeen, "2026-09-09T10:00:00.000Z");
  assert.equal(stored.devices["esp-a4f912"].connected, undefined);
});

test("registry restoration can be reloaded without restarting the process", async () => {
  await post("/api/admin/devices", { deviceId: "esp-1122aa" });
  assert.ok(app.authorizedDevices.get("esp-1122aa"));

  const restored = JSON.parse(await readFile(registryPath, "utf8"));
  delete restored.devices["esp-1122aa"];
  await writeFile(registryPath, JSON.stringify(restored));
  app.authorizedDevices.reloadFromFile();

  assert.equal(app.authorizedDevices.get("esp-1122aa"), null);
  assert.ok(app.authorizedDevices.get("esp-a4f912"));
});

test("a malformed registry reload preserves the active in-memory registry", async () => {
  await writeFile(registryPath, "not json");
  assert.throws(() => app.authorizedDevices.reloadFromFile());
  assert.ok(app.authorizedDevices.get("esp-a4f912"));
});

test("device creation rejects duplicate and malformed identities", async () => {
  assert.equal((await post("/api/admin/devices", { deviceId: "esp-a4f912" })).status, 409);
  for (const deviceId of ["ESP-aabbcc", "esp-../bad", "arbitrary.example"])
    assert.equal((await post("/api/admin/devices", { deviceId })).status, 400);
});

test("admin writes require JSON and the CSRF request marker", async () => {
  const missingMarker = await request("/api/admin/devices", {
    method: "POST",
    body: {},
    headers: { "content-type": "application/json" },
  });
  assert.equal(missingMarker.status, 403);
  assert.equal((await request("/api/admin/devices", {
    method: "POST",
    body: {},
    headers: { "x-espway-admin-request": "1", "content-type": "text/plain" },
  })).status, 403);
  assert.equal((await post("/api/admin/devices", "not-json")).status, 400);
  assert.equal((await post("/api/admin/devices", {}, {
    origin: "https://attacker.example",
  })).status, 403);
});

test("enable and disable persist without terminating the active session", async () => {
  const socket = { closeCalled: false, close() { this.closeCalled = true; } };
  app.registry.connect({ deviceId: "esp-a4f912" }, socket);
  assert.equal((await post("/api/admin/devices/esp-a4f912/disable", {})).status, 200);
  assert.equal(app.authorizedDevices.isEnabled("esp-a4f912"), false);
  assert.equal(socket.closeCalled, false);
  assert.equal((await post("/api/admin/devices/esp-a4f912/enable", {})).status, 200);
  const stored = JSON.parse(await readFile(registryPath, "utf8"));
  assert.equal(stored.devices["esp-a4f912"].enabled, true);
});

test("edits deviceName atomically in persistence and runtime without exposing secrets", async () => {
  app.registry.connect({
    deviceId: "esp-a4f912",
    deviceName: "Old live name",
  }, { close() {} });
  const response = await adminWrite(
    "PATCH",
    "/api/admin/devices/esp-a4f912",
    { deviceName: "Renamed device" },
  );
  assert.equal(response.status, 200);
  assert.equal(response.json().deviceName, "Renamed device");
  assert.equal(app.registry.get("esp-a4f912").deviceName, "Renamed device");
  const stored = JSON.parse(await readFile(registryPath, "utf8"));
  assert.equal(stored.devices["esp-a4f912"].deviceName, "Renamed device");
  assert.doesNotMatch(response.raw, /token|secret|password/i);

  const immutable = await adminWrite(
    "PATCH",
    "/api/admin/devices/esp-a4f912",
    { deviceId: "esp-bb22cc", deviceName: "Ignored" },
  );
  assert.equal(immutable.status, 400);
  assert.equal(immutable.json().error, "device_id_immutable");
  assert.equal((await request("/api/admin/devices/esp-bb22cc")).status, 404);

  const invalidName = await adminWrite(
    "PATCH",
    "/api/admin/devices/esp-a4f912",
    { deviceName: "x".repeat(129) },
  );
  assert.equal(invalidName.status, 400);
  assert.equal(invalidName.json().error, "invalid_device_name");
});

test("edit and delete use the existing admin write protections", async () => {
  const edit = await adminWrite(
    "PATCH",
    "/api/admin/devices/esp-a4f912",
    { deviceName: "Rejected" },
    { origin: "https://attacker.example" },
  );
  assert.equal(edit.status, 403);

  const deletion = await request("/api/admin/devices/esp-dead00", {
    method: "DELETE",
    body: {},
    headers: { "content-type": "application/json" },
  });
  assert.equal(deletion.status, 403);
  assert.ok(app.authorizedDevices.get("esp-dead00"));
});

test("deletes offline devices atomically without exposing secrets", async () => {
  const response = await adminWrite(
    "DELETE",
    "/api/admin/devices/esp-dead00",
    {},
  );
  assert.equal(response.status, 200);
  assert.equal(app.authorizedDevices.get("esp-dead00"), null);
  const stored = JSON.parse(await readFile(registryPath, "utf8"));
  assert.equal(stored.devices["esp-dead00"], undefined);
  assert.doesNotMatch(response.raw, /token|secret|password/i);
});

test("deleting an online device closes its tunnel and rejects its old token", async () => {
  const socket = {
    closeCode: null,
    closeReason: null,
    close(code, reason) {
      this.closeCode = code;
      this.closeReason = reason;
    },
  };
  app.registry.connect({ deviceId: "esp-a4f912" }, socket);
  const response = await adminWrite(
    "DELETE",
    "/api/admin/devices/esp-a4f912",
    {},
  );
  assert.equal(response.status, 200);
  assert.equal(socket.closeCode, 4003);
  assert.equal(socket.closeReason, "device deleted");
  assert.equal(app.registry.get("esp-a4f912"), undefined);
  assert.equal(app.authorizedDevices.isEnabled("esp-a4f912"), false);
  assert.equal(
    app.authorizedDevices.getToken("esp-a4f912", new Map()),
    undefined,
  );
});

test("OTA refuses offline devices and devices without verified capability", async () => {
  assert.equal((await post("/api/admin/devices/esp-a4f912/ota", {
    applicationVersion: "0.1.0",
  })).json().error, "device_offline");
  app.registry.connect({
    deviceId: "esp-a4f912",
    transport: "ws-hmac",
    tunnelProtocol: "espway-tunnel/2",
    metadataVerified: false,
    capabilities: ["http-ota"],
  }, {});
  assert.equal((await post("/api/admin/devices/esp-a4f912/ota", {
    applicationVersion: "0.1.0",
  })).json().error, "http_ota_not_supported");
});

test("Device Manager streams a user binary with server-side device authorization", async () => {
  const firmware = Buffer.alloc(1024 * 1024 + 17, 0x5a);
  const digest = (await import("node:crypto")).createHash("sha256").update(firmware).digest("hex");
  const boundary = "espway-admin-test";
  const envelope = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="update"; filename="clock.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`),
    firmware,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const device = {
    deviceId: "esp-a4f912", connected: true, transport: "ws-hmac",
    tunnelProtocol: "espway-tunnel/2", metadataVerified: true,
    capabilities: ["http-ota"], otaMaxBytes: 3342336,
  };
  app.registry.connect(device, {});
  app.broker.request = async (_device, requestValue) => {
    assert.equal(requestValue.path, "/api/ota/challenge");
    return { status: 200, body: Buffer.from('{"nonce":"test-nonce"}') };
  };
  app.broker.streamRequest = async (_device, metadata, chunks) => {
    assert.equal(metadata.otaSize, firmware.length);
    assert.equal(metadata.otaSha256, digest);
    assert.equal(metadata.otaProof, computeOtaProof("legacy-secret", {
      deviceId: "esp-a4f912", nonce: "test-nonce", size: firmware.length, sha256: digest,
    }).toString("hex"));
    const received = [];
    for await (const chunk of chunks) received.push(chunk);
    assert.deepEqual(Buffer.concat(received), firmware);
    return { status: 202, headers: {}, body: Buffer.from('{"status":"accepted"}') };
  };
  const response = await request("/api/admin/devices/esp-a4f912/ota-upload", {
    method: "POST", body: envelope.toString("latin1"),
    headers: {
      "content-type": `multipart/form-data; boundary=${boundary}`,
      "x-espway-admin-request": "1",
      "x-espway-ota-size": String(firmware.length),
      "x-espway-ota-sha256": digest,
    },
  });
  assert.equal(response.status, 202);
  assert.equal(response.json().status, "validated");
});

test("semver comparison is numeric and refuses unsupported versions", () => {
  assert.equal(compareSemver("1.10.0", "1.9.0"), 1);
  assert.equal(compareSemver("1.0.0", "1.0.0"), 0);
  assert.equal(compareSemver("1.0.0-beta.1", "1.0.0"), -1);
  assert.equal(compareSemver("1.0.0-beta.10", "1.0.0-beta.2"), 1);
  assert.equal(compareSemver("1.0.0-1", "1.0.0-alpha"), -1);
  assert.equal(compareSemver("version-ten", "1.0.0"), null);
});

test("OTA resolves an exact released Registry artifact and never accepts a URL", async () => {
  const sent = [];
  const device = {
    deviceId: "esp-a4f912",
    connected: true,
    hardware: "esp8266",
    application: "espway-base",
    applicationVersion: "0.1.0",
    transport: "ws-hmac",
    tunnelProtocol: "espway-tunnel/2",
    metadataVerified: true,
    capabilities: ["http-ota"],
  };
  const manager = new DeviceManager({
    registry: { get: () => device },
    authorizedDevices: app.authorizedDevices,
    firmwareRegistry: new FirmwareRegistry(firmwareDir),
    broker: { request: async (_device, requestValue) => {
      sent.push(JSON.parse(requestValue.body));
      return { status: 202, body: Buffer.from('{"status":"accepted"}') };
    } },
    config: {
      baseDomain: "devices.example.com",
      httpFirmwareOrigin: "http://tunnel.devices.example.com",
      maxFirmwareBytes: 1048576,
    },
  });
  const result = await manager.ota("esp-a4f912", {
    applicationVersion: "latest",
    url: "http://evil.example/firmware.bin",
  });
  assert.equal(result.status, 202);
  assert.equal(sent[0].firmwareVersion, "0.2.3");
  assert.match(sent[0].url, /^http:\/\/tunnel\.devices\.example\.com\/firmware\//);
  assert.doesNotMatch(sent[0].url, /evil/);
  assert.equal((await manager.ota("esp-a4f912", {
    applicationVersion: "9.9.9",
  })).error, "released_firmware_not_found");
});
