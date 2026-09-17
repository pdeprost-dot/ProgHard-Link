import assert from "node:assert/strict";
import crypto from "node:crypto";
import { afterEach, beforeEach, test } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  prepareOtaCommand,
  prepareRegistryOtaCommand,
} from "../src/ota-command.js";

const ORIGIN = "http://firmware.example.test";
const VERSION = "0.2.0-test";
const FIRMWARE = Buffer.from("controlled firmware bytes");
const SHA256 = crypto.createHash("sha256").update(FIRMWARE).digest("hex");

let firmwareDir;

beforeEach(async () => {
  firmwareDir = await mkdtemp(join(tmpdir(), "espway-ota-"));
  await writeFile(join(firmwareDir, "test.bin"), FIRMWARE);
});

afterEach(async () => {
  await rm(firmwareDir, { recursive: true, force: true });
});

function options(overrides = {}) {
  return {
    firmwareOrigin: ORIGIN,
    firmwareDir,
    maxFirmwareBytes: 1024,
    ...overrides,
  };
}

function command(overrides = {}) {
  return Buffer.from(JSON.stringify({
    url: `${ORIGIN}/firmware/test.bin`,
    sha256: SHA256,
    firmwareVersion: VERSION,
    size: FIRMWARE.length,
    ...overrides,
  }));
}

test("prepares a controlled OTA command", async () => {
  const result = await prepareOtaCommand(command(), options());
  assert.deepEqual(result, {
    ok: true,
    command: {
      url: `${ORIGIN}/firmware/test.bin`,
      sha256: SHA256,
      firmwareVersion: VERSION,
      size: FIRMWARE.length,
    },
  });
});

test("accepts an omitted optional size and supplies the controlled size", async () => {
  const input = JSON.parse(command());
  delete input.size;
  const result = await prepareOtaCommand(
    Buffer.from(JSON.stringify(input)),
    options(),
  );
  assert.equal(result.ok, true);
  assert.equal(result.command.size, FIRMWARE.length);
});

test("rejects a missing SHA-256", async () => {
  const result = await prepareOtaCommand(command({ sha256: undefined }), options());
  assert.equal(result.error, "invalid_sha256");
});

test("rejects malformed SHA-256", async () => {
  const result = await prepareOtaCommand(command({ sha256: "xyz" }), options());
  assert.equal(result.error, "invalid_sha256");
});

test("rejects a valid-looking but incorrect SHA-256", async () => {
  const result = await prepareOtaCommand(command({ sha256: "00".repeat(32) }), options());
  assert.equal(result.error, "sha256_mismatch");
});

test("rejects a missing URL", async () => {
  const result = await prepareOtaCommand(command({ url: undefined }), options());
  assert.equal(result.error, "invalid_url");
});

test("rejects HTTPS and firmware URLs outside the controlled origin", async () => {
  const https = await prepareOtaCommand(
    command({ url: "https://firmware.example.test/firmware/test.bin" }),
    options(),
  );
  const foreign = await prepareOtaCommand(
    command({ url: "http://attacker.test/firmware/test.bin" }),
    options(),
  );
  assert.equal(https.error, "invalid_url");
  assert.equal(foreign.error, "invalid_url");
});

test("rejects malformed JSON and missing firmware version", async () => {
  const malformed = await prepareOtaCommand(Buffer.from("{"), options());
  const noVersion = await prepareOtaCommand(
    command({ firmwareVersion: undefined }),
    options(),
  );
  assert.equal(malformed.error, "invalid_json");
  assert.equal(noVersion.error, "invalid_firmware_version");
});

test("rejects invalid and mismatched sizes", async () => {
  const invalid = await prepareOtaCommand(command({ size: -1 }), options());
  const mismatch = await prepareOtaCommand(command({ size: 1 }), options());
  assert.equal(invalid.error, "invalid_size");
  assert.equal(mismatch.error, "size_mismatch");
});

test("returns 404 for a missing controlled firmware", async () => {
  const result = await prepareOtaCommand(
    command({ url: `${ORIGIN}/firmware/missing.bin` }),
    options(),
  );
  assert.equal(result.status, 404);
  assert.equal(result.error, "firmware_not_found");
});

test("rejects a truncated controlled firmware", async () => {
  await writeFile(join(firmwareDir, "test.bin"), FIRMWARE.subarray(0, 5));
  const result = await prepareOtaCommand(command(), options());
  assert.equal(result.error, "size_mismatch");
});

test("rejects firmware larger than the configured OTA capacity", async () => {
  const result = await prepareOtaCommand(
    command(),
    options({ maxFirmwareBytes: FIRMWARE.length - 1 }),
  );
  assert.equal(result.error, "firmware_too_large");
});

test("resolves released OTA metadata from the registry", async () => {
  const registry = {
    resolve: async (hardware, application, version, options) => {
      assert.deepEqual(
        { hardware, application, version, options },
        {
          hardware: "esp8266",
          application: "thermostat-demo",
          version: "0.2.0",
          options: { allowDeprecated: false },
        },
      );
      return {
        id: "esp8266/thermostat-demo/0.2.0",
        file: "firmware.bin",
        applicationVersion: "0.2.0",
        size: 550032,
        sha256: "66222cd091e25266619ead3339040e32e7758bd404a736b296bbf306da481f3e",
      };
    },
  };
  const result = await prepareRegistryOtaCommand(
    Buffer.from(JSON.stringify({
      hardware: "esp8266",
      application: "thermostat-demo",
      applicationVersion: "0.2.0",
    })),
    {
      registry,
      firmwareOrigin: ORIGIN,
      maxFirmwareBytes: 1048576,
    },
  );
  assert.equal(result.ok, true);
  assert.equal(
    result.command.url,
    `${ORIGIN}/firmware/esp8266/thermostat-demo/0.2.0/firmware.bin`,
  );
  assert.equal(result.command.size, 550032);
});

test("never proposes a candidate or deprecated artifact for OTA", async () => {
  const registry = { resolve: async () => null };
  const result = await prepareRegistryOtaCommand(
    Buffer.from(JSON.stringify({
      hardware: "esp8266",
      application: "test-app",
      applicationVersion: "latest",
    })),
    { registry, firmwareOrigin: ORIGIN, maxFirmwareBytes: 1024 },
  );
  assert.deepEqual(result, {
    ok: false,
    error: "released_firmware_not_found",
    status: 404,
  });
});

test("rejects an incomplete registry OTA selector", async () => {
  const result = await prepareRegistryOtaCommand(
    Buffer.from(JSON.stringify({ hardware: "esp8266" })),
    {
      registry: { resolve: async () => assert.fail("must not resolve") },
      firmwareOrigin: ORIGIN,
      maxFirmwareBytes: 1024,
    },
  );
  assert.equal(result.error, "invalid_firmware_selector");
});
