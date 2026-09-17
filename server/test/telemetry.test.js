import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { DeviceManager } from "../src/device-manager.js";
import { TelemetryService } from "../src/telemetry.js";

const WIFI = {
  connected: true,
  activeProfile: 1,
  lastKnownGoodProfile: 1,
  ip: "192.0.2.18",
  rssi: -61,
  apActive: false,
  testInProgress: false,
  profiles: [{
    id: 1,
    enabled: true,
    ssid: "test-wifi",
    password: "never-cache-this",
    configured: true,
    active: true,
  }],
};

const MQTT = {
  enabled: true,
  host: "mqtt.example.local",
  port: 1883,
  username: "test-user",
  password: "never-cache-this-either",
  passwordConfigured: true,
  baseTopic: "test/device",
  connected: true,
};

function response(value, status = 200) {
  return { status, body: Buffer.from(JSON.stringify(value)) };
}

function fixture(options = {}) {
  let time = options.time ?? Date.parse("2026-09-09T16:40:00.000Z");
  const devices = new Map();
  const calls = [];
  const registry = {
    get: (deviceId) => devices.get(deviceId),
    list: () => [...devices.values()].map(({ socket, ...device }) => device),
  };
  const broker = {
    activeCount: options.activeCount ?? (() => 0),
    request: options.request ?? (async (_device, request) => {
      calls.push(request.path);
      return request.path.endsWith("/wifi") ? response(WIFI) : response(MQTT);
    }),
  };
  const service = new TelemetryService({
    registry,
    broker,
    intervalMs: 30000,
    timeoutMs: 4000,
    staleAfterMs: 90000,
    initialJitterMs: options.initialJitterMs ?? 0,
    schedulerTickMs: 1000,
    now: () => time,
    random: options.random ?? (() => 0),
  });
  return {
    service,
    devices,
    calls,
    advance: (milliseconds) => { time += milliseconds; },
  };
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

test("scheduler polls online devices but never offline devices", async () => {
  const { service, devices, calls } = fixture();
  devices.set("esp-online1", { deviceId: "esp-online1", connected: true });
  devices.set("esp-offline", { deviceId: "esp-offline", connected: false });
  await service.tick();
  await settle();
  assert.deepEqual(calls, ["/api/espway/wifi", "/api/espway/mqtt"]);
  assert.equal(service.get("esp-offline"), null);
});

test("first poll jitter is deterministic and a busy tunnel skips without backlog", async () => {
  let busy = true;
  const { service, devices, calls, advance } = fixture({
    initialJitterMs: 5000,
    random: () => 0.5,
    activeCount: () => busy ? 1 : 0,
  });
  devices.set("esp-a4f912", { deviceId: "esp-a4f912", connected: true });
  await service.tick();
  advance(2500);
  await service.tick();
  assert.deepEqual(calls, []);
  busy = false;
  advance(1000);
  await service.tick();
  await settle();
  assert.equal(calls.length, 2);
});

test("an active telemetry cycle is never duplicated", async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  let calls = 0;
  const { service, devices, advance } = fixture({
    request: async (_device, request) => {
      calls += 1;
      if (calls === 1) await pending;
      return request.path.endsWith("/wifi") ? response(WIFI) : response(MQTT);
    },
  });
  devices.set("esp-a4f912", { deviceId: "esp-a4f912", connected: true });
  await service.tick();
  advance(30000);
  await service.tick();
  assert.equal(calls, 1);
  release();
  await settle();
  assert.equal(calls, 2);
});

test("global scheduler concurrency is bounded without queuing due cycles", async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  let calls = 0;
  const { service, devices } = fixture({
    request: async (_device, request) => {
      calls += 1;
      await pending;
      return request.path.endsWith("/wifi") ? response(WIFI) : response(MQTT);
    },
  });
  service.maxConcurrentPolls = 2;
  for (const deviceId of ["esp-000001", "esp-000002", "esp-000003"]) {
    devices.set(deviceId, { deviceId, connected: true });
  }
  await service.tick();
  assert.equal(calls, 2);
  assert.equal(service.states.get("esp-000003").active, false);
  release();
  await settle();
});

