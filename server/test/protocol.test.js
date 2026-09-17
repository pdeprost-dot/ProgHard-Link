import assert from "node:assert/strict";
import { test } from "node:test";
import { TunnelBroker } from "../src/tunnel.js";
import {
  AEAD_AES_128_GCM,
  AEAD_CHACHA20_POLY1305,
  computeAuthMac,
  deriveSessionKeys,
  decryptPayload,
  encryptPayload,
  isSensitiveRequest,
  signFrame,
  verifyDeviceAuth,
  verifyFrame,
} from "../src/protocol.js";

const TOKEN = "test-device-token";
const DEVICE_ID = "esp-a4f912";
const SERVER_NONCE = "11".repeat(32);
const DEVICE_NONCE = "22".repeat(32);

function sessionPair(serverNonce = SERVER_NONCE) {
  const keys = deriveSessionKeys(TOKEN, DEVICE_ID, serverNonce, DEVICE_NONCE);
  return {
    sender: {
      ...keys,
      sendSequence: 1n,
      expectedReceiveSequence: 1n,
    },
    receiver: {
      ...deriveSessionKeys(TOKEN, DEVICE_ID, serverNonce, DEVICE_NONCE),
      sendSequence: 1n,
      expectedReceiveSequence: 1n,
    },
  };
}

function signedFrame(direction, message = { type: "close", streamId: "42" }) {
  const pair = sessionPair();
  return {
    wire: signFrame(pair.sender, direction, message),
    receiver: pair.receiver,
  };
}

test("verifies valid device authentication", () => {
  const authMac = computeAuthMac(
    TOKEN,
    DEVICE_ID,
    SERVER_NONCE,
    DEVICE_NONCE,
  );
  assert.equal(
    verifyDeviceAuth(
      TOKEN,
      {
        type: "auth",
        authProtocol: "ESPWAY-AUTH-1",
        deviceId: DEVICE_ID,
        deviceNonce: DEVICE_NONCE,
        authMac,
      },
      SERVER_NONCE,
    ),
    true,
  );
});

test("rejects an invalid authentication MAC", () => {
  assert.equal(
    verifyDeviceAuth(
      TOKEN,
      {
        type: "auth",
        authProtocol: "ESPWAY-AUTH-1",
        deviceId: DEVICE_ID,
        deviceNonce: DEVICE_NONCE,
        authMac: "00".repeat(32),
      },
      SERVER_NONCE,
    ),
    false,
  );
});

test("verifies a valid C2S frame", () => {
  const { wire, receiver } = signedFrame("C2S");
  assert.equal(verifyFrame(receiver, "C2S", wire, 4096).type, "close");
});

test("verifies a valid S2C frame", () => {
  const { wire, receiver } = signedFrame("S2C", { type: "cancel", streamId: "1" });
  assert.equal(verifyFrame(receiver, "S2C", wire, 4096).type, "cancel");
});

test("rejects replay of the same sequence", () => {
  const { wire, receiver } = signedFrame("C2S");
  assert.ok(verifyFrame(receiver, "C2S", wire, 4096));
  assert.equal(verifyFrame(receiver, "C2S", wire, 4096), null);
});

test("rejects a skipped sequence", () => {
  const pair = sessionPair();
  pair.sender.sendSequence = 2n;
  const wire = signFrame(pair.sender, "C2S", { type: "close" });
  assert.equal(verifyFrame(pair.receiver, "C2S", wire, 4096), null);
});

test("rejects a frame from an old session", () => {
  const oldPair = sessionPair();
  const wire = signFrame(oldPair.sender, "C2S", { type: "close" });
  const newPair = sessionPair("33".repeat(32));
  assert.equal(verifyFrame(newPair.receiver, "C2S", wire, 4096), null);
});

test("rejects a modified payload", () => {
  const { wire, receiver } = signedFrame("C2S", {
    type: "data",
    streamId: "42",
    data: "YWJj",
  });
  const changed = Buffer.from(wire.toString().replace("YWJj", "YWJk"));
  assert.equal(verifyFrame(receiver, "C2S", changed, 4096), null);
});

test("rejects a modified request identifier", () => {
  const { wire, receiver } = signedFrame("C2S");
  const changed = Buffer.from(wire.toString().replace('"42"', '"43"'));
  assert.equal(verifyFrame(receiver, "C2S", changed, 4096), null);
});

test("rejects a modified frame type", () => {
  const { wire, receiver } = signedFrame("C2S");
  const changed = Buffer.from(wire.toString().replace('"close"', '"open"'));
  assert.equal(verifyFrame(receiver, "C2S", changed, 4096), null);
});

