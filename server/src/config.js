export const DEVICE_ID_RE = /^esp-[a-f0-9]{6,16}$/;
const DOMAIN_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function normalizedDomain(value) {
  const domain = String(value || "link.proghard.com")
    .trim()
    .toLowerCase()
    .replace(/\.$/, "");
  if (!DOMAIN_RE.test(domain)) throw new Error("invalid_espway_domain");
  return domain;
}

export function loadConfig(env = process.env) {
  const domain = normalizedDomain(env.ESPWAY_DOMAIN);
  const tokens = new Map();
  for (const entry of (env.ESPWAY_DEVICE_TOKENS || "").split(",")) {
    const separator = entry.indexOf(":");
    if (separator > 0) {
      tokens.set(entry.slice(0, separator), entry.slice(separator + 1));
    }
  }
  const adminHost = `admin.${domain}`;
  return {
    port: Number(env.PORT || 3000),
    domain,
    baseDomain: domain,
    adminHost,
    installerHost: `install.${domain}`,
    tunnelHost: `tunnel.${domain}`,
    portalHost: domain,
    publicUrl: `https://${adminHost}`,
    enrollmentTtlMs: Number(env.ESPWAY_ENROLLMENT_TTL_MS || 600000),
    requestTimeoutMs: Number(env.ESPWAY_REQUEST_TIMEOUT_MS || 10000),
    maxBodyBytes: Number(env.ESPWAY_MAX_BODY_BYTES || 262144),
    maxOtaUploadBytes: Number(env.ESPWAY_MAX_OTA_UPLOAD_BYTES || 8388608),
    legacyOtaMaxBytes: Number(env.ESPWAY_LEGACY_OTA_MAX_BYTES || 1048576),
    otaUploadTimeoutMs: Number(env.ESPWAY_OTA_UPLOAD_TIMEOUT_MS || 120000),
    maxStreamsPerDevice: Number(env.ESPWAY_MAX_STREAMS_PER_DEVICE || 8),
    heartbeatIntervalMs: Number(env.ESPWAY_HEARTBEAT_INTERVAL_MS || 30000),
    heartbeatTimeoutMs: Number(env.ESPWAY_HEARTBEAT_TIMEOUT_MS || 60000),
    telemetryIntervalMs: Number(env.ESPWAY_TELEMETRY_INTERVAL_MS || 30000),
    telemetryTimeoutMs: Number(env.ESPWAY_TELEMETRY_TIMEOUT_MS || 4000),
    telemetryStaleAfterMs: Number(
      env.ESPWAY_TELEMETRY_STALE_AFTER_MS || 90000,
    ),
    telemetryInitialJitterMs: Number(
      env.ESPWAY_TELEMETRY_INITIAL_JITTER_MS || 5000,
    ),
    telemetryMaxConcurrentPolls: Number(
      env.ESPWAY_TELEMETRY_MAX_CONCURRENT_POLLS || 4,
    ),
    firmwareDir:
      env.ESPWAY_FIRMWARE_DIR ||
      new URL("../../firmware-repository", import.meta.url).pathname,
    downloadDir:
      env.ESPWAY_DOWNLOAD_DIR ||
      new URL("../../download-repository", import.meta.url).pathname,
    httpFirmwareOrigin:
      env.ESPWAY_HTTP_FIRMWARE_ORIGIN ||
      `http://tunnel.${domain}`,
    maxFirmwareBytes: Number(env.ESPWAY_MAX_FIRMWARE_BYTES || 8388608),
    otaOperatorToken: env.ESPWAY_OTA_OPERATOR_TOKEN || "",
    deviceRegistryFile:
      env.ESPWAY_DEVICE_REGISTRY_FILE ||
      new URL("../../data/devices.json", import.meta.url).pathname,
    authEnabled: env.ESPWAY_AUTH_ENABLED !== "0",
    authDatabaseFile:
      env.ESPWAY_AUTH_DATABASE_FILE ||
      new URL("../../data/auth.sqlite", import.meta.url).pathname,
    sessionTtlMs: Number(env.ESPWAY_SESSION_TTL_MS || 28800000),
    deviceSessionTtlMs: Number(env.ESPWAY_DEVICE_SESSION_TTL_MS || 3600000),
    tokens,
  };
}

export function deviceIdFromDomain(domain, baseDomain) {
  const normalizedDomain = String(domain || "").toLowerCase();
  const suffix = `.${baseDomain}`;

  if (!normalizedDomain.endsWith(suffix)) {
    return null;
  }

  const candidate = normalizedDomain.slice(0, -suffix.length);
  if (candidate.includes(".")) {
    return null;
  }

  return DEVICE_ID_RE.test(candidate) ? candidate : null;
}

export function deviceIdFromHost(hostHeader, baseDomain) {
  const host = String(hostHeader || "")
    .toLowerCase()
    .split(":")[0];
  const domainDeviceId = deviceIdFromDomain(host, baseDomain);
  if (domainDeviceId) {
    return domainDeviceId;
  }

  const localCandidate = host.endsWith(".localhost")
    ? host.slice(0, -10)
    : null;
  return localCandidate && DEVICE_ID_RE.test(localCandidate)
    ? localCandidate
    : null;
}
