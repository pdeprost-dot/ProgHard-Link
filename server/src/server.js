import http from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { AuthorizedDeviceRegistry } from "./authorized-devices.js";
import {
  deviceIdFromDomain,
  deviceIdFromHost,
} from "./config.js";
import { DeviceRegistry } from "./registry.js";
import { DeviceManager } from "./device-manager.js";
import { TunnelBroker } from "./tunnel.js";
import { TelemetryService } from "./telemetry.js";
import { prepareRegistryOtaCommand } from "./ota-command.js";
import {
  attachAuthenticatedTunnel,
  attachWebSocketHeartbeat,
} from "./authenticated-tunnel.js";
import {
  FirmwareRegistry,
  publicManifest,
} from "./firmware-registry.js";
import { supportsHttpOta } from "./tunnel-metadata.js";
import { firmwareParts, multipartBoundary } from "./ota-upload.js";
import { computeOtaProof } from "./ota-authorization.js";
import {
  ArduinoDownloadRepository,
  portalHtml,
} from "./arduino-downloads.js";
import { openAuthDatabase } from "./auth/database.js";
import { AuthService } from "./auth/auth-service.js";
import { EnrollmentService } from "./enrollment-service.js";
import { bearer, cookie, DEVICE_COOKIE, parseCookies, requestIp, SESSION_COOKIE } from "./auth/http-auth.js";