test("cache stores only sanitized Wi-Fi and MQTT observations", async () => {
  const { service, devices } = fixture();
  devices.set("esp-a4f912", { deviceId: "esp-a4f912", connected: true });
  await service.poll(devices.get("esp-a4f912"));
  const sample = service.get("esp-a4f912");
  assert.equal(sample.sampledAt, "2026-09-09T16:40:00.000Z");
  assert.equal(sample.stale, false);
  assert.equal(sample.wifi.activeSsid, "test-wifi");
  assert.equal(sample.wifi.rssi, -61);
  assert.equal(sample.mqtt.connected, true);
  assert.equal(sample.mqtt.baseTopic, "test/device");
  assert.doesNotMatch(JSON.stringify(sample), /test-user|password|never-cache/);
});

test("one endpoint failure preserves the other and records a bounded error", async () => {
  const { service, devices } = fixture({
    request: async (_device, request) => {
      if (request.path.endsWith("/wifi")) {
        throw Object.assign(new Error("device timeout"), { statusCode: 504 });
      }
      return response(MQTT);
    },
  });
  devices.set("esp-a4f912", { deviceId: "esp-a4f912", connected: true });
  await service.poll(devices.get("esp-a4f912"));
  const sample = service.get("esp-a4f912");
  assert.equal(sample.wifi, null);
  assert.equal(sample.mqtt.connected, true);
  assert.equal(sample.errors.wifi, "timeout");
  assert.equal(sample.stale, false);
});

test("poll requests use the dedicated timeout", async () => {
  const timeouts = [];
  const { service, devices } = fixture({
    request: async (_device, request, options) => {
      timeouts.push(options.timeoutMs);
      return request.path.endsWith("/wifi") ? response(WIFI) : response(MQTT);
    },
  });
  devices.set("esp-a4f912", { deviceId: "esp-a4f912", connected: true });
  await service.poll(devices.get("esp-a4f912"));
  assert.deepEqual(timeouts, [4000, 4000]);
});

test("disconnect during a poll prevents the remaining endpoint request", async () => {
  const { service, devices, calls } = fixture({
    request: async (device, request) => {
      calls.push(request.path);
      device.connected = false;
      return response(WIFI);
    },
  });
  const device = { deviceId: "esp-a4f912", connected: true };
  devices.set(device.deviceId, device);
  await service.poll(device);
  assert.deepEqual(calls, ["/api/espway/wifi"]);
  const sample = service.get(device.deviceId);
  assert.equal(sample.stale, true);
  assert.equal(sample.errors.mqtt, "device disconnected");
});

test("invalid JSON and disconnects are isolated per endpoint", async () => {
  let call = 0;
  const { service, devices } = fixture({
    request: async () => {
      call += 1;
      if (call === 1) return { status: 200, body: Buffer.from("not-json") };
      throw Object.assign(new Error("gone"), { statusCode: 503 });
    },
  });
  devices.set("esp-a4f912", { deviceId: "esp-a4f912", connected: true });
  await service.poll(devices.get("esp-a4f912"));
  const sample = service.get("esp-a4f912");
  assert.equal(sample.sampledAt, null);
  assert.equal(sample.stale, true);
  assert.equal(sample.errors.wifi, "invalid JSON response");
  assert.equal(sample.errors.mqtt, "device disconnected");
});

test("offline keeps the last sample stale and reconnect replaces it", async () => {
  const { service, devices, advance } = fixture();
  const device = { deviceId: "esp-a4f912", connected: true };
  devices.set(device.deviceId, device);
  await service.poll(device);
  const firstSampleAt = service.get(device.deviceId).sampledAt;
  device.connected = false;
  assert.equal(service.get(device.deviceId).stale, true);
  advance(1000);
  device.connected = true;
  await service.poll(device);
  assert.notEqual(service.get(device.deviceId).sampledAt, firstSampleAt);
  assert.equal(service.get(device.deviceId).stale, false);
});

