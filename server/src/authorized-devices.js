import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chmod, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DEVICE_ID_RE } from "./config.js";

function validateDocument(document) {
  const devices = document.devices ?? document;
  if (!devices || typeof devices !== "object" || Array.isArray(devices)) {
    throw new Error("device registry must contain a devices object");
  }
  for (const [deviceId, settings] of Object.entries(devices)) {
    if (!DEVICE_ID_RE.test(deviceId))
      throw new Error(`invalid device ID in registry: ${deviceId}`);
    if (!settings || typeof settings.enabled !== "boolean")
      throw new Error(`invalid registry entry for device: ${deviceId}`);
  }
  return devices;
}

export class AuthorizedDeviceRegistry {
  constructor(document = {}, filePath = null) {
    this.document = document.devices
      ? structuredClone(document)
      : { version: 1, devices: structuredClone(document) };
    const devices = validateDocument(this.document);
    this.devices = new Map();
    for (const [deviceId, settings] of Object.entries(devices)) {
      this.devices.set(deviceId, { ...settings });
    }
    this.filePath = filePath;
    this.writeQueue = Promise.resolve();
  }

  static fromFile(path) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    try {
      writeFileSync(path, '{\n  "version": 1,\n  "devices": {}\n}\n', {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    chmodSync(path, 0o600);
    const document = JSON.parse(readFileSync(path, "utf8"));
    return new AuthorizedDeviceRegistry(document, path);
  }

  reloadFromFile() {
    if (!this.filePath) throw new Error("device registry has no backing file");
    const document = JSON.parse(readFileSync(this.filePath, "utf8"));
    const devices = validateDocument(document);
    this.document = structuredClone(document);
    this.devices = new Map(
      Object.entries(devices).map(([deviceId, settings]) => [
        deviceId,
        { ...settings },
      ]),
    );
  }

  isEnabled(deviceId) {
    return this.devices.get(deviceId)?.enabled === true;
  }

  getToken(deviceId, fallbackTokens = new Map()) {
    return this.devices.get(deviceId)?.token ?? fallbackTokens.get(deviceId);
  }

  get(deviceId) {
    const record = this.devices.get(deviceId);
    return record ? this.#publicRecord(deviceId, record) : null;
  }

  list() {
    return [...this.devices].map(([deviceId, record]) =>
      this.#publicRecord(deviceId, record),
    );
  }

  async create(deviceId, deviceName = "") {
    if (!DEVICE_ID_RE.test(deviceId)) {
      throw Object.assign(new Error("invalid_device_id"), { statusCode: 400 });
    }
    if (this.devices.has(deviceId)) {
      throw Object.assign(new Error("device_already_exists"), {
        statusCode: 409,
      });
    }
    if (typeof deviceName !== "string" || deviceName.length > 128) {
      throw Object.assign(new Error("invalid_device_name"), {
        statusCode: 400,
      });
    }

    const token = randomBytes(32).toString("hex");
    return this.createWithCredential(deviceId, token, deviceName, true);
  }

  async createWithCredential(deviceId, token, deviceName = "", returnToken = false) {
    if (!DEVICE_ID_RE.test(deviceId)) {
      throw Object.assign(new Error("invalid_device_id"), { statusCode: 400 });
    }
    if (!/^[a-f0-9]{64}$/.test(token || "")) {
      throw Object.assign(new Error("invalid_device_token"), { statusCode: 400 });
    }
    if (this.devices.has(deviceId)) {
      throw Object.assign(new Error("device_already_exists"), { statusCode: 409 });
    }
    if (typeof deviceName !== "string" || deviceName.length > 128) {
      throw Object.assign(new Error("invalid_device_name"), { statusCode: 400 });
    }
    const record = { enabled: true, token };
    if (deviceName.trim()) record.deviceName = deviceName.trim();
    this.devices.set(deviceId, record);
    await this.#persistOrRollback(deviceId, null);
    return {
      deviceId,
      deviceName: record.deviceName ?? "",
      enabled: true,
      ...(returnToken ? { token } : {}),
    };
  }

  async setEnabled(deviceId, enabled) {
    const record = this.devices.get(deviceId);
    if (!record)
      throw Object.assign(new Error("device_not_found"), { statusCode: 404 });
    const previous = { ...record };
    record.enabled = enabled;
    await this.#persistOrRollback(deviceId, previous);
    return this.#publicRecord(deviceId, record);
  }

  async updateDeviceName(deviceId, deviceName) {
    const record = this.devices.get(deviceId);
    if (!record)
      throw Object.assign(new Error("device_not_found"), { statusCode: 404 });
    if (typeof deviceName !== "string" || deviceName.length > 128) {
      throw Object.assign(new Error("invalid_device_name"), {
        statusCode: 400,
      });
    }

    const previous = { ...record };
    const normalizedName = deviceName.trim();
    if (normalizedName) record.deviceName = normalizedName;
    else delete record.deviceName;
    await this.#persistOrRollback(deviceId, previous);
    return this.#publicRecord(deviceId, record);
  }

  async delete(deviceId) {
    const record = this.devices.get(deviceId);
    if (!record)
      throw Object.assign(new Error("device_not_found"), { statusCode: 404 });
    const previous = { ...record };
    this.devices.delete(deviceId);
    await this.#persistOrRollback(deviceId, previous);
  }

  async recordObservation(deviceId, metadata) {
    const record = this.devices.get(deviceId);
    if (!record) return;
    const previous = { ...record };
    Object.assign(record, {
      lastSeen: metadata.lastSeen,
      ...(record.deviceName || !metadata.deviceName
        ? {}
        : { deviceName: metadata.deviceName }),
      ...(metadata.hardware ? { hardware: metadata.hardware } : {}),
      ...(metadata.application ? { application: metadata.application } : {}),
      ...(metadata.applicationVersion
        ? { applicationVersion: metadata.applicationVersion }
        : {}),
      ...(metadata.frameworkVersion
        ? { frameworkVersion: metadata.frameworkVersion }
        : {}),
    });
    try {
      await this.#persist();
    } catch {
      this.devices.set(deviceId, previous);
    }
  }

  #publicRecord(deviceId, record) {
    const safe = { deviceId, enabled: record.enabled };
    for (const field of [
      "deviceName",
      "hardware",
      "application",
      "applicationVersion",
      "frameworkVersion",
      "lastSeen",
    ]) {
      if (record[field] !== undefined) safe[field] = record[field];
    }
    return safe;
  }

  async #persistOrRollback(deviceId, previous) {
    try {
      await this.#persist();
    } catch (error) {
      if (previous) this.devices.set(deviceId, previous);
      else this.devices.delete(deviceId);
      throw Object.assign(new Error("device_registry_write_failed"), {
        statusCode: 503,
        cause: error,
      });
    }
  }

  async #persist() {
    if (!this.filePath) return;
    const operation = async () => {
      this.document.devices = Object.fromEntries(this.devices);
      const temporary = join(
        dirname(this.filePath),
        `.devices-${process.pid}-${Date.now()}.tmp`,
      );
      await writeFile(temporary, `${JSON.stringify(this.document, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      await rename(temporary, this.filePath);
      await chmod(this.filePath, 0o600);
    };
    this.writeQueue = this.writeQueue.then(operation, operation);
    return this.writeQueue;
  }
}