test("rejects a truncated MAC", () => {
  const { wire, receiver } = signedFrame("C2S");
  const changed = Buffer.from(
    wire.toString().replace(/"mac":"([a-f0-9]{62})[a-f0-9]{2}"/, '"mac":"$1"'),
  );
  assert.equal(verifyFrame(receiver, "C2S", changed, 4096), null);
});

test("rejects a frame larger than the configured limit", () => {
  const { wire, receiver } = signedFrame("C2S");
  assert.equal(verifyFrame(receiver, "C2S", wire, wire.length - 1), null);
});

const AEAD_CONTEXT = {
  type: "open",
  streamId: "stream-1",
  method: "POST",
  path: "/api/espway/mqtt",
};

function aeadFixture(
  serverNonce = SERVER_NONCE,
  algorithm = AEAD_CHACHA20_POLY1305,
) {
  const keys = deriveSessionKeys(TOKEN, DEVICE_ID, serverNonce, DEVICE_NONCE);
  const sender = { ...keys, sendSequence: 7n };
  return {
    keys,
    sequence: 7n,
    envelope: encryptPayload(
      sender, "S2C", AEAD_CONTEXT, Buffer.from("secret"), algorithm,
    ),
  };
}

test("roundtrips a selective AEAD payload", () => {
  const fixture = aeadFixture();
  assert.equal(
    decryptPayload(fixture.keys, "S2C", fixture.sequence, AEAD_CONTEXT, fixture.envelope)?.toString(),
    "secret",
  );
});

test("roundtrips an AES-128-GCM selective payload", () => {
  const fixture = aeadFixture(SERVER_NONCE, AEAD_AES_128_GCM);
  assert.equal(
    decryptPayload(
      fixture.keys, "S2C", fixture.sequence, AEAD_CONTEXT, fixture.envelope,
    )?.toString(),
    "secret",
  );
});

for (const [name, mutate] of [
  ["modified ciphertext", (f) => { f.envelope.ciphertext = "AC/ItCLR"; }],
  ["modified tag", (f) => { f.envelope.tag = "AGwyFspereV5QRWE4TK6pg=="; }],
  ["modified path AAD", (f) => { f.context.path = "/api/espway/wifi/profile/1"; }],
  ["modified method AAD", (f) => { f.context.method = "PUT"; }],
  ["modified request id AAD", (f) => { f.context.streamId = "stream-2"; }],
  ["modified frame type AAD", (f) => { f.context.type = "data"; }],
  ["reversed direction", (f) => { f.direction = "C2S"; }],
  ["modified sequence", (f) => { f.sequence = 8n; }],
  ["old session", (f) => { f.keys = deriveSessionKeys(TOKEN, DEVICE_ID, "33".repeat(32), DEVICE_NONCE); }],
  ["truncated ciphertext", (f) => { f.envelope.ciphertext = f.envelope.ciphertext.slice(0, -4); }],
  ["truncated tag", (f) => { f.envelope.tag = f.envelope.tag.slice(0, -4); }],
  ["incompatible AEAD version", (f) => { f.envelope.version = "ESPWAY-AEAD-2"; }],
  ["unknown algorithm", (f) => { f.envelope.algorithm = "UNKNOWN"; }],
]) {
  test(`rejects AEAD with ${name}`, () => {
    const fixture = aeadFixture();
    const changed = {
      ...fixture,
      direction: "S2C",
      context: { ...AEAD_CONTEXT },
      envelope: { ...fixture.envelope },
    };
    mutate(changed);
    assert.equal(
      decryptPayload(changed.keys, changed.direction, changed.sequence, changed.context, changed.envelope),
      null,
    );
  });
}

test("classifies only explicit secret-writing endpoints", () => {
  assert.equal(isSensitiveRequest("POST", "/api/espway/mqtt"), true);
  assert.equal(isSensitiveRequest("POST", "/setup/save"), true);
  assert.equal(isSensitiveRequest("POST", "/config/save"), true);
  assert.equal(isSensitiveRequest("POST", "/api/espway/wifi/profile/1"), true);
  assert.equal(isSensitiveRequest("POST", "/api/espway/wifi/profile/2"), true);
  assert.equal(isSensitiveRequest("GET", "/api/espway/mqtt"), false);
  assert.equal(isSensitiveRequest("POST", "/api/thermostat/setpoint"), false);
  assert.equal(isSensitiveRequest("POST", "/api/espway/mqtt/"), false);
  assert.equal(isSensitiveRequest("POST", "/api/espway/mqtt?x=1"), false);
  assert.equal(isSensitiveRequest("POST", "/api/espway/%6dqtt"), false);
});

