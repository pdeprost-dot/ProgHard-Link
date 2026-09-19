import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import http from "node:http";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { AuthorizedDeviceRegistry } from "../src/authorized-devices.js";
import { createEspwayServer } from "../src/server.js";

const repositoryRoot = new URL("../../", import.meta.url);
const portalHost = "example.net";
let app;
let endpoint;

function request(path, { method = "GET", host = portalHost } = {}) {
  const target = new URL(endpoint);
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: target.hostname,
      port: target.port,
      path,
      method,
      headers: { Host: host },
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const body = Buffer.concat(chunks);
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body,
          text: () => body.toString("utf8"),
        });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

before(async () => {
  app = createEspwayServer({
    port: 0,
    baseDomain: "example.net",
    adminHost: "admin.example.net",
    installerHost: "install.example.net",
    tunnelHost: "tunnel.example.net",
    portalHost,
    requestTimeoutMs: 100,
    maxBodyBytes: 4096,
    maxStreamsPerDevice: 8,
    firmwareDir: fileURLToPath(new URL("firmware-repository/", repositoryRoot)),
    downloadDir: fileURLToPath(new URL("download-repository/", repositoryRoot)),
    httpFirmwareOrigin: "http://firmware.example.test",
    maxFirmwareBytes: 1048576,
    otaOperatorToken: "",
    authorizedDevices: new AuthorizedDeviceRegistry({ devices: {} }),
    tokens: new Map(),
  });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  endpoint = `http://127.0.0.1:${app.server.address().port}`;
});

after(async () => {
  app.wss.close();
  app.server.closeAllConnections();
  await new Promise((resolve) => app.server.close(resolve));
});

test("Portal renders release metadata and public destinations", async () => {
  const response = await request("/");
  assert.equal(response.status, 200);
  assert.match(response.text(), /ProgHard Link/);
  assert.match(response.text(), /A secure remote platform for ESP8266 and ESP32 devices/);
  assert.match(response.text(), /Library version/);
  assert.match(response.text(), /ESP8266, ESP32, ESP32-C3, ESP32-C6/);
  assert.match(response.text(), /<strong>Register<\/strong>/);
  assert.match(response.text(), /Node-RED/);
  assert.match(response.text(), /Connect <span>·<\/span> Configure/);
  assert.match(response.text(), /https:\/\/admin\.example\.net\//);
  assert.match(response.text(), /https:\/\/install\.example\.net\//);
  assert.match(response.text(), /esp-&lt;deviceId&gt;\.example\.net/);
  assert.match(response.text(), /ProgHard-Link-0\.4\.12\.zip/);
  assert.doesNotMatch(response.text(), /ESPwayBase/);
  assert.match(response.headers["content-security-policy"], /default-src 'self'/);
  assert.equal(response.headers["x-frame-options"], "DENY");
  assert.equal(response.headers["referrer-policy"], "no-referrer");
});

test("Portal serves its stylesheet only on the configured host", async () => {
  const css = await request("/portal.css");
  assert.equal(css.status, 200);
  assert.match(css.headers["content-type"], /^text\/css/);
  assert.equal((await request("/", { host: "attacker.example" })).status, 404);
});

test("Portal serves the current ProgHard Link Arduino archive", async () => {
  const response = await request("/downloads/arduino/ProgHard-Link-0.4.12.zip");
  assert.equal(response.status, 200);
  assert.equal(
    response.headers["content-disposition"],
    'attachment; filename="ProgHard-Link-0.4.12.zip"',
  );
  assert.equal(response.body.length, 280582);
  assert.equal(
    createHash("sha256").update(response.body).digest("hex"),
    "c27e3f60c786bb7aa8cdaeee57e211a6447df30c4b8f79fd57794c1636389fd0",
  );
  assert.equal(
    (await request("/downloads/arduino/ESPway-0.4.7.zip")).status,
    404,
  );
});

test("Portal download has immutable safe response headers", async () => {
  const response = await request("/downloads/arduino/ProgHard-Link-0.4.11.zip");
  assert.equal(response.status, 200);
  assert.equal(response.headers["content-type"], "application/zip");
  assert.equal(
    response.headers["content-disposition"],
    'attachment; filename="ProgHard-Link-0.4.11.zip"',
  );
  assert.equal(
    response.headers["cache-control"],
    "public, max-age=31536000, immutable",
  );
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  assert.equal(response.body.length, 280038);
  assert.equal(
    createHash("sha256").update(response.body).digest("hex"),
    "f0e8291a49248fe8c0886c8ccee6c4e53436695a97ace8e35ef4217fef1c6e96",
  );
});

test("Portal host fails closed for private and unrelated routes", async () => {
  for (const path of [
    "/api/admin/devices", "/api/firmware", "/devices.json", "/.env",
    "/tunnel", "/admin", "/firmware/esp8266/espway-base/0.1.0/firmware.bin",
    "/downloads/", "/downloads/arduino/", "/downloads/arduino/ESPway-9.9.9.zip",
    "/downloads/arduino/%2e%2e%2fsecret", "/downloads/arduino/%252e%252e%252fsecret",
    "/downloads/arduino/ESPway-0.2.0.zip%00", "/downloads/arduino/ESPway-0.2.0.zip/extra",
  ]) assert.equal((await request(path)).status, 404, path);
  assert.equal((await request("/", { method: "POST" })).status, 405);
});
