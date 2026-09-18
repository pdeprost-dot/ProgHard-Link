import { DEVICE_ID_RE } from "./config.js";
import { prepareRegistryOtaCommand } from "./ota-command.js";
import { compareSemver } from "./semver.js";
import { supportsHttpOta } from "./tunnel-metadata.js";

const LIVE_FIELDS = [
  "deviceName",
  "hardware",
  "application",
  "applicationVersion",
  "firmwareVersion",
  "frameworkVersion",
  "connected",
  "connectedSince",
  "lastSeen",
  "lastDisconnectAt",
  "lastDisconnectCode",
  "lastDisconnectReason",
  "transport",
  "tunnelProtocol",
  "metadataVerified",
  "capabilities",
  "otaMaxBytes",
];

function publicLiveState(device) {
  if (!device) return {};
  return Object.fromEntries(
    LIVE_FIELDS
      .filter((field) => device[field] !== undefined)
      .map((field) => [field, device[field]]),
  );
}

function telemetryListSummary(telemetry) {
  if (!telemetry) return null;
  return {
    sampledAt: telemetry.sampledAt,
    stale: telemetry.stale,
    wifi: telemetry.wifi
      ? { connected: telemetry.wifi.connected, rssi: telemetry.wifi.rssi }
      : null,
    mqtt: telemetry.mqtt
      ? {
          enabled: telemetry.mqtt.enabled,
          connected: telemetry.mqtt.connected,
        }
      : null,
  };
}

export class DeviceManager {
  constructor({
    registry,
    authorizedDevices,
    firmwareRegistry,
    broker,
    telemetry,
    config,
  }) {
    this.registry = registry;
    this.authorizedDevices = authorizedDevices;
    this.firmwareRegistry = firmwareRegistry;
    this.broker = broker;
    this.telemetry = telemetry;
    this.config = config;
  }

  async list() {
    const devices = await Promise.all(
      this.authorizedDevices.list().map(({ deviceId }) => this.detail(deviceId)),
    );
    return devices.map((device) => ({
      ...device,
      telemetry: telemetryListSummary(device.telemetry),
    }));
  }

  async detail(deviceId) {
    if (!DEVICE_ID_RE.test(deviceId)) return null;
    const stored = this.authorizedDevices.get(deviceId);
    if (!stored) return null;
    const live = publicLiveState(this.registry.get(deviceId));
    const device = {
      ...stored,
      ...live,
      deviceId,
      deviceName: stored.deviceName ?? live.deviceName ?? "",
      connected: live.connected === true,
      online: live.connected === true,
      deviceUrl: `https://${deviceId}.${this.config.baseDomain}/`,
    };
    device.firmware = await this.#firmwareState(device);
    device.telemetry = this.telemetry?.get(deviceId) ?? null;
    return device;
  }

  create(input) {
    return this.authorizedDevices.create(input.deviceId, input.deviceName ?? "");
  }

  setEnabled(deviceId, enabled) {
    return this.authorizedDevices.setEnabled(deviceId, enabled);
  }

  async update(deviceId, input) {
    if (Object.hasOwn(input, "deviceId")) {
      throw Object.assign(new Error("device_id_immutable"), {
        statusCode: 400,
      });
    }
    if (
      Object.keys(input).some((field) => field !== "deviceName") ||
      !Object.hasOwn(input, "deviceName")
    ) {
      throw Object.assign(new Error("invalid_device_update"), {
        statusCode: 400,
      });
    }
    const updated = await this.authorizedDevices.updateDeviceName(
      deviceId,
      input.deviceName,
    );
    this.registry.updateManagementMetadata(deviceId, {
      deviceName: updated.deviceName ?? "",
    });
    return this.detail(deviceId);
  }

  async delete(deviceId) {
    await this.authorizedDevices.delete(deviceId);
    const live = this.registry.remove(deviceId);
    this.broker.disconnect(deviceId);
    if (live?.socket) live.socket.close(4003, "device deleted");
  }

  async ota(deviceId, input) {
    const device = this.registry.get(deviceId);
    if (!device?.connected) return { status: 409, error: "device_offline" };
    if (!supportsHttpOta(device))
      return { status: 409, error: "http_ota_not_supported" };
    if (typeof input?.applicationVersion !== "string")
      return { status: 400, error: "invalid_firmware_selector" };

    const prepared = await prepareRegistryOtaCommand(
      Buffer.from(JSON.stringify({
        hardware: device.hardware,
        application: device.application,
        applicationVersion: input.applicationVersion,
      })),
      {
        registry: this.firmwareRegistry,
        firmwareOrigin: this.config.httpFirmwareOrigin,
        maxFirmwareBytes: this.config.maxFirmwareBytes,
      },
    );
    if (!prepared.ok) return prepared;
    const capacity = Number.isSafeInteger(device.otaMaxBytes)
      ? device.otaMaxBytes
      : (this.config.legacyOtaMaxBytes ?? 1048576);
    if (prepared.command.size > capacity)
      return { status: 413, error: "firmware_exceeds_device_ota_capacity" };
    const result = await this.broker.request(device, {
      method: "POST",
      path: "/api/ota/remote",
      headers: { "content-type": "application/json" },
      body: Buffer.from(JSON.stringify(prepared.command)),
    });
    return {
      status: result.status,
      body: result.body,
      target: {
        application: device.application,
        applicationVersion: prepared.command.firmwareVersion,
        size: prepared.command.size,
        sha256: prepared.command.sha256,
      },
    };
  }

  async #firmwareState(device) {
    if (!device.hardware || !device.application)
      return { state: "unknown_application" };
    let releases;
    try {
      releases = await this.firmwareRegistry.listVersions(
        device.hardware,
        device.application,
      );
    } catch {
      return { state: "registry_unavailable" };
    }
    const latest = releases[0];
    if (!latest) return { state: "no_compatible_release" };
    const comparison = compareSemver(
      device.applicationVersion,
      latest.applicationVersion,
    );
    return {
      state: comparison === null
        ? "unsupported_version"
        : comparison < 0
          ? "update_available"
          : comparison === 0
            ? "latest"
            : "newer_than_registry",
      currentVersion: device.applicationVersion ?? null,
      latestReleasedVersion: latest.applicationVersion,
      latest,
    };
  }
}
