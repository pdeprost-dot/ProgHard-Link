import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

import {
  computeOtaProof,
  deriveOtaKey,
  otaAuthorizationMessage,
} from "../src/ota-authorization.js";

const source = await readFile(new URL(
  "../../firmware/esp8266/libraries/ESPway/extras/ota-auth.js",
  import.meta.url,
), "utf8");
const context = { Uint8Array, Uint32Array, DataView, TextEncoder };
context.globalThis = context;
vm.runInNewContext(source, context, { filename: "ota-auth.js" });
const crypto = context.ESPwayOtaCrypto;

test("embedded OTA crypto header is generated from the audited source", async () => {
  const header = await readFile(new URL(
    "../../firmware/esp8266/libraries/ESPway/src/ESPwayOtaWebCrypto.h",
    import.meta.url,
  ), "utf8");
  const embedded = header.match(/R"ESPWAY_JS\(([\s\S]*)\)ESPWAY_JS";/)?.[1];
  assert.equal(embedded, source);
});

for (const [input, expected] of [
  ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
  ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
]) {
  test(`browser SHA-256 matches the standard vector for ${JSON.stringify(input)}`, () => {
    assert.equal(crypto.hex(crypto.sha256(input)), expected);
    assert.equal(expected, createHash("sha256").update(input).digest("hex"));
  });
}

test("browser HMAC-SHA256 matches RFC 4231 and Node", () => {
  const key = new Uint8Array(20).fill(0x0b);
  const message = "Hi There";
  const expected = "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7";
  assert.equal(crypto.hex(crypto.hmacSha256(key, message)), expected);
  assert.equal(createHmac("sha256", key).update(message).digest("hex"), expected);
});

test("browser, Node and ESP OTA authorization share one canonical vector", () => {
  const deviceToken = "test-device-token-32-bytes-0001";
  const metadata = {
    deviceId: "esp-a1b2c3",
    nonce: "000102030405060708090a0b0c0d0e0f" +
      "101112131415161718191a1b1c1d1e1f",
    size: 534208,
    sha256: "0123456789abcdef".repeat(4),
  };
  const expectedKey = "e555a8fc6eceda261dc437194cb8edeea" +
    "7875778ee2a1182d9d334edc7961594";
  const expectedProof = "f2d21c9cd8c6976420d8249d30b97ee" +
    "71571fe2fc5c6518e8efd74fc7b28dd75";
  const expectedMessage = [
    "ESPWAY-OTA-AUTH-1",
    metadata.deviceId,
    metadata.nonce,
    "534208",
    metadata.sha256,
  ].join("\n");

  assert.equal(otaAuthorizationMessage(metadata), expectedMessage);
  assert.equal(Buffer.byteLength(expectedMessage, "utf8"), 165);
  assert.equal(expectedMessage.endsWith("\n"), false);
  assert.equal(deriveOtaKey(deviceToken).toString("hex"), expectedKey);
  assert.equal(computeOtaProof(deviceToken, metadata).toString("hex"), expectedProof);
  assert.equal(crypto.otaMessage(
    metadata.deviceId, metadata.nonce, metadata.size, metadata.sha256,
  ), expectedMessage);
  assert.equal(crypto.hex(crypto.otaKey(deviceToken)), expectedKey);
  assert.equal(crypto.hex(crypto.otaProof(
    deviceToken, metadata.deviceId, metadata.nonce,
    metadata.size, metadata.sha256,
  )), expectedProof);
});
