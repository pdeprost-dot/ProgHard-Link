import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import { runInNewContext } from "node:vm";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { AuthService, DUMMY_PASSWORD_HASH } from "../src/auth/auth-service.js";
import { openAuthDatabase } from "../src/auth/database.js";
import { requestIp } from "../src/auth/http-auth.js";
import { verifyPassword } from "../src/auth/passwords.js";
import { AuthorizedDeviceRegistry } from "../src/authorized-devices.js";
import { createEspwayServer, safeRedirectPath } from "../src/server.js";

const adminHost = "admin.devices.example.com";
const repositoryRoot = new URL("../../", import.meta.url);
let app;
let endpoint;
let admin;
let userA;
let userB;

function request(path, { method = "GET", host = adminHost, body, headers = {} } = {}) {
  const target = new URL(endpoint);
  const payload = body === undefined ? null : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: target.hostname, port: target.port, path, method, headers: {
      Host: host, ...headers, ...(payload ? { "content-length": payload.length } : {}),
    } }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve({ status: res.statusCode, headers: res.headers, raw, json: () => JSON.parse(raw) });
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function login(username, password) {
  const response = await request("/api/auth/login", { method: "POST", body: { username, password }, headers: { "content-type": "application/json" } });
  const cookie = response.headers["set-cookie"]?.[0].split(";", 1)[0];
  return { response, cookie, csrf: response.status === 200 ? response.json().csrfToken : null };
}

function authenticated(identity, path, options = {}) {
  return request(path, { ...options, headers: {
    cookie: identity.cookie,
    ...(options.body !== undefined ? { "content-type": "application/json", "x-espway-admin-request": "1", "x-espway-csrf": identity.csrf } : {}),
    ...options.headers,
  } });
}

before(async () => {
  const directory = await mkdtemp(join(tmpdir(), "espway-auth-"));
  const registryPath = join(directory, "devices.json");
  await writeFile(registryPath, JSON.stringify({ version: 1, devices: {
    "esp-aaaaaa": { enabled: true }, "esp-bbbbbb": { enabled: true },
  } }));
  const auth = new AuthService(openAuthDatabase(join(directory, "auth.sqlite")), { sessionTtlMs: 5000 });
  admin = await auth.createUser({ username: "admin", password: "admin-password-long", role: "admin" });
  userA = await auth.createUser({ username: "user-a", password: "user-a-password-long", role: "user" });
  userB = await auth.createUser({ username: "user-b", password: "user-b-password-long", role: "user" });
  auth.assignDevice(userA.id, "esp-aaaaaa");
  auth.assignDevice(userB.id, "esp-bbbbbb");
  app = createEspwayServer({
    authEnabled: true, authService: auth, sessionTtlMs: 5000, deviceSessionTtlMs: 60000,
    baseDomain: "devices.example.com", adminHost, portalHost: "portal.devices.example.com",
    requestTimeoutMs: 100, maxBodyBytes: 4096, maxStreamsPerDevice: 8,
    firmwareDir: fileURLToPath(new URL("firmware-repository/", repositoryRoot)),
    downloadDir: fileURLToPath(new URL("download-repository/", repositoryRoot)),
    httpFirmwareOrigin: "http://tunnel.devices.example.com", maxFirmwareBytes: 1048576,
    otaOperatorToken: "", authorizedDevices: AuthorizedDeviceRegistry.fromFile(registryPath), tokens: new Map(),
  });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  endpoint = `http://127.0.0.1:${app.server.address().port}`;
});

after(async () => {
  app.wss.close(); app.server.closeAllConnections();
  await new Promise((resolve) => app.server.close(resolve));
});

test("admin surfaces fail closed without a session", async () => {
  assert.equal((await request("/api/admin/devices")).status, 401);
  assert.equal((await request("/api/admin/users")).status, 401);
  assert.equal((await request("/")).status, 303);
});

test("login rejects bad credentials and returns a hardened cookie", async () => {
  assert.equal((await login("admin", "wrong-password")).response.status, 401);
  const identity = await login("admin", "admin-password-long");
  assert.equal(identity.response.status, 200);
  const header = identity.response.headers["set-cookie"][0];
  assert.match(header, /HttpOnly/); assert.match(header, /Secure/); assert.match(header, /SameSite=Strict/);
  assert.doesNotMatch(header, /Domain=/);
});