test("matches the deterministic Node-to-ESP AEAD vector", () => {
  const fixture = aeadFixture();
  assert.equal(
    fixture.keys.s2cEncryptionKey.toString("hex"),
    "dfff7cfbd13a809e770619c7d042acda29d789a770711d12f94ac2eb526130a9",
  );
  assert.equal(fixture.keys.s2cNoncePrefix.toString("hex"), "debc7474");
  assert.deepEqual(fixture.envelope, {
    version: "ESPWAY-AEAD-1",
    algorithm: "CHACHA20-POLY1305",
    ciphertext: "pC/ItCLR",
    tag: "xGwyFspereV5QRWE4TK6pg==",
  });
});

test("matches the deterministic Node-to-ESP AES-GCM vector", () => {
  const fixture = aeadFixture(SERVER_NONCE, AEAD_AES_128_GCM);
  assert.equal(
    fixture.keys.s2cAesEncryptionKey.toString("hex"),
    "a174e2b929aab11a5305c2a975dd3eb4",
  );
  assert.equal(fixture.keys.s2cNoncePrefix.toString("hex"), "debc7474");
  assert.deepEqual(fixture.envelope, {
    version: "ESPWAY-AEAD-1",
    algorithm: "AES-128-GCM",
    ciphertext: "iaazAgpH",
    tag: "P9eTypCLDzXRIc1yfH58pA==",
  });
});

test("fails closed when a device advertises no sensitive cipher", async () => {
  const keys = deriveSessionKeys(TOKEN, DEVICE_ID, SERVER_NONCE, DEVICE_NONCE);
  const socket = {
    readyState: 1,
    espwaySession: { ...keys, sendSequence: 1n },
    espwaySend() {
      throw new Error("must not send");
    },
  };
  const broker = new TunnelBroker({ timeoutMs: 1000, maxStreamsPerDevice: 2 });
  await assert.rejects(
    broker.request(
      { deviceId: DEVICE_ID, socket, capabilities: [] },
      {
        method: "POST",
        path: "/api/espway/mqtt",
        headers: {},
        body: Buffer.from('{"password":"test-only"}'),
      },
    ),
    (error) => error.statusCode === 503,
  );
  assert.equal(broker.pending.size, 0);
});

test("selects AES-GCM from the signed device capability", async () => {
  const keys = deriveSessionKeys(TOKEN, DEVICE_ID, SERVER_NONCE, DEVICE_NONCE);
  const frames = [];
  const socket = {
    readyState: 1,
    espwaySession: { ...keys, sendSequence: 1n },
    espwaySend(frame) { frames.push(frame); },
  };
  const broker = new TunnelBroker({ timeoutMs: 1000, maxStreamsPerDevice: 2 });
  const pending = broker.request(
    {
      deviceId: DEVICE_ID,
      socket,
      capabilities: ["aead-selective", "aead-aes-128-gcm"],
    },
    {
      method: "POST",
      path: "/api/espway/wifi/profile/2",
      headers: {},
      body: Buffer.from('{"password":"test-only"}'),
    },
  );
  assert.equal(frames[0].aead.algorithm, "AES-128-GCM");
  assert.equal(JSON.stringify(frames).includes("test-only"), false);
  broker.receive(DEVICE_ID, { type: "close", streamId: frames[0].streamId });
  await pending;
});

test("never sends plaintext for a classified sensitive request", async () => {
  const keys = deriveSessionKeys(TOKEN, DEVICE_ID, SERVER_NONCE, DEVICE_NONCE);
  const frames = [];
  const socket = {
    readyState: 1,
    espwaySession: { ...keys, sendSequence: 1n },
    espwaySend(frame) {
      frames.push(frame);
    },
  };
  const broker = new TunnelBroker({ timeoutMs: 1000, maxStreamsPerDevice: 2 });
  const pending = broker.request(
    { deviceId: DEVICE_ID, socket, capabilities: ["aead-selective"] },
    {
      method: "POST",
      path: "/api/espway/mqtt",
      headers: {},
      body: Buffer.from('{"password":"secret"}'),
    },
  );
  const open = frames[0];
  assert.equal(open.type, "open");
  assert.equal(open.sensitive, true);
  assert.ok(open.aead?.ciphertext);
  assert.equal(JSON.stringify(open).includes("secret"), false);
  assert.equal(frames.some((frame) => frame.type === "data"), false);
  broker.receive(DEVICE_ID, { type: "close", streamId: open.streamId });
  await pending;
});

test("request timeout survives a socket that closed before cancel", async () => {
  const socket = {
    readyState: 1,
    espwaySend(frame) {
      if (frame.type === "close") this.readyState = 3;
    },
  };
  const broker = new TunnelBroker({ timeoutMs: 5, maxStreamsPerDevice: 1 });
  await assert.rejects(
    broker.request(
      { deviceId: DEVICE_ID, socket },
      { method: "GET", path: "/slow", headers: {}, body: Buffer.alloc(0) },
    ),
    (error) => error.statusCode === 504,
  );
});