const PUBLIC = fileURLToPath(new URL("../public/", import.meta.url));
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
};
async function readBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit)
      throw Object.assign(new Error("request too large"), { statusCode: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function send(res, status, body, type = "text/plain; charset=utf-8", extraHeaders = {}) {
  res.writeHead(status, {
    "content-type": type,
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "content-security-policy": [
      "default-src 'self'",
      "style-src 'self'",
      "script-src 'self'",
      "connect-src 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    ...extraHeaders,
  });
  res.end(body);
}

function sendJson(res, status, value) {
  return send(res, status, JSON.stringify(value), "application/json");
}

function requestHost(req) {
  return String(req.headers.host || "").toLowerCase().split(":")[0];
}

function validAdminOrigin(req, adminHost) {
  if (req.headers["x-espway-admin-request"] !== "1") return false;
  const source = req.headers.origin || req.headers.referer;
  if (!source) return true;
  try {
    return new URL(source).hostname.toLowerCase() === adminHost;
  } catch {
    return false;
  }
}

function validAdminWrite(req, adminHost) {
  return String(req.headers["content-type"] || "").toLowerCase()
    .startsWith("application/json") && validAdminOrigin(req, adminHost);
}

function operatorAuthorized(req, expectedToken) {
  const suppliedToken = req.headers["x-espway-operator-token"];
  if (
    !expectedToken ||
    typeof suppliedToken !== "string" ||
    suppliedToken.length === 0
  ) {
    return false;
  }

  const expectedDigest = createHash("sha256").update(expectedToken).digest();
  const suppliedDigest = createHash("sha256").update(suppliedToken).digest();
  return timingSafeEqual(expectedDigest, suppliedDigest);
}

export function createEspwayServer(config) {
  config.domain ??= config.baseDomain;
  config.baseDomain = config.domain;
  config.portalHost ??= config.domain;
  config.adminHost ??= `admin.${config.domain}`;
  config.installerHost ??= `install.${config.domain}`;
  config.tunnelHost ??= `tunnel.${config.domain}`;
  const registry = new DeviceRegistry();
  const authorizedDevices =
    config.authorizedDevices ??
    AuthorizedDeviceRegistry.fromFile(config.deviceRegistryFile);
  const broker = new TunnelBroker({
    timeoutMs: config.requestTimeoutMs,
    maxStreamsPerDevice: config.maxStreamsPerDevice,
  });
  const activeOtaUploads = new Set();
  const firmwareRegistry =
    config.firmwareRegistry ?? new FirmwareRegistry(config.firmwareDir);
  const arduinoDownloads = config.arduinoDownloads ??
    new ArduinoDownloadRepository(
      config.downloadDir ??
        new URL("../../download-repository", import.meta.url).pathname,
    );
  const telemetry = config.telemetry ?? new TelemetryService({
    registry,
    broker,
    intervalMs: config.telemetryIntervalMs,
    timeoutMs: config.telemetryTimeoutMs,
    staleAfterMs: config.telemetryStaleAfterMs,
    initialJitterMs: config.telemetryInitialJitterMs,
    maxConcurrentPolls: config.telemetryMaxConcurrentPolls,
  });
  const deviceManager = new DeviceManager({
    registry,
    authorizedDevices,
    firmwareRegistry,
    broker,
    telemetry,
    config,
  });
  const enrollments = config.enrollmentService ?? new EnrollmentService({
    ttlMs: config.enrollmentTtlMs ?? 600000,
  });
  let auth = config.authService ?? null;
  let authError = null;
  if (config.authEnabled && !auth) {
    try {
      auth = new AuthService(openAuthDatabase(config.authDatabaseFile), {
        sessionTtlMs: config.sessionTtlMs,
        deviceSessionTtlMs: config.deviceSessionTtlMs,
      });
    } catch (error) {
      authError = error;
      console.error("ProgHard Link human authentication unavailable:", error.message);
    }
  }
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://espway.internal");
      if (url.pathname === "/internal/tls-ask") {
        if (req.method !== "GET") {
          return send(res, 405, "method not allowed");
        }

        const requestedDomain = url.searchParams.get("domain");
        const infrastructureHosts = new Set([
          config.portalHost,
          config.installerHost,
          config.adminHost,
        ]);
        if (infrastructureHosts.has(requestedDomain?.toLowerCase())) {
          return send(res, 200, "allowed");
        }

        const deviceId = deviceIdFromDomain(requestedDomain, config.baseDomain);
        if (!deviceId || !authorizedDevices.isEnabled(deviceId)) {
          return send(res, 403, "denied");
        }

        return send(res, 200, "allowed");
      }

      if (req.url === "/health") return send(res, 200, "ok");

      const host = requestHost(req);
      if (host === config.portalHost) {
        return servePortal(req, res, url, arduinoDownloads, config);
      } else if (host === config.adminHost) {
        if (url.pathname === "/api/enrollments" && req.method === "POST") {
          if (!String(req.headers["content-type"] || "").toLowerCase().startsWith("application/json"))
            return sendJson(res, 415, { error: "json_required" });
          let input;
          try { input = JSON.parse((await readBody(req, 4096)).toString("utf8")); }
          catch { return sendJson(res, 400, { error: "invalid_json" }); }
          try {
            return sendJson(res, 201, enrollments.create(
              input, authorizedDevices,
              config.publicUrl ?? `https://${config.adminHost}`,
              config.baseDomain,
            ));
          } catch (error) {
            return sendJson(res, error.statusCode || 500, { error: error.message });
          }
        }
        if (config.authEnabled) {
          if (!auth || authError || auth.userCount() === 0)
            return sendJson(res, 503, { error: "authentication_unavailable" });
          const authHandled = await serveAuth(req, res, url, auth, config);
          if (authHandled) return;
          const session = auth.session(parseCookies(req)[SESSION_COOKIE]);
          if (!session) {
            if (url.pathname.startsWith("/api/")) return sendJson(res, 401, { error: "authentication_required" });
            res.writeHead(303, { location: `/login?next=${encodeURIComponent(url.pathname + url.search)}` });
            return res.end();
          }
          req.espwayUser = session.user;
          req.espwayCsrf = session.csrf;
        }
        const enrollmentHandled = await serveEnrollment(
          req, res, url, enrollments, authorizedDevices, auth, config,
        );
        if (enrollmentHandled) return;
        const uploadMatch = /^\/api\/admin\/devices\/(esp-[a-f0-9]{6,16})\/ota-upload$/.exec(url.pathname);
        if (uploadMatch) {
          const deviceId = uploadMatch[1];
          if (req.method !== "POST") return sendJson(res, 405, { error: "method_not_allowed" });
          if (!validAdminOrigin(req, config.adminHost) ||
              (auth && req.headers["x-espway-csrf"] !== req.espwayCsrf))
            return sendJson(res, 403, { error: "admin_request_rejected" });
          if (auth && !auth.canAccessDevice(req.espwayUser, deviceId))
            return sendJson(res, 404, { error: "device_not_found" });
          const boundary = multipartBoundary(req.headers["content-type"]);
          const otaSize = Number(req.headers["x-espway-ota-size"]);
          const otaSha256 = String(req.headers["x-espway-ota-sha256"] || "").toLowerCase();
          const device = registry.get(deviceId);
          const deviceCapacity = Number.isSafeInteger(device?.otaMaxBytes)
            ? device.otaMaxBytes : (config.legacyOtaMaxBytes ?? 1048576);
          const effectiveMaximum = Math.min(config.maxOtaUploadBytes ?? 8388608, deviceCapacity);
          if (!device?.connected) return sendJson(res, 409, { error: "device_offline" });
          if (!supportsHttpOta(device)) return sendJson(res, 409, { error: "http_ota_not_supported" });
          if (activeOtaUploads.has(deviceId)) return sendJson(res, 409, { error: "ota_already_active" });
          if (!boundary || !Number.isSafeInteger(otaSize) || otaSize <= 0 ||
              !/^[a-f0-9]{64}$/.test(otaSha256))
            return sendJson(res, 400, { error: "invalid_ota_upload" });
          if (otaSize > effectiveMaximum)
            return sendJson(res, 413, { error: "firmware_exceeds_ota_capacity", otaMaxBytes: effectiveMaximum });
          const deviceToken = authorizedDevices.getToken(deviceId, config.tokens);
          if (!deviceToken) return sendJson(res, 503, { error: "device_credential_unavailable" });
          activeOtaUploads.add(deviceId);
          try {
            const challenge = await broker.request(device, {
              method: "GET", path: "/api/ota/challenge", headers: {}, body: Buffer.alloc(0),
            });
            if (challenge.status !== 200) return sendJson(res, challenge.status, { error: "ota_challenge_failed" });
            let nonce;
            try { nonce = JSON.parse(challenge.body.toString("utf8")).nonce; } catch {}
            if (typeof nonce !== "string" || nonce.length === 0)
              return sendJson(res, 502, { error: "invalid_ota_challenge" });
            const otaProof = computeOtaProof(deviceToken, {
              deviceId, nonce, size: otaSize, sha256: otaSha256,
            }).toString("hex");
            const result = await broker.streamRequest(device, {
              method: "POST", path: "/ota/upload", headers: { "content-type": "application/octet-stream" },
              otaSize, otaSha256, otaProof,
            }, firmwareParts(req, boundary, effectiveMaximum), {
              timeoutMs: config.otaUploadTimeoutMs,
            });
            if (result.status >= 200 && result.status < 300)
              return sendJson(res, result.status, {
                status: "validated", size: otaSize, sha256: otaSha256,
              });
            res.writeHead(result.status, filterHeaders(result.headers));
            return res.end(result.body);
          } finally {
            activeOtaUploads.delete(deviceId);
          }
        }
        const handled = await serveDeviceManager(
          req,
          res,
          url,
          deviceManager,
          config, auth,
        );
        if (handled) return;
      } else if (
        url.pathname === "/devices" ||
        url.pathname.startsWith("/devices/") ||
        url.pathname.startsWith("/api/admin/") ||
        url.pathname.startsWith("/admin")
      ) {
        return send(res, 404, "not found");
      }
      if (
        url.pathname === "/api/firmware" ||
        url.pathname.startsWith("/api/firmware/")
      ) {
        const registryHosts = new Set([
          config.adminHost,
          config.tunnelHost,
        ]);
        if (!registryHosts.has(host)) return send(res, 404, "not found");
        return serveFirmwareApi(req, res, url.pathname, firmwareRegistry);
      }
      if (url.pathname.startsWith("/firmware/"))
        return serveRegistryFirmware(req, res, url.pathname, firmwareRegistry);

      const deviceId = deviceIdFromHost(req.headers.host, config.baseDomain);
      if (!deviceId) return send(res, 404, "ProgHard Link device host not found");
      if (config.authEnabled) {
        if (!auth || authError || auth.userCount() === 0) return send(res, 503, "authentication unavailable");
        if (url.pathname === "/_espway/access" && req.method === "POST") {
          const contentType = String(req.headers["content-type"] || "").split(";", 1)[0];
          if (contentType !== "application/x-www-form-urlencoded") return send(res, 415, "unsupported media type");
          const form = new URLSearchParams((await readBody(req, 4096)).toString("utf8"));
          const deviceToken = auth.consumeAccessTicket(form.get("ticket"), deviceId);
          if (!deviceToken) return send(res, 401, "invalid or expired access ticket");
          const target = safeRedirectPath(form.get("next"));
          res.writeHead(303, {
            location: target,
            "set-cookie": cookie(DEVICE_COOKIE, deviceToken, { maxAge: Math.floor(config.deviceSessionTtlMs / 1000) }),
            "cache-control": "no-store",
          });
          return res.end();
        }
        const apiUser = auth.authenticateBearer(bearer(req));
        const browserUser = auth.authenticateDeviceSession(parseCookies(req)[DEVICE_COOKIE], deviceId);
        const remoteUser = apiUser || browserUser;
        if (!remoteUser) return send(res, 401, "authentication required");
        if (!auth.canAccessDevice(remoteUser, deviceId)) return send(res, 404, "device not found");
        req.espwayUser = remoteUser;
      }
      const device = registry.get(deviceId);
      if (!device?.connected)
        return send(
          res,
          503,
          `<!doctype html><h1>ProgHard Link device unavailable</h1><p>${deviceId} is currently offline.</p>`,
          "text/html; charset=utf-8",
        );
      if (req.method === "POST" && req.url === "/ota/upload") {
        if (activeOtaUploads.has(deviceId))
          return send(res, 409, "ota already active");
        const boundary = multipartBoundary(req.headers["content-type"]);
        const otaSize = Number(req.headers["x-espway-ota-size"]);
        const otaSha256 = String(req.headers["x-espway-ota-sha256"] || "");
        const otaProof = String(req.headers["x-espway-ota-proof"] || "");
        const deviceCapacity = Number.isSafeInteger(device.otaMaxBytes)
          ? device.otaMaxBytes : (config.legacyOtaMaxBytes ?? 1048576);
        const effectiveMaximum = Math.min(config.maxOtaUploadBytes ?? 8388608, deviceCapacity);
        if (!boundary || !Number.isSafeInteger(otaSize) || otaSize <= 0 ||
            otaSize > effectiveMaximum || !/^[a-f0-9]{64}$/.test(otaSha256) ||
            !/^[a-f0-9]{64}$/.test(otaProof))
          return send(res, 400, "invalid ota upload");
        activeOtaUploads.add(deviceId);
        try {
          const result = await broker.streamRequest(device, {
            method: req.method, path: req.url, headers: filterHeaders(req.headers),
            otaSize, otaSha256, otaProof,
          }, firmwareParts(req, boundary, effectiveMaximum), {
            timeoutMs: config.otaUploadTimeoutMs,
          });
          res.writeHead(result.status, filterHeaders(result.headers));
          res.end(result.body);
        } finally {
          activeOtaUploads.delete(deviceId);
        }
        return;
      }
      let body = await readBody(req, config.maxBodyBytes);
      if (
        req.method === "POST" &&
        req.url === "/api/ota/remote"
      ) {
        if (!config.otaOperatorToken) {
          return send(
            res,
            503,
            JSON.stringify({ error: "ota_operator_authorization_disabled" }),
            "application/json",
          );
        }
        if (!operatorAuthorized(req, config.otaOperatorToken)) {
          return send(
            res,
            403,
            JSON.stringify({ error: "ota_operator_unauthorized" }),
            "application/json",
          );
        }
        if (!supportsHttpOta(device)) {
          return send(
            res,
            409,
            JSON.stringify({ error: "http_ota_not_supported" }),
            "application/json",
          );
        }
        const prepared = await prepareRegistryOtaCommand(body, {
          registry: firmwareRegistry,
          firmwareOrigin: config.httpFirmwareOrigin,
          maxFirmwareBytes: config.maxFirmwareBytes,
        });
        if (!prepared.ok) {
          return send(
            res,
            prepared.status,
            JSON.stringify({ error: prepared.error }),
            "application/json",
          );
        }
        body = Buffer.from(JSON.stringify(prepared.command));
      }
      const result = await broker.request(device, {
        method: req.method,
        path: req.url,
        headers: filterHeaders(req.headers),
        body,
      });
      res.writeHead(result.status, filterHeaders(result.headers));
      res.end(result.body);
    } catch (error) {
      send(
        res,
        error.statusCode || 500,
        error.statusCode ? error.message : "internal error",
      );
    }
  });

  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: config.maxBodyBytes,
  });
  const tunnelContext = { registry, authorizedDevices, broker, config };
  attachAuthenticatedTunnel(wss, tunnelContext);
  attachWebSocketHeartbeat(wss, {
    intervalMs: config.heartbeatIntervalMs,
    timeoutMs: config.heartbeatTimeoutMs,
  });
  telemetry.start();
  server.on("close", () => { telemetry.stop(); auth?.close?.(); });

  server.on("upgrade", (req, socket, head) => {
    if (req.url !== "/tunnel") return socket.destroy();
    const host = String(req.headers.host || "").toLowerCase().split(":")[0];
    const v2Host = config.tunnelHost;
    if (host !== v2Host) return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) =>
      wss.emit("connection", ws, req),
    );
  });
  return {
    server,
    registry,
    authorizedDevices,
    broker,
    wss,
    firmwareRegistry,
    arduinoDownloads,
    deviceManager,
    telemetry,
    enrollments,
    auth,
    authError,
  };
}