test("missing users use a structurally valid scrypt placeholder", async () => {
  const parts = DUMMY_PASSWORD_HASH.split("$");
  assert.equal(parts.length, 7);
  assert.equal(Buffer.from(parts[5], "base64").length, 16);
  assert.equal(Buffer.from(parts[6], "base64").length, 32);
  assert.equal(await verifyPassword("wrong-password", DUMMY_PASSWORD_HASH), false);
});

test("Caddy overwrites forwarded IP and only private proxy peers are trusted", async () => {
  const caddy = await readFile(fileURLToPath(new URL("../../caddy/Caddyfile", import.meta.url)), "utf8");
  assert.match(caddy, /header_up X-Forwarded-For \{remote_host\}/);
  const headers = { "x-forwarded-for": "198.51.100.7" };
  assert.equal(requestIp({ socket: { remoteAddress: "172.18.0.2" }, headers }), "198.51.100.7");
  assert.equal(requestIp({ socket: { remoteAddress: "203.0.113.9" }, headers }), "203.0.113.9");
  assert.equal(requestIp({ socket: { remoteAddress: "172.18.0.2" }, headers: { "x-forwarded-for": "198.51.100.7, 203.0.113.9" } }), "172.18.0.2");
});

test("login and access-ticket redirects remain local", async () => {
  const source = await readFile(fileURLToPath(new URL("../public/login.js", import.meta.url)), "utf8");
  const browserPath = runInNewContext(`${source}\nsafeRedirectPath`, {
    document: { querySelector: () => ({ addEventListener() {} }) },
    location: { origin: "https://admin.example.test" }, URL,
  });
  for (const candidate of ["//evil.example", "/\\evil.example", "/a\\b", "/\tevil.example", "https://evil.example"]) {
    assert.equal(safeRedirectPath(candidate), "/");
    assert.equal(browserPath(candidate), "/");
  }
  assert.equal(safeRedirectPath("/devices/esp-aaaaaa?view=1"), "/devices/esp-aaaaaa?view=1");
  assert.equal(browserPath("/devices/esp-aaaaaa?view=1"), "/devices/esp-aaaaaa?view=1");
});

test("users receive only their devices and known foreign IDs remain hidden", async () => {
  const a = await login("user-a", "user-a-password-long");
  const list = await authenticated(a, "/api/admin/devices");
  assert.deepEqual(list.json().map((device) => device.deviceId), ["esp-aaaaaa"]);
  assert.equal((await authenticated(a, "/api/admin/devices/esp-bbbbbb")).status, 404);
  assert.equal((await authenticated(a, "/api/admin/devices/esp-bbbbbb/disable", { method: "POST", body: {} })).status, 404);
});

test("admins see all devices while normal users cannot administer users", async () => {
  const root = await login("admin", "admin-password-long");
  assert.equal((await authenticated(root, "/api/admin/devices")).json().length, 2);
  const a = await login("user-a", "user-a-password-long");
  assert.equal((await authenticated(a, "/api/admin/users")).status, 403);
});

test("admin user creation requires matching password confirmation", async () => {
  const root = await login("admin", "admin-password-long");
  const mismatch = await authenticated(root, "/api/admin/users", { method: "POST", body: {
    username: "mismatch-user",
    password: "matching-is-required",
    confirmPassword: "different-password",
    role: "user",
  } });
  assert.equal(mismatch.status, 400);
  assert.equal(mismatch.json().error, "password_confirmation_mismatch");
});

test("CSRF is mandatory for authenticated mutations", async () => {
  const a = await login("user-a", "user-a-password-long");
  assert.equal((await request("/api/admin/devices/esp-aaaaaa/disable", { method: "POST", body: {}, headers: { cookie: a.cookie, "content-type": "application/json", "x-espway-admin-request": "1" } })).status, 403);
  assert.equal((await authenticated(a, "/api/admin/devices/esp-aaaaaa/disable", { method: "POST", body: {}, headers: { origin: "https://evil.example" } })).status, 403);
});