test("an old online sample becomes stale after ninety seconds", async () => {
  const { service, devices, advance } = fixture();
  const device = { deviceId: "esp-a4f912", connected: true };
  devices.set(device.deviceId, device);
  await service.poll(device);
  advance(90000);
  assert.equal(service.get(device.deviceId).stale, true);
});

test("Device Manager detail includes telemetry while absence remains null", async () => {
  const authorizedDevices = {
    get: () => ({ enabled: true }),
  };
  const liveDevice = { deviceId: "esp-a4f912", connected: true };
  const sample = {
    sampledAt: "2026-09-09T16:40:00.000Z",
    stale: false,
    wifi: { ip: "192.0.2.18", activeSsid: "test-wifi" },
    mqtt: { host: "mqtt.example.local" },
    errors: { wifi: null, mqtt: null },
  };
  const manager = new DeviceManager({
    registry: { get: () => liveDevice },
    authorizedDevices,
    firmwareRegistry: { listVersions: async () => [] },
    broker: {},
    telemetry: { get: () => sample },
    config: { baseDomain: "devices.example.com" },
  });
  const detail = await manager.detail("esp-a4f912");
  assert.deepEqual(detail.telemetry, sample);
  assert.doesNotMatch(JSON.stringify(detail), /username|password/);

  manager.telemetry = { get: () => null };
  assert.equal((await manager.detail("esp-a4f912")).telemetry, null);
});

test("Device Manager list omits detail-only network identifiers", async () => {
  const sample = {
    sampledAt: "2026-09-09T16:40:00.000Z",
    stale: false,
    wifi: {
      connected: true,
      rssi: -61,
      ip: "192.0.2.18",
      activeSsid: "test-wifi",
    },
    mqtt: {
      enabled: true,
      connected: true,
      host: "mqtt.example.local",
      port: 1883,
      baseTopic: "test/device",
    },
    errors: { wifi: null, mqtt: null },
  };
  const manager = new DeviceManager({
    registry: { get: () => ({ deviceId: "esp-a4f912", connected: true }) },
    authorizedDevices: {
      get: () => ({ enabled: true }),
      list: () => [{ deviceId: "esp-a4f912" }],
    },
    firmwareRegistry: { listVersions: async () => [] },
    broker: {},
    telemetry: { get: () => sample },
    config: { baseDomain: "devices.example.com" },
  });
  const serialized = JSON.stringify(await manager.list());
  assert.match(serialized, /"rssi":-61/);
  assert.match(serialized, /"connected":true/);
  assert.doesNotMatch(
    serialized,
    /192\.168\.50\.218|test-wifi|mqtt\.example\.local|test\/device/,
  );
});

test("admin UI defines RSSI boundaries and neutral MQTT/telemetry states", async () => {
  const script = await readFile(
    new URL("../public/admin.js", import.meta.url),
    "utf8",
  );
  assert.match(script, /rssi > -55/);
  assert.match(script, /rssi > -67/);
  assert.match(script, /rssi > -75/);
  assert.match(script, /Telemetry: waiting/);
  assert.match(script, /Not enabled/);
  assert.doesNotMatch(script, /mqtt.*username|passwordConfigured/i);
  const source = script.match(/function rssiQuality\(rssi\) \{[\s\S]*?\n\}/)[0];
  const quality = new Function(`${source}; return rssiQuality;`)();
  assert.equal(quality(-54), "Excellent");
  assert.equal(quality(-55), "Good");
  assert.equal(quality(-67), "Fair");
  assert.equal(quality(-75), "Weak");
  assert.equal(quality(null), "Unknown");
});

test("disabled MQTT is cached as a neutral state", async () => {
  const disabled = { ...MQTT, enabled: false, connected: false };
  const { service, devices } = fixture({
    request: async (_device, request) => request.path.endsWith("/wifi")
      ? response(WIFI)
      : response(disabled),
  });
  const device = { deviceId: "esp-a4f912", connected: true };
  devices.set(device.deviceId, device);
  await service.poll(device);
  assert.deepEqual(service.get(device.deviceId).mqtt, {
    enabled: false,
    connected: false,
    host: "mqtt.example.local",
    port: 1883,
    baseTopic: "test/device",
  });
});
