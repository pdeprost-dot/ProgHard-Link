import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

import { firmwareParts, multipartBoundary, OTA_CHUNK_SIZE } from "../src/ota-upload.js";
import { TunnelBroker } from "../src/tunnel.js";

function multipart(firmware, boundary = "espway-boundary") {
  return Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="update"; filename="firmware.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`),
    firmware,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
}

test("OTA multipart parser emits bounded firmware chunks without its envelope", async () => {
  const firmware = Buffer.alloc(520 * 1024, 0x5a);
  const chunks = [];
  for await (const chunk of firmwareParts(Readable.from(multipart(firmware)), "espway-boundary", 1024 * 1024)) chunks.push(chunk);
  assert.equal(Buffer.concat(chunks).compare(firmware), 0);
  assert.ok(chunks.every((chunk) => chunk.length <= OTA_CHUNK_SIZE));
  assert.ok(chunks.length > 500);
});

test("OTA parser rejects malformed multipart and bodies above its dedicated limit", async () => {
  await assert.rejects(async () => { for await (const unused of firmwareParts(Readable.from(Buffer.from("bad")), "x", 1024)) void unused; }, /invalid_multipart/);
  await assert.rejects(async () => { for await (const unused of firmwareParts(Readable.from(multipart(Buffer.alloc(2048), "x")), "x", 1024)) void unused; }, /ota_too_large/);
  assert.equal(multipartBoundary("multipart/form-data; boundary=abc"), "abc");
  assert.equal(multipartBoundary("application/octet-stream"), null);
});

test("stream broker keeps exactly one chunk in flight until its ACK", async () => {
  const broker = new TunnelBroker({ timeoutMs: 1000, maxStreamsPerDevice: 1 });
  let inFlight = 0, maximumInFlight = 0, bytes = 0;
  const socket = { readyState: 1, espwaySend(message) {
    if (message.type === "open") {
      queueMicrotask(() => broker.receive("esp-test01", {
        type: "ack", streamId: message.streamId, received: 0,
      }));
    } else if (message.type === "data") {
      inFlight++; maximumInFlight = Math.max(maximumInFlight, inFlight);
      bytes += Buffer.from(message.data, "base64").length;
      queueMicrotask(() => { inFlight--; broker.receive("esp-test01", { type: "ack", streamId: message.streamId, received: bytes }); });
    } else if (message.type === "close") {
      queueMicrotask(() => { broker.receive("esp-test01", { type: "open", streamId: message.streamId, status: 200, headers: {} }); broker.receive("esp-test01", { type: "close", streamId: message.streamId }); });
    }
  }};
  async function* chunks() { yield Buffer.alloc(1024); yield Buffer.alloc(1024); yield Buffer.alloc(17); }
  const response = await broker.streamRequest({ deviceId: "esp-test01", socket }, { method: "POST", path: "/ota/upload", headers: {}, otaSize: 2065, otaSha256: "a".repeat(64), otaProof: "b".repeat(64) }, chunks());
  assert.equal(response.status, 200);
  assert.equal(maximumInFlight, 1);
  assert.equal(bytes, 2065);
});

test("stream broker sends no DATA when the device rejects OTA OPEN", async () => {
  const broker = new TunnelBroker({ timeoutMs: 1000, maxStreamsPerDevice: 1 });
  let dataFrames = 0;
  const socket = { readyState: 1, espwaySend(message) {
    if (message.type === "open") queueMicrotask(() => {
      broker.receive("esp-test01", {
        type: "open", streamId: message.streamId, status: 400, headers: {},
      });
      broker.receive("esp-test01", { type: "close", streamId: message.streamId });
    });
    if (message.type === "data") dataFrames++;
  }};
  async function* chunks() { yield Buffer.alloc(512); }
  await assert.rejects(
    broker.streamRequest(
      { deviceId: "esp-test01", socket },
      { method: "POST", path: "/ota/upload", headers: {}, otaSize: 512,
        otaSha256: "a".repeat(64), otaProof: "b".repeat(64) },
      chunks(),
    ),
    (error) => error.statusCode === 400,
  );
  assert.equal(dataFrames, 0);
});