test("a user-created device is automatically owned and foreign users cannot discover it", async () => {
  const a = await login("user-a", "user-a-password-long");
  const created = await authenticated(a, "/api/admin/devices", { method: "POST", body: { deviceId: "esp-a1a1a1", deviceName: "A new device" } });
  assert.equal(created.status, 201); assert.match(created.json().token, /^[a-f0-9]{64}$/);
  assert.equal(app.auth.canAccessDevice(userA, "esp-a1a1a1"), true);
  const b = await login("user-b", "user-b-password-long");
  assert.equal((await authenticated(b, "/api/admin/devices/esp-a1a1a1")).status, 404);
});

test("duplicate device creation cannot revoke existing ownership", async () => {
  const a = await login("user-a", "user-a-password-long");
  assert.equal((await authenticated(a, "/api/admin/devices", { method: "POST", body: { deviceName: "Missing ID" } })).status, 400);
  const duplicate = await authenticated(a, "/api/admin/devices", { method: "POST", body: { deviceId: "esp-aaaaaa", deviceName: "Existing" } });
  assert.equal(duplicate.status, 409);
  assert.equal(app.auth.canAccessDevice(userA, "esp-aaaaaa"), true);
  assert.equal((await authenticated(a, "/api/admin/devices/esp-aaaaaa")).status, 200);
});

test("personal API tokens authorize only owned remote device hosts and can be revoked", async () => {
  const a = await login("user-a", "user-a-password-long");
  const created = await authenticated(a, "/api/auth/tokens", { method: "POST", body: { name: "Node-RED" } });
  assert.equal(created.status, 201);
  const token = created.json().token;
  assert.equal((await request("/api/status", { host: "esp-aaaaaa.devices.example.com", headers: { authorization: `Bearer ${token}` } })).status, 503);
  assert.equal((await request("/api/status", { host: "esp-bbbbbb.devices.example.com", headers: { authorization: `Bearer ${token}` } })).status, 404);
  assert.equal((await authenticated(a, `/api/auth/tokens/${created.json().id}`, { method: "DELETE", body: {} })).status, 200);
  assert.equal((await request("/api/status", { host: "esp-aaaaaa.devices.example.com", headers: { authorization: `Bearer ${token}` } })).status, 401);
});

test("users can change their password while keeping only the current session", async () => {
  const current = await login("user-a", "user-a-password-long");
  const other = await login("user-a", "user-a-password-long");
  const changed = await authenticated(current, "/api/auth/password", { method: "POST", body: {
    currentPassword: "user-a-password-long",
    newPassword: "user-a-password-new-long",
    confirmPassword: "user-a-password-new-long",
  } });
  assert.equal(changed.status, 200);
  assert.equal((await authenticated(current, "/api/auth/me")).status, 200);
  assert.equal((await authenticated(other, "/api/auth/me")).status, 401);
  assert.equal((await login("user-a", "user-a-password-long")).response.status, 401);
  const newIdentity = await login("user-a", "user-a-password-new-long");
  assert.equal(newIdentity.response.status, 200);
  assert.equal((await authenticated(newIdentity, "/api/auth/password", { method: "POST", body: {
    currentPassword: "user-a-password-new-long",
    newPassword: "user-a-password-long",
    confirmPassword: "user-a-password-long",
  } })).status, 200);
});

test("password changes validate current password, confirmation and CSRF", async () => {
  const identity = await login("user-a", "user-a-password-long");
  assert.equal((await authenticated(identity, "/api/auth/password", { method: "POST", body: {
    currentPassword: "wrong-current-password",
    newPassword: "another-password-long",
    confirmPassword: "another-password-long",
  } })).status, 400);
  assert.equal((await authenticated(identity, "/api/auth/password", { method: "POST", body: {
    currentPassword: "user-a-password-long",
    newPassword: "another-password-long",
    confirmPassword: "different-password-long",
  } })).status, 400);
  assert.equal((await request("/api/auth/password", { method: "POST", body: {}, headers: { cookie: identity.cookie, "content-type": "application/json" } })).status, 403);
});

