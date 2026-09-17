import crypto from "node:crypto";
import { TUNNEL_PROTOCOL_V2 } from "./tunnel-metadata.js";

export const AUTH_PROTOCOL = "ESPWAY-AUTH-1";
export const FRAME_PROTOCOL = "ESPWAY-FRAME-1";
export const AEAD_PROTOCOL = "ESPWAY-AEAD-1";
export const AEAD_CHACHA20_POLY1305 = "CHACHA20-POLY1305";
export const AEAD_AES_128_GCM = "AES-128-GCM";

const SESSION_PROTOCOL = "ESPWAY-SESSION-1";
const C2S_LABEL = "ESPWAY-C2S-1";
const S2C_LABEL = "ESPWAY-S2C-1";
const C2S_ENC_LABEL = "ESPWAY-C2S-ENC-1";
const S2C_ENC_LABEL = "ESPWAY-S2C-ENC-1";
const C2S_AES_ENC_LABEL = "ESPWAY-C2S-AES-GCM-ENC-1";
const S2C_AES_ENC_LABEL = "ESPWAY-S2C-AES-GCM-ENC-1";
const C2S_NONCE_LABEL = "ESPWAY-C2S-NONCE-1";
const S2C_NONCE_LABEL = "ESPWAY-S2C-NONCE-1";
const FRAME_SUFFIX = ',"_espway":';
const HEX_256_RE = /^[a-f0-9]{64}$/;

function hmac(key, ...parts) {
  const context = crypto.createHmac("sha256", key);
  for (const part of parts) context.update(part);
  return context.digest();
}

function safeEqualHex(actual, expected) {
  if (!HEX_256_RE.test(actual || "")) return false;
  const decoded = Buffer.from(actual, "hex");
  return decoded.length === expected.length && crypto.timingSafeEqual(decoded, expected);
}

function canonical(protocol, deviceId, serverNonce, deviceNonce) {
  return [protocol, deviceId, serverNonce, deviceNonce].join("\n");
}

export function generateChallenge() {
  return {
    tunnelProtocol: TUNNEL_PROTOCOL_V2,
    authProtocol: AUTH_PROTOCOL,
    serverNonce: crypto.randomBytes(32).toString("hex"),
  };
}

export function computeAuthMac(token, deviceId, serverNonce, deviceNonce) {
  return hmac(
    token,
    canonical(AUTH_PROTOCOL, deviceId, serverNonce, deviceNonce),
  ).toString("hex");
}

export function verifyDeviceAuth(token, message, serverNonce) {
  if (
    !token ||
    message?.type !== "auth" ||
    message.authProtocol !== AUTH_PROTOCOL ||
    !HEX_256_RE.test(message.deviceNonce || "")
  ) {
    return false;
  }
  return safeEqualHex(
    message.authMac,
    hmac(
      token,
      canonical(
        AUTH_PROTOCOL,
        message.deviceId,
        serverNonce,
        message.deviceNonce,
      ),
    ),
  );
}

export function deriveSessionKeys(token, deviceId, serverNonce, deviceNonce) {
  const sessionMaster = hmac(
    token,
    canonical(SESSION_PROTOCOL, deviceId, serverNonce, deviceNonce),
  );
  const keys = {
    c2sKey: hmac(sessionMaster, C2S_LABEL),
    s2cKey: hmac(sessionMaster, S2C_LABEL),
    c2sEncryptionKey: hmac(sessionMaster, C2S_ENC_LABEL),
    s2cEncryptionKey: hmac(sessionMaster, S2C_ENC_LABEL),
    c2sAesEncryptionKey: hmac(sessionMaster, C2S_AES_ENC_LABEL).subarray(0, 16),
    s2cAesEncryptionKey: hmac(sessionMaster, S2C_AES_ENC_LABEL).subarray(0, 16),
    c2sNoncePrefix: hmac(sessionMaster, C2S_NONCE_LABEL).subarray(0, 4),
    s2cNoncePrefix: hmac(sessionMaster, S2C_NONCE_LABEL).subarray(0, 4),
  };
  sessionMaster.fill(0);
  return keys;
}

export function isSensitiveRequest(method, path) {
  return method === "POST" && (
    path === "/setup/save" ||
    path === "/config/save" ||
    path === "/api/espway/mqtt" ||
    /^\/api\/espway\/wifi\/profile\/[12]$/.test(path)
  );
}

function aeadAad(direction, sequence, context) {
  return Buffer.from([
    AEAD_PROTOCOL,
    direction,
    sequence.toString(),
    context.streamId,
    context.type,
    context.method || "",
    context.path || "",
  ].join("\n"));
}

function aeadNonce(prefix, sequence) {
  const nonce = Buffer.alloc(12);
  prefix.copy(nonce, 0);
  nonce.writeBigUInt64BE(sequence, 4);
  return nonce;
}

