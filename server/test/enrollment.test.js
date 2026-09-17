import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { AuthService } from "../src/auth/auth-service.js";
import { openAuthDatabase } from "../src/auth/database.js";
import { AuthorizedDeviceRegistry } from "../src/authorized-devices.js";
import { EnrollmentService } from "../src/enrollment-service.js";
import { createEspwayServer } from "../src/server.js";

const adminHost = "link.example.test";
const baseDomain = "devices.example.test";
const credential = "ab".repeat(32);
let app;
let endpoint;
let userA;
let userB;

function request(path, { method = "GET", body, cookie, csrf, origin } = {}) {
  const target = new URL(endpoint);
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: target.hostname, port: target.port, path, method,
      headers: { Host: adminHost, ...(payload ? {
        "content-type": "application/json", "content-length": payload.length,
      } : {}), ...(cookie ? { cookie } : {}), ...(csrf ? {
        "x-espway-admin-request": "1", "x-espway-csrf": csrf,
      } : {}), ...(origin ? { origin } : {}) } }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve({ status: res.statusCode, headers: res.headers, raw,
          json: () => JSON.parse(raw) });
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function login(username, password) {
  const response = await request("/api/auth/login", {
    method: "POST", body: { username, password },
  });
  return {
    cookie: response.headers["set-cookie"][0].split(";", 1)[0],
    csrf: response.json().csrfToken,
  };
}

function enrollmentInput(deviceId = "esp-c0ffee") {
  return {
    deviceId, deviceName: "Fresh ESP", hardware: "esp32-c3",
    application: "espway-base-esp32", applicationVersion: "0.1.0",
    frameworkVersion: "0.4.5", credential,
  };
}

before(async () => {
  const directory = await mkdtemp(join(tmpdir(), "espway-enrollment-"));
  const registryPath = join(directory, "devices.json");
  await writeFile(registryPath, JSON.stringify({ version: 1, devices: {} }));
  const auth = new AuthService(openAuthDatabase(join(directory, "auth.sqlite")));
  userA = await auth.createUser({ username: "user-a", password: "user-a-password-long", role: "user" });
  userB = await auth.createUser({ username: "user-b", password: "user-b-password-long", role: "user" });
  app = createEspwayServer({
    authEnabled: true, authService: auth, adminHost, baseDomain,
    publicUrl: `https://${adminHost}`, portalHost: "portal.example.test",
    requestTimeoutMs: 100, maxBodyBytes: 4096, maxStreamsPerDevice: 8,
    firmwareDir: join(directory, "firmware"), downloadDir: join(directory, "downloads"),
    httpFirmwareOrigin: `http://tunnel.${baseDomain}`, maxFirmwareBytes: 1048576,
    otaOperatorToken: "", authorizedDevices: AuthorizedDeviceRegistry.fromFile(registryPath),
    tokens: new Map(), enrollmentTtlMs: 600000,
  });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  endpoint = `http://127.0.0.1:${app.server.address().port}`;
});

after(async () => {
  app.wss.close(); app.server.closeAllConnections();
  await new Promise((resolve) => app.server.close(resolve));
});

test("device creates an enrollment without exposing its credential", async () => {
  const response = await request("/api/enrollments", { method: "POST", body: enrollmentInput() });
  assert.equal(response.status, 201);
  assert.match(response.json().claimUrl, /^https:\/\/link\.example\.test\/enroll\/[A-Za-z0-9_-]{43}$/);
  assert.equal(response.json().baseDomain, baseDomain);
  assert.doesNotMatch(response.raw, new RegExp(credential));
});

test("unauthenticated claim returns to the exact enrollment after login", async () => {
  const created = await request("/api/enrollments", { method: "POST", body: enrollmentInput("esp-c0ffe1") });
  const path = new URL(created.json().claimUrl).pathname;
  const page = await request(path);
  assert.equal(page.status, 303);
  assert.equal(page.headers.location, `/login?next=${encodeURIComponent(path)}`);
});

test("claim requires CSRF, creates ownership and is one-time", async () => {
  const created = await request("/api/enrollments", { method: "POST", body: enrollmentInput("esp-c0ffe2") });
  const token = new URL(created.json().claimUrl).pathname.split("/").pop();
  const identity = await login("user-a", "user-a-password-long");
  assert.equal((await request(`/api/enrollments/${token}`, { cookie: identity.cookie })).status, 200);
  assert.equal((await request(`/api/enrollments/${token}/claim`, {
    method: "POST", body: {}, cookie: identity.cookie,
  })).status, 403);
  const claimed = await request(`/api/enrollments/${token}/claim`, {
    method: "POST", body: {}, cookie: identity.cookie, csrf: identity.csrf,
    origin: `https://${adminHost}`,
  });
  assert.equal(claimed.status, 201);
  assert.equal(app.auth.canAccessDevice(userA, "esp-c0ffe2"), true);
  assert.equal(app.auth.canAccessDevice(userB, "esp-c0ffe2"), false);
  assert.equal(app.authorizedDevices.getToken("esp-c0ffe2"), credential);
  assert.equal((await request(`/api/enrollments/${token}`, { cookie: identity.cookie })).status, 404);
});

test("invalid, expired and already registered enrollments fail closed", async () => {
  assert.equal((await request("/api/enrollments", { method: "POST", body: {} })).status, 400);
  assert.equal((await request("/api/enrollments", { method: "POST", body: {
    ...enrollmentInput("esp-c0ffe3"), credential: "bad",
  } })).status, 400);
  let now = 1000;
  const service = new EnrollmentService({ ttlMs: 10, now: () => now });
  const created = service.create(enrollmentInput("esp-c0ffe4"), app.authorizedDevices,
    "https://other.example.org", "other.example.org");
  assert.match(created.claimUrl, /^https:\/\/other\.example\.org\//);
  now = 1011;
  assert.throws(() => service.inspect(new URL(created.claimUrl).pathname.split("/").pop()),
    (error) => error.statusCode === 410);
  assert.throws(() => service.create(enrollmentInput("esp-c0ffe2"), app.authorizedDevices,
    "https://link.example.test", baseDomain),
    (error) => error.statusCode === 409);
});

test("a new enrollment for the same pending device invalidates the old link", async () => {
  const first = await request("/api/enrollments", { method: "POST", body: enrollmentInput("esp-c0ffe5") });
  const second = await request("/api/enrollments", { method: "POST", body: enrollmentInput("esp-c0ffe5") });
  const identity = await login("user-b", "user-b-password-long");
  assert.equal((await request(new URL(first.json().claimUrl).pathname.replace("/enroll/", "/api/enrollments/"), {
    cookie: identity.cookie,
  })).status, 404);
  assert.equal((await request(new URL(second.json().claimUrl).pathname.replace("/enroll/", "/api/enrollments/"), {
    cookie: identity.cookie,
  })).status, 200);
});