test("one-use browser tickets create a device-host-only session", async () => {
  const a = await login("user-a", "user-a-password-long");
  const ticket = await authenticated(a, "/api/admin/devices/esp-aaaaaa/access-ticket", { method: "POST", body: {} });
  assert.equal(ticket.status, 201);
  const path = new URL(ticket.json().url).pathname;
  const form = `ticket=${encodeURIComponent(ticket.json().ticket)}&next=%2F`;
  const exchange = await request(path, { method: "POST", body: form, host: "esp-aaaaaa.devices.example.com", headers: { "content-type": "application/x-www-form-urlencoded" } });
  assert.equal(exchange.status, 303);
  assert.match(exchange.headers["set-cookie"][0], /espway_device_session=/);
  assert.doesNotMatch(exchange.headers["set-cookie"][0], /Domain=/);
  assert.equal((await request(path, { method: "POST", body: form, host: "esp-aaaaaa.devices.example.com", headers: { "content-type": "application/x-www-form-urlencoded" } })).status, 401);
});

test("disabled users lose sessions and API tokens immediately", async () => {
  const root = await login("admin", "admin-password-long");
  const b = await login("user-b", "user-b-password-long");
  const token = await authenticated(b, "/api/auth/tokens", { method: "POST", body: { name: "automation" } });
  const disabled = await authenticated(root, `/api/admin/users/${userB.id}`, { method: "PATCH", body: { enabled: false } });
  assert.equal(disabled.status, 200);
  assert.equal((await authenticated(b, "/api/admin/devices")).status, 401);
  assert.equal((await request("/api/status", { host: "esp-bbbbbb.devices.example.com", headers: { authorization: `Bearer ${token.json().token}` } })).status, 401);
});

test("expired sessions are rejected", async () => {
  const root = await login("admin", "admin-password-long");
  const token = root.cookie.split("=", 2)[1];
  app.auth.sessions.get(createHash("sha256").update(token).digest("hex")).expiresAt = Date.now() - 1;
  assert.equal((await authenticated(root, "/api/admin/devices")).status, 401);
});

test("last administrator protections are enforced", async () => {
  await assert.rejects(() => app.auth.updateUser(admin.id, { enabled: false }, admin), /cannot_remove_own_admin_access/);
  assert.throws(() => app.auth.deleteUser(admin.id, admin), /cannot_delete_yourself/);
});

test("an unavailable or uninitialized auth database fails the admin host closed", async () => {
  const directory = await mkdtemp(join(tmpdir(), "espway-auth-empty-"));
  const emptyAuth = new AuthService(openAuthDatabase(join(directory, "auth.sqlite")));
  const isolated = createEspwayServer({
    authEnabled: true, authService: emptyAuth,
    baseDomain: "devices.example.com", adminHost, portalHost: "portal.devices.example.com",
    requestTimeoutMs: 100, maxBodyBytes: 4096, maxStreamsPerDevice: 8,
    firmwareDir: fileURLToPath(new URL("firmware-repository/", repositoryRoot)),
    downloadDir: fileURLToPath(new URL("download-repository/", repositoryRoot)),
    httpFirmwareOrigin: "http://tunnel.devices.example.com", maxFirmwareBytes: 1048576,
    otaOperatorToken: "", authorizedDevices: new AuthorizedDeviceRegistry({ devices: {} }), tokens: new Map(),
  });
  isolated.server.listen(0, "127.0.0.1");
  await once(isolated.server, "listening");
  const target = `http://127.0.0.1:${isolated.server.address().port}`;
  const status = await new Promise((resolve, reject) => {
    const req = http.get(target, { headers: { Host: adminHost } }, (res) => { res.resume(); res.on("end", () => resolve(res.statusCode)); });
    req.on("error", reject);
  });
  assert.equal(status, 503);
  isolated.wss.close(); isolated.server.closeAllConnections();
  await new Promise((resolve) => isolated.server.close(resolve));
});

test("the auth database and SQLite sidecars use private permissions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "espway-auth-mode-"));
  const path = join(directory, "auth.sqlite");
  const service = new AuthService(openAuthDatabase(path));
  if (process.platform !== "win32")
    assert.equal((await stat(path)).mode & 0o777, 0o600);
  for (const suffix of ["-wal", "-shm"]) {
    try {
      if (process.platform !== "win32")
        assert.equal((await stat(path + suffix)).mode & 0o777, 0o600);
    }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  service.close();
});
