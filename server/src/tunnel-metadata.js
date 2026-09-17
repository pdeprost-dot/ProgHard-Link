export const TUNNEL_PROTOCOL_V2 = "espway-tunnel/2";

const KNOWN_CAPABILITIES = new Set([
  "aead-selective",
  "aead-chacha20-poly1305",
  "aead-aes-128-gcm",
  "http-ota",
  "mqtt",
]);
const MAX_CAPABILITIES = 8;
const MAX_CAPABILITY_LENGTH = 32;
const MAX_METADATA_LENGTH = 128;

function validText(value, maximum = MAX_METADATA_LENGTH) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum
  );
}

export function parseSignedHello(message, expectedDeviceId) {
  if (
    message?.type !== "hello" ||
    message.tunnelProtocol !== TUNNEL_PROTOCOL_V2 ||
    message.deviceId !== expectedDeviceId ||
    !validText(message.deviceName) ||
    !validText(message.hardware, 32) ||
    !validText(message.application, 64) ||
    !validText(message.applicationVersion, 32) ||
    !validText(message.frameworkVersion, 32) ||
    !Array.isArray(message.capabilities) ||
    message.capabilities.length > MAX_CAPABILITIES
  ) {
    return null;
  }

  const seen = new Set();
  const capabilities = [];
  for (const capability of message.capabilities) {
    if (
      !validText(capability, MAX_CAPABILITY_LENGTH) ||
      seen.has(capability)
    ) {
      return null;
    }
    seen.add(capability);
    if (KNOWN_CAPABILITIES.has(capability)) capabilities.push(capability);
  }

  return {
    deviceName: message.deviceName,
    hardware: message.hardware,
    application: message.application,
    applicationVersion: message.applicationVersion,
    firmwareVersion: message.applicationVersion,
    frameworkVersion: message.frameworkVersion,
    capabilities,
    metadataVerified: true,
  };
}

export function supportsHttpOta(device) {
  return Boolean(
    device?.connected &&
      device.transport === "ws-hmac" &&
      device.tunnelProtocol === TUNNEL_PROTOCOL_V2 &&
      device.metadataVerified === true &&
      device.capabilities?.includes("http-ota"),
  );
}
