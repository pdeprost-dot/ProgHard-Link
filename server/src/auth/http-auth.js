export const SESSION_COOKIE = "espway_session";
export const DEVICE_COOKIE = "espway_device_session";

export function parseCookies(req) {
  const result = {};
  for (const item of String(req.headers.cookie || "").split(";")) {
    const separator = item.indexOf("=");
    if (separator > 0) result[item.slice(0, separator).trim()] = decodeURIComponent(item.slice(separator + 1).trim());
  }
  return result;
}

export function cookie(name, value, { maxAge = 0 } = {}) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Strict${maxAge ? `; Max-Age=${maxAge}` : ""}`;
}

export function requestIp(req) {
  return req.socket.remoteAddress || "unknown";
}

export function bearer(req) {
  const match = /^Bearer ([A-Za-z0-9_-]+)$/.exec(String(req.headers.authorization || ""));
  return match?.[1] || null;
}
