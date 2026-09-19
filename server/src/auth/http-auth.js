import { BlockList, isIP } from "node:net";

export const SESSION_COOKIE = "espway_session";
export const DEVICE_COOKIE = "espway_device_session";

const dockerPeers = new BlockList();
dockerPeers.addSubnet("10.0.0.0", 8);
dockerPeers.addSubnet("172.16.0.0", 12);
dockerPeers.addSubnet("192.168.0.0", 16);

function trustedProxyPeer(address) {
  const ipv4 = address?.startsWith("::ffff:") ? address.slice(7) : address;
  return isIP(ipv4) === 4 && dockerPeers.check(ipv4);
}

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
  const peer = req.socket.remoteAddress || "unknown";
  const forwarded = req.headers["x-forwarded-for"];
  return trustedProxyPeer(peer) && typeof forwarded === "string" && isIP(forwarded)
    ? forwarded : peer;
}

export function bearer(req) {
  const match = /^Bearer ([A-Za-z0-9_-]+)$/.exec(String(req.headers.authorization || ""));
  return match?.[1] || null;
}