function cipherParameters(session, direction, algorithm) {
  if (algorithm === AEAD_AES_128_GCM) {
    return {
      nodeAlgorithm: "aes-128-gcm",
      key: direction === "C2S"
        ? session.c2sAesEncryptionKey
        : session.s2cAesEncryptionKey,
    };
  }
  if (algorithm === AEAD_CHACHA20_POLY1305) {
    return {
      nodeAlgorithm: "chacha20-poly1305",
      key: direction === "C2S"
        ? session.c2sEncryptionKey
        : session.s2cEncryptionKey,
    };
  }
  return null;
}

export function encryptPayload(
  session,
  direction,
  context,
  plaintext,
  algorithm = AEAD_CHACHA20_POLY1305,
) {
  const sequence = session.sendSequence;
  const parameters = cipherParameters(session, direction, algorithm);
  if (!parameters?.key) throw new Error("unsupported sensitive payload cipher");
  const prefix = direction === "C2S" ? session.c2sNoncePrefix : session.s2cNoncePrefix;
  const cipher = crypto.createCipheriv(parameters.nodeAlgorithm, parameters.key, aeadNonce(prefix, sequence), {
    authTagLength: 16,
  });
  cipher.setAAD(aeadAad(direction, sequence, context));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    version: AEAD_PROTOCOL,
    algorithm,
    ciphertext: ciphertext.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptPayload(session, direction, sequence, context, envelope) {
  if (envelope?.version !== AEAD_PROTOCOL) return null;
  try {
    const parameters = cipherParameters(session, direction, envelope.algorithm);
    if (!parameters?.key) return null;
    const prefix = direction === "C2S" ? session.c2sNoncePrefix : session.s2cNoncePrefix;
    const tag = Buffer.from(envelope.tag || "", "base64");
    if (tag.length !== 16) return null;
    const decipher = crypto.createDecipheriv(
      parameters.nodeAlgorithm,
      parameters.key,
      aeadNonce(prefix, sequence),
      { authTagLength: 16 },
    );
    decipher.setAAD(aeadAad(direction, sequence, context));
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext || "", "base64")),
      decipher.final(),
    ]);
  } catch {
    return null;
  }
}

function frameMac(key, direction, sequence, original) {
  const header = [
    FRAME_PROTOCOL,
    direction,
    sequence.toString(),
    original.length.toString(),
    "",
  ].join("\n");
  return hmac(key, header, original);
}

export function signFrame(session, direction, message) {
  const key = direction === "C2S" ? session.c2sKey : session.s2cKey;
  const sequence = session.sendSequence;
  const original = Buffer.from(JSON.stringify(message));
  if (original.at(-1) !== 0x7d) throw new Error("frame must be a JSON object");
  const mac = frameMac(key, direction, sequence, original).toString("hex");
  const envelope = Buffer.from(
    `${FRAME_SUFFIX}{"version":"${FRAME_PROTOCOL}",` +
      `"sequence":"${sequence}","mac":"${mac}"}}`,
  );
  session.sendSequence++;
  return Buffer.concat([original.subarray(0, -1), envelope]);
}

export function verifyFrame(session, direction, raw, maxBytes) {
  const wire = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
  if (wire.length === 0 || wire.length > maxBytes) return null;
  const suffixOffset = wire.lastIndexOf(FRAME_SUFFIX);
  if (suffixOffset <= 0) return null;

  let message;
  try {
    message = JSON.parse(wire.toString("utf8"));
  } catch {
    return null;
  }
  const envelope = message?._espway;
  if (
    envelope?.version !== FRAME_PROTOCOL ||
    !/^[1-9][0-9]{0,19}$/.test(envelope.sequence || "")
  ) {
    return null;
  }

  const sequence = BigInt(envelope.sequence);
  if (sequence !== session.expectedReceiveSequence) return null;
  const original = Buffer.concat([
    wire.subarray(0, suffixOffset),
    Buffer.from("}"),
  ]);
  const key = direction === "C2S" ? session.c2sKey : session.s2cKey;
  if (!safeEqualHex(envelope.mac, frameMac(key, direction, sequence, original))) {
    return null;
  }

  session.expectedReceiveSequence++;
  delete message._espway;
  return message;
}

export function clearSession(session) {
  session.c2sKey?.fill(0);
  session.s2cKey?.fill(0);
  session.c2sEncryptionKey?.fill(0);
  session.s2cEncryptionKey?.fill(0);
  session.c2sAesEncryptionKey?.fill(0);
  session.s2cAesEncryptionKey?.fill(0);
  session.c2sNoncePrefix?.fill(0);
  session.s2cNoncePrefix?.fill(0);
  session.c2sKey = null;
  session.s2cKey = null;
  session.c2sEncryptionKey = null;
  session.s2cEncryptionKey = null;
  session.c2sAesEncryptionKey = null;
  session.s2cAesEncryptionKey = null;
  session.c2sNoncePrefix = null;
  session.s2cNoncePrefix = null;
  session.sendSequence = 1n;
  session.expectedReceiveSequence = 1n;
}
