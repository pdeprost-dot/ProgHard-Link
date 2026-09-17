import { randomBytes } from "node:crypto";
import { DEVICE_ID_RE } from "./config.js";

const fail = (message, statusCode) =>
  Object.assign(new Error(message), { statusCode });

export class EnrollmentService {
  constructor({ ttlMs = 10 * 60 * 1000, maximumPending = 100, now = Date.now } = {}) {
    this.ttlMs = ttlMs;
    this.maximumPending = maximumPending;
    this.now = now;
    this.pending = new Map();
    this.byDevice = new Map();
  }

  create(input, authorizedDevices, publicUrl, baseDomain) {
    this.#prune();
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw fail("invalid_enrollment", 400);
    if (!DEVICE_ID_RE.test(input.deviceId || ""))
      throw fail("invalid_device_id", 400);
    if (authorizedDevices.isEnabled(input.deviceId))
      throw fail("device_already_registered", 409);
    if (!/^[a-f0-9]{64}$/.test(input.credential || ""))
      throw fail("invalid_device_credential", 400);
    for (const field of ["deviceName", "hardware", "application", "applicationVersion", "frameworkVersion"]) {
      if (input[field] !== undefined &&
          (typeof input[field] !== "string" || input[field].length > 128))
        throw fail("invalid_enrollment", 400);
    }
    const previous = this.byDevice.get(input.deviceId);
    if (previous) this.pending.delete(previous);
    if (this.pending.size >= this.maximumPending)
      throw fail("enrollment_capacity_reached", 503);

    const token = randomBytes(32).toString("base64url");
    const record = {
      token,
      deviceId: input.deviceId,
      deviceName: input.deviceName?.trim() || "",
      hardware: input.hardware || "",
      application: input.application || "",
      applicationVersion: input.applicationVersion || "",
      frameworkVersion: input.frameworkVersion || "",
      credential: input.credential,
      createdAt: this.now(),
      expiresAt: this.now() + this.ttlMs,
    };
    this.pending.set(token, record);
    this.byDevice.set(record.deviceId, token);
    return {
      claimUrl: `${publicUrl}/enroll/${encodeURIComponent(token)}`,
      expiresInSeconds: Math.floor(this.ttlMs / 1000),
      baseDomain,
    };
  }

  inspect(token) {
    const record = this.#get(token);
    return {
      deviceId: record.deviceId,
      deviceName: record.deviceName,
      hardware: record.hardware,
      application: record.application,
      applicationVersion: record.applicationVersion,
      frameworkVersion: record.frameworkVersion,
      expiresAt: new Date(record.expiresAt).toISOString(),
    };
  }

  async claim(token, user, authorizedDevices, auth, sourceIp) {
    const record = this.#get(token);
    if (authorizedDevices.isEnabled(record.deviceId)) {
      this.#consume(record);
      throw fail("device_already_registered", 409);
    }
    try {
      await authorizedDevices.createWithCredential(
        record.deviceId,
        record.credential,
        record.deviceName,
      );
      try {
        auth.assignDevice(user.id, record.deviceId);
      } catch (error) {
        await authorizedDevices.delete(record.deviceId);
        throw error;
      }
      auth.audit(user, "device.enroll", "device", record.deviceId, "success", sourceIp);
      this.#consume(record);
      return { deviceId: record.deviceId, deviceName: record.deviceName };
    } catch (error) {
      if (error.statusCode) throw error;
      throw fail("enrollment_failed", 500);
    }
  }

  #get(token) {
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token))
      throw fail("enrollment_not_found", 404);
    const record = this.pending.get(token);
    if (!record) throw fail("enrollment_not_found", 404);
    if (record.expiresAt <= this.now()) {
      this.#consume(record);
      throw fail("enrollment_expired", 410);
    }
    return record;
  }

  #consume(record) {
    this.pending.delete(record.token);
    if (this.byDevice.get(record.deviceId) === record.token)
      this.byDevice.delete(record.deviceId);
  }

  #prune() {
    for (const record of this.pending.values())
      if (record.expiresAt <= this.now()) this.#consume(record);
  }
}
