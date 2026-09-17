import { createHmac } from "node:crypto";

export const OTA_KEY_LABEL = "ESPWAY-OTA-KEY-1";
export const OTA_AUTH_LABEL = "ESPWAY-OTA-AUTH-1";

export function deriveOtaKey(deviceToken) {
  return createHmac("sha256", deviceToken).update(OTA_KEY_LABEL, "utf8").digest();
}

export function otaAuthorizationMessage({ deviceId, nonce, size, sha256 }) {
  return [
    OTA_AUTH_LABEL,
    String(deviceId),
    String(nonce),
    String(size),
    String(sha256).toLowerCase(),
  ].join("\n");
}

export function computeOtaProof(deviceToken, metadata) {
  return createHmac("sha256", deriveOtaKey(deviceToken))
    .update(otaAuthorizationMessage(metadata), "utf8")
    .digest();
}
