const WIFI_PATH = "/api/espway/wifi";
const MQTT_PATH = "/api/espway/mqtt";

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function optionalString(value) {
  return typeof value === "string" && value.length ? value : null;
}

function parseJsonResponse(response) {
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`HTTP ${response.status}`);
  }
  try {
    const value = JSON.parse(response.body.toString("utf8"));
    if (!value || Array.isArray(value) || typeof value !== "object") {
      throw new Error();
    }
    return value;
  } catch {
    throw new Error("invalid JSON response");
  }
}

function sanitizeWifi(value) {
  const activeProfile = finiteNumber(value.activeProfile);
  const profile = Array.isArray(value.profiles)
    ? value.profiles.find((item) => item?.id === activeProfile)
    : null;
  return {
    connected: value.connected === true,
    activeProfile,
    lastKnownGoodProfile: finiteNumber(value.lastKnownGoodProfile),
    activeSsid: optionalString(profile?.ssid),
    ip: optionalString(value.ip),
    rssi: finiteNumber(value.rssi),
    apActive: value.apActive === true,
  };
}

function sanitizeMqtt(value) {
  return {
    enabled: value.enabled === true,
    connected: value.connected === true,
    host: optionalString(value.host),
    port: finiteNumber(value.port),
    baseTopic: optionalString(value.baseTopic),
  };
}

function errorMessage(error) {
  if (error?.statusCode === 503) return "device disconnected";
  if (error?.statusCode === 504) return "timeout";
  if (error?.message === "invalid JSON response") return error.message;
  if (/^HTTP [1-5][0-9]{2}$/.test(error?.message)) return error.message;
  return "request failed";
}

export class TelemetryService {
  constructor({
    registry,
    broker,
    intervalMs = 30000,
    timeoutMs = 4000,
    staleAfterMs = 90000,
    initialJitterMs = 5000,
    schedulerTickMs = 1000,
    maxConcurrentPolls = 4,
    now = () => Date.now(),
    random = Math.random,
    startTimer = setInterval,
    stopTimer = clearInterval,
  }) {
    this.registry = registry;
    this.broker = broker;
    this.intervalMs = intervalMs;
    this.timeoutMs = timeoutMs;
    this.staleAfterMs = staleAfterMs;
    this.initialJitterMs = initialJitterMs;
    this.schedulerTickMs = schedulerTickMs;
    this.maxConcurrentPolls = maxConcurrentPolls;
    this.now = now;
    this.random = random;
    this.startTimer = startTimer;
    this.stopTimer = stopTimer;
    this.cache = new Map();
    this.states = new Map();
    this.timer = null;
    this.activeCycles = 0;
  }

  start() {
    if (this.timer) return;
    this.timer = this.startTimer(
      () => this.tick(),
      this.schedulerTickMs,
    );
    this.timer.unref?.();
  }

  stop() {
    if (!this.timer) return;
    this.stopTimer(this.timer);
    this.timer = null;
  }

  get(deviceId) {
    const sample = this.cache.get(deviceId);
    if (!sample) return null;
    const device = this.registry.get(deviceId);
    const sampledAtMs = sample.sampledAt
      ? Date.parse(sample.sampledAt)
      : 0;
    return {
      ...sample,
      stale: device?.connected !== true ||
        !sampledAtMs ||
        this.now() - sampledAtMs >= this.staleAfterMs,
    };
  }

  async tick() {
    const currentDeviceIds = new Set();
    for (const device of this.registry.list()) {
      currentDeviceIds.add(device.deviceId);
      let state = this.states.get(device.deviceId);
      if (!device.connected) {
        if (state) state.wasOnline = false;
        continue;
      }
      if (!state) {
        state = { active: false, wasOnline: false, nextDueAt: 0 };
        this.states.set(device.deviceId, state);
      }
      if (!state.wasOnline) {
        state.wasOnline = true;
        state.nextDueAt = this.now() +
          Math.floor(this.random() * (this.initialJitterMs + 1));
      }
      if (state.active || this.now() < state.nextDueAt) continue;
      if (this.activeCycles >= this.maxConcurrentPolls) continue;
      if (this.broker.activeCount?.(device.deviceId) > 0) {
        state.nextDueAt = this.now() + this.schedulerTickMs;
        continue;
      }
      state.active = true;
      this.activeCycles += 1;
      state.nextDueAt = this.now() + this.intervalMs;
      void this.poll(device).finally(() => {
        state.active = false;
        this.activeCycles -= 1;
      });
    }
    for (const deviceId of this.states.keys()) {
      if (!currentDeviceIds.has(deviceId)) this.states.delete(deviceId);
    }
  }

  async poll(device) {
    const previous = this.cache.get(device.deviceId);
    const next = {
      sampledAt: previous?.sampledAt ?? null,
      stale: previous?.stale ?? true,
      wifi: previous?.wifi ?? null,
      mqtt: previous?.mqtt ?? null,
      errors: { wifi: null, mqtt: null },
    };
    let success = false;

    for (const endpoint of [
      { name: "wifi", path: WIFI_PATH, sanitize: sanitizeWifi },
      { name: "mqtt", path: MQTT_PATH, sanitize: sanitizeMqtt },
    ]) {
      if (this.registry.get(device.deviceId)?.connected !== true) {
        next.errors[endpoint.name] = "device disconnected";
        continue;
      }
      if (this.broker.activeCount?.(device.deviceId) > 0) {
        next.errors[endpoint.name] = "poll skipped: tunnel busy";
        continue;
      }
      try {
        const response = await this.broker.request(
          this.registry.get(device.deviceId),
          { method: "GET", path: endpoint.path, headers: {}, body: Buffer.alloc(0) },
          { timeoutMs: this.timeoutMs },
        );
        next[endpoint.name] = endpoint.sanitize(parseJsonResponse(response));
        success = true;
      } catch (error) {
        next.errors[endpoint.name] = errorMessage(error);
      }
    }

    if (success) {
      next.sampledAt = new Date(this.now()).toISOString();
      next.stale = false;
    }
    this.cache.set(device.deviceId, next);
    return next;
  }
}