async function serveEnrollment(req, res, url, enrollments, authorizedDevices, auth, config) {
  const match = /^\/api\/enrollments\/([A-Za-z0-9_-]{43})(\/claim)?$/.exec(url.pathname);
  if (!match) return false;
  try {
    if (!match[2] && req.method === "GET") {
      sendJson(res, 200, enrollments.inspect(match[1]));
      return true;
    }
    if (match[2] && req.method === "POST") {
      if (!validCsrf(req, config)) {
        sendJson(res, 403, { error: "csrf_rejected" });
        return true;
      }
      const result = await enrollments.claim(
        match[1], req.espwayUser, authorizedDevices, auth, requestIp(req),
      );
      sendJson(res, 201, result);
      return true;
    }
    sendJson(res, 405, { error: "method_not_allowed" });
  } catch (error) {
    sendJson(res, error.statusCode || 500, { error: error.message });
  }
  return true;
}

function safeRedirectPath(value) {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

function validCsrf(req, config) {
  if (!validAdminWrite(req, config.adminHost)) return false;
  return typeof req.espwayCsrf === "string" && req.headers["x-espway-csrf"] === req.espwayCsrf;
}

async function serveAuth(req, res, url, auth, config) {
  if (url.pathname === "/login" && req.method === "GET") {
    await serveFile(res, join(PUBLIC, "login.html"));
    return true;
  }
  if (url.pathname === "/login.css" || url.pathname === "/login.js") {
    if (req.method !== "GET") return void send(res, 405, "method not allowed") || true;
    await serveFile(res, join(PUBLIC, url.pathname.slice(1)));
    return true;
  }
  if (url.pathname === "/api/auth/login" && req.method === "POST") {
    let input;
    try { input = JSON.parse((await readBody(req, 4096)).toString("utf8")); }
    catch { sendJson(res, 400, { error: "invalid_json" }); return true; }
    try {
      const result = await auth.login(input.username, input.password, requestIp(req));
      send(res, 200, JSON.stringify({ user: result.user, csrfToken: result.csrf }), "application/json", {
        "set-cookie": cookie(SESSION_COOKIE, result.token, { maxAge: Math.floor(config.sessionTtlMs / 1000) }),
      });
    } catch (error) {
      sendJson(res, error.statusCode || 500, { error: error.statusCode ? error.message : "authentication_failed" });
    }
    return true;
  }
  if (!url.pathname.startsWith("/api/auth/")) return false;
  const token = parseCookies(req)[SESSION_COOKIE];
  const session = auth.session(token);
  if (!session) { sendJson(res, 401, { error: "authentication_required" }); return true; }
  req.espwayUser = session.user;
  req.espwayCsrf = session.csrf;
  if (url.pathname === "/api/auth/me" && req.method === "GET") {
    sendJson(res, 200, { user: session.user, csrfToken: session.csrf }); return true;
  }
  if (url.pathname === "/api/auth/logout" && req.method === "POST") {
    if (!validCsrf(req, config)) { sendJson(res, 403, { error: "csrf_rejected" }); return true; }
    auth.logout(token, requestIp(req));
    send(res, 200, JSON.stringify({ status: "logged_out" }), "application/json", {
      "set-cookie": cookie(SESSION_COOKIE, "", { maxAge: -1 }),
    });
    return true;
  }
  if (url.pathname === "/api/auth/password" && req.method === "POST") {
    if (!validCsrf(req, config)) { sendJson(res, 403, { error: "csrf_rejected" }); return true; }
    try {
      const input = JSON.parse((await readBody(req, 4096)).toString("utf8"));
      if (input.newPassword !== input.confirmPassword) {
        sendJson(res, 400, { error: "password_confirmation_mismatch" });
        return true;
      }
      await auth.changePassword(session.user, input.currentPassword, input.newPassword, token, requestIp(req));
      sendJson(res, 200, { status: "password_changed" });
    } catch (error) {
      sendJson(res, error.statusCode || 400, { error: error.statusCode ? error.message : "invalid_json" });
    }
    return true;
  }
  if (url.pathname === "/api/auth/tokens") {
    if (req.method === "GET") { sendJson(res, 200, auth.listApiTokens(session.user)); return true; }
    if (req.method === "POST") {
      if (!validCsrf(req, config)) { sendJson(res, 403, { error: "csrf_rejected" }); return true; }
      try {
        const input = JSON.parse((await readBody(req, 4096)).toString("utf8"));
        sendJson(res, 201, auth.createApiToken(session.user, input.name));
      } catch (error) { sendJson(res, error.statusCode || 400, { error: error.message || "invalid_json" }); }
      return true;
    }
  }
  const tokenMatch = /^\/api\/auth\/tokens\/([^/]+)$/.exec(url.pathname);
  if (tokenMatch && req.method === "DELETE") {
    if (!validCsrf(req, config)) { sendJson(res, 403, { error: "csrf_rejected" }); return true; }
    try { auth.revokeApiToken(session.user, tokenMatch[1]); sendJson(res, 200, { status: "revoked" }); }
    catch (error) { sendJson(res, error.statusCode || 500, { error: error.message }); }
    return true;
  }
  sendJson(res, 404, { error: "not_found" });
  return true;
}

async function servePortal(req, res, url, downloads, config) {
  if (req.method !== "GET") return send(res, 405, "method not allowed");
  if (url.pathname === "/") {
    const release = await downloads.current();
    if (!release) return send(res, 503, "Arduino library unavailable");
    const template = await readFile(join(PUBLIC, "portal.html"), "utf8");
    return send(
      res,
      200,
      portalHtml(template, release.metadata, config),
      "text/html; charset=utf-8",
    );
  }
  if (url.pathname === "/portal.css")
    return serveFile(res, join(PUBLIC, "portal.css"));
  if (url.pathname.startsWith("/downloads/")) {
    const release = await downloads.resolveRequest(req.url);
    if (!release) return send(res, 404, "not found");
    const body = await readFile(release.archivePath);
    res.writeHead(200, {
      "content-type": "application/zip",
      "content-length": body.length,
      "content-disposition": `attachment; filename="${release.metadata.file}"`,
      "cache-control": "public, max-age=31536000, immutable",
      "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "referrer-policy": "no-referrer",
    });
    return res.end(body);
  }
  return send(res, 404, "not found");
}

async function serveDeviceManager(req, res, url, manager, config, auth = null) {
  if (["/", "/devices", "/users", "/admin", "/admin/"].includes(url.pathname) ||
      url.pathname.startsWith("/enroll/")) {
    if (req.method !== "GET") {
      send(res, 405, "method not allowed");
      return true;
    }
    await serveFile(res, join(PUBLIC, "admin.html"));
    return true;
  }
  if (url.pathname === "/admin.css" || url.pathname === "/admin.js") {
    if (req.method !== "GET") {
      send(res, 405, "method not allowed");
      return true;
    }
    await serveFile(res, join(PUBLIC, url.pathname.slice(1)));
    return true;
  }
  if (url.pathname.startsWith("/devices/")) {
    if (req.method !== "GET") {
      send(res, 405, "method not allowed");
      return true;
    }
    await serveFile(res, join(PUBLIC, "admin.html"));
    return true;
  }
  if (url.pathname.startsWith("/api/admin/users"))
    return serveUserManager(req, res, url, auth, config, manager);
  if (!url.pathname.startsWith("/api/admin/devices")) return false;

  const parts = url.pathname.split("/").filter(Boolean);
  const deviceId = parts[3];
  const action = parts[4];
  const actor = req.espwayUser;
  const allowedDevice = (id) => !auth || auth.canAccessDevice(actor, id);
  if (req.method === "GET") {
    if (parts.length === 3) {
      const devices = await manager.list();
      sendJson(res, 200, auth ? devices.filter((device) => allowedDevice(device.deviceId)) : devices);
      return true;
    }
    if (parts.length === 4) {
      if (!allowedDevice(deviceId)) { sendJson(res, 404, { error: "device_not_found" }); return true; }
      const device = await manager.detail(deviceId);
      if (device) sendJson(res, 200, device);
      else sendJson(res, 404, { error: "device_not_found" });
      return true;
    }
    sendJson(res, 404, { error: "not_found" });
    return true;
  }
  if (!["POST", "PATCH", "DELETE"].includes(req.method)) {
    sendJson(res, 405, { error: "method_not_allowed" });
    return true;
  }
  if (auth ? !validCsrf(req, config) : !validAdminWrite(req, config.adminHost)) {
    sendJson(res, 403, { error: "admin_request_rejected" });
    return true;
  }

  let input;
  try {
    input = JSON.parse((await readBody(req, 4096)).toString("utf8"));
    if (!input || Array.isArray(input) || typeof input !== "object") throw new Error();
  } catch {
    sendJson(res, 400, { error: "invalid_json" });
    return true;
  }
  if (parts.length === 3) {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    try {
      const ownerId = actor?.role === "admin" && input.ownerUserId ? input.ownerUserId : actor?.id;
      if (auth && !ownerId) throw Object.assign(new Error("owner_required"), { statusCode: 400 });
      if (auth) auth.assignDevice(ownerId, input.deviceId);
      try {
        const created = await manager.create(input);
        auth?.audit(actor, "device.create", "device", input.deviceId, "success", requestIp(req));
        sendJson(res, 201, created);
      } catch (error) { if (auth) auth.unassignDevice(ownerId, input.deviceId); throw error; }
    } catch (error) {
      sendJson(res, error.statusCode || 500, { error: error.message });
    }
    return true;
  }
  if (!allowedDevice(deviceId)) { sendJson(res, 404, { error: "device_not_found" }); return true; }
  if (parts.length === 4 && req.method === "PATCH") {
    try {
      sendJson(res, 200, await manager.update(deviceId, input));
    } catch (error) {
      sendJson(res, error.statusCode || 500, {
        error: error.statusCode ? error.message : "internal_error",
      });
    }
    return true;
  }
  if (parts.length === 4 && req.method === "DELETE") {
    try {
      await manager.delete(deviceId);
      auth?.removeDeviceAssociations(deviceId);
      auth?.audit(actor, "device.delete", "device", deviceId, "success", requestIp(req));
      sendJson(res, 200, { status: "deleted", deviceId });
    } catch (error) {
      sendJson(res, error.statusCode || 500, {
        error: error.statusCode ? error.message : "internal_error",
      });
    }
    return true;
  }
  if (parts.length === 5 && action === "access-ticket" && req.method === "POST" && auth) {
    const ticket = auth.createAccessTicket(actor, deviceId);
    sendJson(res, 201, { url: `https://${deviceId}.${config.baseDomain}/_espway/access`, ticket });
    return true;
  }
  if (parts.length !== 5 || !["enable", "disable", "ota"].includes(action)) {
    sendJson(res, 404, { error: "not_found" });
    return true;
  }
  try {
    if (action === "enable" || action === "disable") {
      sendJson(
        res,
        200,
        await manager.setEnabled(deviceId, action === "enable"),
      );
      return true;
    }
    const result = await manager.ota(deviceId, input);
    if (result.error) {
      sendJson(res, result.status, { error: result.error });
      return true;
    }
    const responseBody = result.body?.length
      ? JSON.parse(result.body.toString("utf8"))
      : { status: "accepted" };
    sendJson(res, result.status, { ...responseBody, target: result.target });
  } catch (error) {
    sendJson(res, error.statusCode || 500, {
      error: error.statusCode ? error.message : "internal_error",
    });
  }
  return true;
}

async function serveUserManager(req, res, url, auth, config, manager) {
  if (!auth) { sendJson(res, 503, { error: "authentication_unavailable" }); return true; }
  if (req.espwayUser?.role !== "admin") { sendJson(res, 403, { error: "forbidden" }); return true; }
  const parts = url.pathname.split("/").filter(Boolean);
  const userId = parts[3];
  if (req.method === "GET" && parts.length === 3) { sendJson(res, 200, auth.listUsersWithDevices()); return true; }
  if (!["POST", "PATCH", "DELETE"].includes(req.method)) { sendJson(res, 405, { error: "method_not_allowed" }); return true; }
  if (!validCsrf(req, config)) { sendJson(res, 403, { error: "csrf_rejected" }); return true; }
  let input = {};
  try { if (req.method !== "DELETE") input = JSON.parse((await readBody(req, 4096)).toString("utf8")); }
  catch { sendJson(res, 400, { error: "invalid_json" }); return true; }
  try {
    if (req.method === "POST" && parts.length === 3) {
      if (input.password !== input.confirmPassword) throw Object.assign(new Error("password_confirmation_mismatch"), { statusCode: 400 });
      sendJson(res, 201, await auth.createUser(input, req.espwayUser, requestIp(req)));
    }
    else if (req.method === "PATCH" && parts.length === 4) {
      if (input.password !== undefined && input.password !== input.confirmPassword)
        throw Object.assign(new Error("password_confirmation_mismatch"), { statusCode: 400 });
      sendJson(res, 200, await auth.updateUser(userId, input, req.espwayUser, requestIp(req)));
    }
    else if (req.method === "DELETE" && parts.length === 4) { auth.deleteUser(userId, req.espwayUser, requestIp(req)); sendJson(res, 200, { status: "deleted" }); }
    else if (["POST", "DELETE"].includes(req.method) && parts.length === 6 && parts[4] === "devices") {
      const deviceId = parts[5];
      if (!await manager.detail(deviceId)) throw Object.assign(new Error("device_not_found"), { statusCode: 404 });
      if (req.method === "POST") auth.assignDevice(userId, deviceId); else auth.unassignDevice(userId, deviceId);
      auth.audit(req.espwayUser, req.method === "POST" ? "device.assign" : "device.unassign", "device", deviceId, "success", requestIp(req));
      sendJson(res, 200, { status: req.method === "POST" ? "assigned" : "unassigned" });
    }
    else sendJson(res, 404, { error: "not_found" });
  } catch (error) { sendJson(res, error.statusCode || 500, { error: error.statusCode ? error.message : "internal_error" }); }
  return true;
}

function filterHeaders(headers) {
  const allowed = ["content-type", "cache-control", "etag", "last-modified"];
  const result = {};
  for (const name of allowed) if (headers?.[name]) result[name] = headers[name];
  return result;
}

async function serveFile(res, path) {
  try {
    const body = await readFile(path);
    send(res, 200, body, TYPES[extname(path)] || "application/octet-stream");
  } catch {
    send(res, 404, "not found");
  }
}

async function serveFirmwareApi(req, res, pathname, registry) {
  if (req.method !== "GET") return send(res, 405, "method not allowed");
  let parts;
  try {
    parts = decodeURIComponent(pathname).split("/").filter(Boolean);
  } catch {
    return send(res, 400, "invalid path");
  }
  if (parts.some((part) => part === "." || part === ".."))
    return send(res, 400, "invalid path");

  let result;
  if (parts.length === 2) {
    result = await registry.listReleased();
  } else if (parts.length === 4) {
    result = await registry.listVersions(parts[2], parts[3]);
  } else if (parts.length === 5) {
    const artifact = await registry.resolve(parts[2], parts[3], parts[4]);
    if (!artifact) return send(res, 404, "firmware not found");
    result = publicManifest(artifact);
  } else {
    return send(res, 404, "not found");
  }
  return send(res, 200, JSON.stringify(result), "application/json");
}

async function serveRegistryFirmware(req, res, pathname, registry) {
  if (req.method !== "GET") return send(res, 405, "method not allowed");
  let parts;
  try {
    parts = decodeURIComponent(pathname).split("/").filter(Boolean);
  } catch {
    return send(res, 400, "invalid path");
  }
  if (
    parts.length !== 5 ||
    parts[0] !== "firmware" ||
    !["firmware.bin", "web-installer-manifest.json"].includes(parts[4]) ||
    parts.some((part) => part === "." || part === "..")
  ) {
    return send(res, 404, "firmware not found");
  }
  const artifact = await registry.resolve(parts[1], parts[2], parts[3]);
  if (!artifact) return send(res, 404, "firmware not found");
  const path = parts[4] === "firmware.bin"
    ? artifact.firmwarePath
    : join(artifact.releasePath, "web-installer-manifest.json");
  return serveFile(res, path);
}
