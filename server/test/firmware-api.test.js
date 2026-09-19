import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import http from "node:http";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

import { AuthorizedDeviceRegistry } from "../src/authorized-devices.js";
import { createEspwayServer } from "../src/server.js";

const repositoryRoot = new URL("../../", import.meta.url);
const registryRoot = fileURLToPath(
  new URL("firmware-repository/", repositoryRoot),
);
let app;
let base;

function registryFetch(path, options = {}) {
  const target = new URL(base);
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: target.hostname,
      port: target.port,
      path,
      method: options.method ?? "GET",
      headers: {
        Host: "tunnel.devices.example.com",
        ...(options.headers ?? {}),
      },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const body = Buffer.concat(chunks);
        resolve({
          status: response.statusCode,
          text: async () => body.toString("utf8"),
          json: async () => JSON.parse(body.toString("utf8")),
          arrayBuffer: async () => body,
        });
      });
    });
    request.on("error", reject);
    request.end();
  });
}

before(async () => {
  app = createEspwayServer({
    port: 0,
    baseDomain: "devices.example.com",
    adminHost: "admin.devices.example.com",
    requestTimeoutMs: 100,
    maxBodyBytes: 4096,
    maxStreamsPerDevice: 8,
    firmwareDir: registryRoot,
    httpFirmwareOrigin: "http://firmware.example.test",
    maxFirmwareBytes: 1048576,
    otaOperatorToken: "",
    authorizedDevices: new AuthorizedDeviceRegistry({ devices: {} }),
    tokens: new Map(),
  });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  base = `http://127.0.0.1:${app.server.address().port}`;
});

after(async () => {
  app.wss.close();
  app.server.closeAllConnections();
  await new Promise((resolve) => app.server.close(resolve));
});

test("read-only API lists released artifacts", async () => {
  const response = await registryFetch("/api/firmware");
  assert.equal(response.status, 200);
  const artifacts = await response.json();
  assert.deepEqual(
    artifacts.map((item) => `${item.hardware}/${item.application}/${item.applicationVersion}`).sort(),
    [
      "esp32-c3/espway-base/0.2.3",
      "esp32-c6/espway-base/0.2.3",
      "esp32-s3/espway-base/0.2.3",
      "esp32/espway-base/0.2.3",
      "esp8266/espway-base/0.2.3",
    ],
  );
  assert.ok(artifacts.every((item) => item.status === "released"));
});

test("API lists versions and resolves explicit or latest manifests", async () => {
  const versions = await registryFetch(
    "/api/firmware/esp8266/espway-base",
  ).then((response) => response.json());
  assert.deepEqual(
    versions.map((item) => item.applicationVersion),
    ["0.2.3"],
  );

  for (const version of ["0.2.3", "latest"]) {
    const response = await registryFetch(
      `/api/firmware/esp8266/espway-base/${version}`,
    );
    assert.equal(response.status, 200);
    assert.equal(
      (await response.json()).sha256,
      "9108b08739237bc6a70e4ddb2f5d1115318c164347bde61100d83958650df1d3",
    );
  }
});

test("firmware API is read-only and returns no directory listing", async () => {
  assert.equal(
    (await registryFetch("/api/firmware", { method: "POST" })).status,
    405,
  );
  assert.equal((await fetch(`${base}/api/firmware`)).status, 404);
  assert.equal((await fetch(`${base}/firmware/`)).status, 404);
  assert.equal(
    (
      await fetch(
        `${base}/firmware/esp8266/espway-base/9.9.9/firmware.bin`,
      )
    ).status,
    404,
  );
});

test("serves only a registered firmware file by explicit identity", async () => {
  const response = await fetch(
    `${base}/firmware/esp8266/espway-base/0.2.3/firmware.bin`,
  );
  assert.equal(response.status, 200);
  const body = Buffer.from(await response.arrayBuffer());
  assert.equal(body.length, 559984);
  assert.equal(
    createHash("sha256").update(body).digest("hex"),
    "9108b08739237bc6a70e4ddb2f5d1115318c164347bde61100d83958650df1d3",
  );
});

test("serves the generated Web Installer manifest from the release", async () => {
  const response = await fetch(
    `${base}/firmware/esp8266/espway-base/0.2.3/web-installer-manifest.json`,
  );
  assert.equal(response.status, 200);
  const manifest = await response.json();
  assert.equal(manifest.name, "ProgHard Link Base");
  assert.deepEqual(manifest.builds[0].parts, [
    { path: "firmware.bin", offset: 0 },
  ]);
});

test("public manifests contain no filesystem paths or secrets", async () => {
  const response = await registryFetch(
    "/api/firmware/esp8266/espway-base/0.2.3",
  );
  const text = await response.text();
  assert.equal(response.status, 200);
  assert.doesNotMatch(text, /releasePath|firmwarePath|token|password|\.env/i);

  const sourceManifest = await readFile(
    new URL(
      "firmware-repository/esp8266/espway-base/0.2.3/manifest.json",
      repositoryRoot,
    ),
    "utf8",
  );
  assert.deepEqual(JSON.parse(text), JSON.parse(sourceManifest));
});
