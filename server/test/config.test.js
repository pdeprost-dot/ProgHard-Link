import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { AuthorizedDeviceRegistry } from "../src/authorized-devices.js";
import { loadConfig } from "../src/config.js";

test("ESPWAY_DOMAIN is the single source for every public hostname", () => {
  const config = loadConfig({ ESPWAY_DOMAIN: "example.net" });
  assert.equal(config.domain, "example.net");
  assert.equal(config.portalHost, "example.net");
  assert.equal(config.adminHost, "admin.example.net");
  assert.equal(config.installerHost, "install.example.net");
  assert.equal(config.tunnelHost, "tunnel.example.net");
  assert.equal(config.baseDomain, "example.net");
  assert.equal(config.publicUrl, "https://admin.example.net");
  assert.equal(config.httpFirmwareOrigin, "http://tunnel.example.net");
  assert.equal(config.tokens.size, 0);
});

test("ESPWAY_DOMAIN is normalized and malformed domains fail closed", () => {
  assert.equal(loadConfig({ ESPWAY_DOMAIN: "  LINK.EXAMPLE.NET. " }).domain, "link.example.net");
  for (const domain of ["localhost", "https://example.net", "*.example.net", "bad_domain.example"])
    assert.throws(() => loadConfig({ ESPWAY_DOMAIN: domain }), /invalid_espway_domain/);
});

test("invalid numeric environment settings fail explicitly", () => {
  const settings = [
    "PORT", "ESPWAY_ENROLLMENT_TTL_MS", "ESPWAY_REQUEST_TIMEOUT_MS",
    "ESPWAY_MAX_BODY_BYTES", "ESPWAY_MAX_OTA_UPLOAD_BYTES",
    "ESPWAY_LEGACY_OTA_MAX_BYTES", "ESPWAY_OTA_UPLOAD_TIMEOUT_MS",
    "ESPWAY_MAX_STREAMS_PER_DEVICE", "ESPWAY_HEARTBEAT_INTERVAL_MS",
    "ESPWAY_HEARTBEAT_TIMEOUT_MS", "ESPWAY_TELEMETRY_INTERVAL_MS",
    "ESPWAY_TELEMETRY_TIMEOUT_MS", "ESPWAY_TELEMETRY_STALE_AFTER_MS",
    "ESPWAY_TELEMETRY_INITIAL_JITTER_MS", "ESPWAY_TELEMETRY_MAX_CONCURRENT_POLLS",
    "ESPWAY_MAX_FIRMWARE_BYTES", "ESPWAY_SESSION_TTL_MS",
    "ESPWAY_DEVICE_SESSION_TTL_MS",
  ];
  for (const name of settings) {
    for (const invalid of ["NaN", "Infinity", "-1", "1.5", "9007199254740992", " ", "0x10", null])
      assert.throws(() => loadConfig({ [name]: invalid }), new RegExp(`invalid_${name.toLowerCase()}`));
  }
  assert.throws(() => loadConfig({ ESPWAY_MAX_BODY_BYTES: "0" }), /invalid_espway_max_body_bytes/);
  assert.throws(() => loadConfig({ PORT: "65536" }), /invalid_port/);
  assert.equal(loadConfig({ ESPWAY_TELEMETRY_INITIAL_JITTER_MS: "0" }).telemetryInitialJitterMs, 0);
});

test("an empty data directory gets a private empty device registry", async () => {
  const directory = await mkdtemp(join(tmpdir(), "espway-empty-data-"));
  const registryPath = join(directory, "nested", "devices.json");
  const registry = AuthorizedDeviceRegistry.fromFile(registryPath);
  assert.deepEqual(registry.list(), []);
  assert.deepEqual(JSON.parse(await readFile(registryPath, "utf8")), {
    version: 1,
    devices: {},
  });
  if (process.platform !== "win32")
    assert.equal((await stat(registryPath)).mode & 0o777, 0o600);
});

test("device registry initialization never replaces existing data", async () => {
  const directory = await mkdtemp(join(tmpdir(), "espway-existing-data-"));
  const registryPath = join(directory, "devices.json");
  const first = AuthorizedDeviceRegistry.fromFile(registryPath);
  await first.create("esp-a1b2c3", "Workshop");
  const second = AuthorizedDeviceRegistry.fromFile(registryPath);
  assert.equal(second.get("esp-a1b2c3").deviceName, "Workshop");
});
