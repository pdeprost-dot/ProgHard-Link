import crypto from "node:crypto";
import {
  AEAD_AES_128_GCM,
  AEAD_CHACHA20_POLY1305,
  encryptPayload,
  isSensitiveRequest,
} from "./protocol.js";

function sensitiveCipher(device) {
  const capabilities = device.capabilities || [];
  if (capabilities.includes("aead-aes-128-gcm")) return AEAD_AES_128_GCM;
  if (
    capabilities.includes("aead-chacha20-poly1305") ||
    capabilities.includes("aead-selective")
  ) return AEAD_CHACHA20_POLY1305;
  return null;
}

export class TunnelBroker {
  constructor({ timeoutMs, maxStreamsPerDevice }) {
    this.timeoutMs = timeoutMs;
    this.maxStreamsPerDevice = maxStreamsPerDevice;
    this.pending = new Map();
  }

  activeCount(deviceId) {
    return [...this.pending.values()].filter(
      (pending) => pending.deviceId === deviceId,
    ).length;
  }

  async request(device, request, options = {}) {
    const active = this.activeCount(device.deviceId);
    if (active >= this.maxStreamsPerDevice)
      throw Object.assign(new Error("device busy"), { statusCode: 503 });
    const streamId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(streamId);
        try {
          this.send(device.socket, {
            type: "cancel",
            streamId,
            reason: "timeout",
          });
        } catch {
          // The request still times out normally when the device socket closed.
        }
        reject(Object.assign(new Error("device timeout"), { statusCode: 504 }));
      }, options.timeoutMs ?? this.timeoutMs);
      this.pending.set(streamId, {
        deviceId: device.deviceId,
        status: 200,
        headers: {},
        chunks: [],
        resolve,
        reject,
        timer,
      });
      const openFrame = {
        type: "open",
        streamId,
        method: request.method,
        path: request.path,
        headers: request.headers,
      };
      const sensitive = isSensitiveRequest(request.method, request.path);
      if (sensitive) {
        const algorithm = sensitiveCipher(device);
        if (!algorithm) {
          clearTimeout(timer);
          this.pending.delete(streamId);
          return reject(Object.assign(
            new Error("device does not advertise sensitive payload encryption"),
            { statusCode: 503 },
          ));
        }
        openFrame.sensitive = true;
        openFrame.aead = encryptPayload(
          device.socket.espwaySession,
          "S2C",
          openFrame,
          request.body,
          algorithm,
        );
      }
      this.send(device.socket, openFrame);
      if (request.body.length && !sensitive)
        this.send(device.socket, {
          type: "data",
          streamId,
          data: request.body.toString("base64"),
        });
      this.send(device.socket, { type: "close", streamId });
    });
  }

  async streamRequest(device, request, chunks, options = {}) {
    if (this.activeCount(device.deviceId) >= this.maxStreamsPerDevice) {
      throw Object.assign(new Error("device busy"), { statusCode: 503 });
    }
    const streamId = crypto.randomUUID();
    let finish;
    const response = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(streamId);
        reject(Object.assign(new Error("ota timeout"), { statusCode: 504 }));
      }, options.timeoutMs ?? this.timeoutMs);
      this.pending.set(streamId, {
        deviceId: device.deviceId,
        status: 200,
        headers: {},
        chunks: [],
        resolve,
        reject,
        timer,
        ack: null,
      });
      finish = reject;
    });
    try {
      const waitForAck = (pending, expected, timeoutMs = 5000) => new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(Object.assign(
            new Error("ota ack timeout"),
            { statusCode: 504 },
          )),
          timeoutMs,
        );
        pending.ack = (received, error) => {
          clearTimeout(timer);
          if (error) return reject(error);
          if (received !== expected) {
            return reject(Object.assign(
              new Error("invalid ota ack"),
              { statusCode: 502 },
            ));
          }
          resolve();
        };
      });
      let sent = 0;
      let pending = this.pending.get(streamId);
      // The device erases its next OTA partition before acknowledging OPEN.
      const opened = waitForAck(pending, 0, 30000);
      this.send(device.socket, {
        type: "open",
        streamId,
        method: request.method,
        path: request.path,
        headers: request.headers,
        otaSize: request.otaSize,
        otaSha256: request.otaSha256,
        otaProof: request.otaProof,
      });
      await opened;
      for await (const chunk of chunks) {
        pending = this.pending.get(streamId);
        if (!pending) {
          throw Object.assign(
            new Error("ota interrupted"),
            { statusCode: 503 },
          );
        }
        const acknowledged = waitForAck(pending, sent + chunk.length);
        this.send(device.socket, {
          type: "data",
          streamId,
          data: chunk.toString("base64"),
        });
        await acknowledged;
        sent += chunk.length;
      }
      if (sent !== request.otaSize) {
        throw Object.assign(
          new Error("ota size mismatch"),
          { statusCode: 400 },
        );
      }
      this.send(device.socket, { type: "close", streamId });
      return await response;
    } catch (error) {
      const pending = this.pending.get(streamId);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(streamId);
      }
      try {
        this.send(device.socket, {
          type: "cancel",
          streamId,
          reason: "upload aborted",
        });
      } catch {
        // The device may already be offline; local cleanup still completes.
      }
      finish(error);
      response.catch(() => {});
      throw error;
    }
  }

  receive(deviceId, message) {
    const stream = this.pending.get(message.streamId);
    if (!stream || stream.deviceId !== deviceId) return false;
    if (message.type === "ack") {
      const acknowledge = stream.ack;
      stream.ack = null;
      if (!acknowledge) return false;
      acknowledge(Number(message.received));
    } else if (message.type === "open") {
      stream.status = Number(message.status || 200);
      stream.headers = message.headers || {};
    } else if (message.type === "data") {
      stream.chunks.push(Buffer.from(message.data || "", "base64"));
    } else if (message.type === "close") {
      clearTimeout(stream.timer);
      this.pending.delete(message.streamId);
      stream.ack?.(
        null,
        Object.assign(new Error("ota rejected"), { statusCode: stream.status }),
      );
      stream.ack = null;
      stream.resolve({
        status: stream.status,
        headers: stream.headers,
        body: Buffer.concat(stream.chunks),
      });
    }
    return true;
  }

  disconnect(deviceId) {
    for (const [id, stream] of this.pending)
      if (stream.deviceId === deviceId) {
        clearTimeout(stream.timer);
        this.pending.delete(id);
        stream.ack?.(
          null,
          Object.assign(new Error("device disconnected"), { statusCode: 503 }),
        );
        stream.ack = null;
        stream.reject(
          Object.assign(new Error("device disconnected"), { statusCode: 503 }),
        );
      }
  }

  send(socket, message) {
    if (socket.readyState !== 1)
      throw Object.assign(new Error("device offline"), { statusCode: 503 });
    if (typeof socket.espwaySend !== "function")
      throw Object.assign(new Error("device session unavailable"), {
        statusCode: 503,
      });
    socket.espwaySend(message);
  }
}
