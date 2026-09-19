import { createHash, randomBytes, randomUUID } from "node:crypto";
import { DEVICE_ID_RE } from "../config.js";
import { hashPassword, validatePassword, verifyPassword } from "./passwords.js";

const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;
const ROLES = new Set(["admin", "user"]);
export const DUMMY_PASSWORD_HASH = "scrypt$v=1$N=32768$r=8$p=1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const now = () => new Date().toISOString();
const error = (message, statusCode) => Object.assign(new Error(message), { statusCode });

function publicUser(row) {
  return row && {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at,
  };
}

export class AuthService {
  constructor(db, { sessionTtlMs = 8 * 60 * 60 * 1000, deviceSessionTtlMs = 60 * 60 * 1000 } = {}) {
    this.db = db;
    this.sessionTtlMs = sessionTtlMs;
    this.deviceSessionTtlMs = deviceSessionTtlMs;
    this.sessions = new Map();
    this.tickets = new Map();
    this.deviceSessions = new Map();
    this.failures = new Map();
  }

  userCount() { return this.db.prepare("SELECT count(*) count FROM users").get().count; }
  getUserById(id) { return publicUser(this.db.prepare("SELECT * FROM users WHERE id = ?").get(id)); }
  getUserByUsername(username) { return publicUser(this.db.prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE").get(username)); }
  listUsers() { return this.db.prepare("SELECT * FROM users ORDER BY username COLLATE NOCASE").all().map(publicUser); }
  listUsersWithDevices() {
    return this.listUsers().map((user) => ({
      ...user,
      deviceIds: this.db.prepare("SELECT device_id FROM user_devices WHERE user_id=? ORDER BY device_id").all(user.id).map((row) => row.device_id),
    }));
  }

  async createUser(input, actor = null, sourceIp = null) {
    const username = String(input.username || "").trim().toLowerCase();
    const displayName = String(input.displayName || "").trim();
    const role = input.role || "user";
    if (!USERNAME_RE.test(username)) throw error("invalid_username", 400);
    if (displayName.length > 128) throw error("invalid_display_name", 400);
    if (!ROLES.has(role)) throw error("invalid_role", 400);
    validatePassword(input.password);
    const id = randomUUID();
    const timestamp = now();
    try {
      this.db.prepare(`INSERT INTO users
        (id, username, display_name, password_hash, role, enabled, created_at, updated_at, password_changed_at)
        VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`)
        .run(id, username, displayName, await hashPassword(input.password), role, timestamp, timestamp, timestamp);
    } catch (cause) {
      if (String(cause.message).includes("UNIQUE")) throw error("user_already_exists", 409);
      throw cause;
    }
    this.audit(actor, "user.create", "user", id, "success", sourceIp);
    return this.getUserById(id);
  }

  async updateUser(id, input, actor, sourceIp = null) {
    const current = this.getUserById(id);
    if (!current) throw error("user_not_found", 404);
    const role = input.role ?? current.role;
    const enabled = input.enabled ?? current.enabled;
    const displayName = input.displayName ?? current.displayName;
    if (!ROLES.has(role)) throw error("invalid_role", 400);
    if (typeof enabled !== "boolean") throw error("invalid_enabled", 400);
    if (typeof displayName !== "string" || displayName.length > 128) throw error("invalid_display_name", 400);
    if (id === actor.id && (!enabled || role !== "admin")) throw error("cannot_remove_own_admin_access", 409);
    if (current.role === "admin" && current.enabled && (!enabled || role !== "admin") && this.enabledAdminCount() === 1)
      throw error("last_admin_required", 409);
    let passwordHash = null;
    if (input.password !== undefined) passwordHash = await hashPassword(input.password);
    const timestamp = now();
    this.db.prepare(`UPDATE users SET display_name=?, role=?, enabled=?, updated_at=?,
      password_hash=COALESCE(?, password_hash), password_changed_at=CASE WHEN ? IS NULL THEN password_changed_at ELSE ? END
      WHERE id=?`).run(displayName.trim(), role, enabled ? 1 : 0, timestamp, passwordHash, passwordHash, timestamp, id);
    if (!enabled || passwordHash) this.revokeUserSessions(id);
    this.audit(actor, "user.update", "user", id, "success", sourceIp);
    return this.getUserById(id);
  }

  deleteUser(id, actor, sourceIp = null) {
    const current = this.getUserById(id);
    if (!current) throw error("user_not_found", 404);
    if (id === actor.id) throw error("cannot_delete_yourself", 409);
    if (current.role === "admin" && current.enabled && this.enabledAdminCount() === 1) throw error("last_admin_required", 409);
    this.db.prepare("DELETE FROM users WHERE id=?").run(id);
    this.revokeUserSessions(id);
    this.audit(actor, "user.delete", "user", id, "success", sourceIp);
  }

  enabledAdminCount() { return this.db.prepare("SELECT count(*) count FROM users WHERE role='admin' AND enabled=1").get().count; }

  async login(username, password, sourceIp = "") {
    const normalized = String(username || "").trim().toLowerCase();
    const keys = [`ip:${sourceIp}`, `user:${normalized}`];
    if (keys.some((key) => this.failures.get(key)?.blockedUntil > Date.now()))
      throw error("login_rate_limited", 429);
    const row = this.db.prepare("SELECT * FROM users WHERE username=? COLLATE NOCASE").get(normalized);
    const valid = await verifyPassword(password, row?.password_hash || DUMMY_PASSWORD_HASH);
    if (!row || row.enabled !== 1 || !valid) {
      for (const key of keys) {
        const failure = this.failures.get(key);
        const count = (failure?.count || 0) + 1;
        const threshold = key.startsWith("ip:") ? 20 : 5;
        this.failures.set(key, { count, blockedUntil: count >= threshold ? Date.now() + Math.min(300000, 1000 * 2 ** (count - threshold)) : 0 });
      }
      this.audit(row ? publicUser(row) : null, "auth.login", "user", row?.id, "failure", sourceIp);
      throw error("invalid_credentials", 401);
    }
    for (const key of keys) this.failures.delete(key);
    const timestamp = now();
    this.db.prepare("UPDATE users SET last_login_at=? WHERE id=?").run(timestamp, row.id);
    const token = randomBytes(32).toString("base64url");
    this.sessions.set(sha256(token), { userId: row.id, expiresAt: Date.now() + this.sessionTtlMs, csrf: randomBytes(24).toString("base64url") });
    const user = this.getUserById(row.id);
    this.audit(user, "auth.login", "user", row.id, "success", sourceIp);
    return { token, user, csrf: this.sessions.get(sha256(token)).csrf };
  }

  session(token) {
    if (!token) return null;
    const record = this.sessions.get(sha256(token));
    if (!record || record.expiresAt <= Date.now()) { if (record) this.sessions.delete(sha256(token)); return null; }
    const user = this.getUserById(record.userId);
    return user?.enabled ? { user, csrf: record.csrf, expiresAt: record.expiresAt } : null;
  }

  logout(token, sourceIp = null) {
    const session = this.session(token);
    this.sessions.delete(sha256(token || ""));
    if (session) this.audit(session.user, "auth.logout", "user", session.user.id, "success", sourceIp);
  }

  revokeUserSessions(userId) {
    for (const [key, session] of this.sessions) if (session.userId === userId) this.sessions.delete(key);
    for (const [key, session] of this.deviceSessions) if (session.userId === userId) this.deviceSessions.delete(key);
  }

  async changePassword(user, currentPassword, newPassword, sessionToken, sourceIp = null) {
    const row = this.db.prepare("SELECT password_hash FROM users WHERE id=?").get(user.id);
    if (!row || !await verifyPassword(currentPassword, row.password_hash))
      throw error("invalid_current_password", 400);
    validatePassword(newPassword);
    const passwordHash = await hashPassword(newPassword);
    const timestamp = now();
    this.db.prepare("UPDATE users SET password_hash=?, password_changed_at=?, updated_at=? WHERE id=?")
      .run(passwordHash, timestamp, timestamp, user.id);
    const currentSessionKey = sha256(sessionToken || "");
    for (const [key, session] of this.sessions)
      if (session.userId === user.id && key !== currentSessionKey) this.sessions.delete(key);
    for (const [key, session] of this.deviceSessions)
      if (session.userId === user.id) this.deviceSessions.delete(key);
    this.audit(user, "auth.password_change", "user", user.id, "success", sourceIp);
  }

  canAccessDevice(user, deviceId) {
    if (!user?.enabled || !DEVICE_ID_RE.test(deviceId)) return false;
    if (user.role === "admin") return true;
    return Boolean(this.db.prepare("SELECT 1 FROM user_devices WHERE user_id=? AND device_id=?").get(user.id, deviceId));
  }

  deviceIds(user) {
    if (user.role === "admin") return null;
    return new Set(this.db.prepare("SELECT device_id FROM user_devices WHERE user_id=?").all(user.id).map((row) => row.device_id));
  }

  assignDevice(userId, deviceId) {
    if (!this.getUserById(userId)) throw error("user_not_found", 404);
    if (!DEVICE_ID_RE.test(deviceId)) throw error("invalid_device_id", 400);
    this.db.prepare("INSERT OR IGNORE INTO user_devices(user_id, device_id, created_at) VALUES (?, ?, ?)").run(userId, deviceId, now());
  }
  unassignDevice(userId, deviceId) { this.db.prepare("DELETE FROM user_devices WHERE user_id=? AND device_id=?").run(userId, deviceId); }
  deviceUsers(deviceId) { return this.db.prepare(`SELECT u.id,u.username,u.display_name,u.role,u.enabled,u.created_at,u.updated_at,u.last_login_at
    FROM users u JOIN user_devices d ON d.user_id=u.id WHERE d.device_id=? ORDER BY u.username`).all(deviceId).map(publicUser); }
  removeDeviceAssociations(deviceId) { this.db.prepare("DELETE FROM user_devices WHERE device_id=?").run(deviceId); }

  createApiToken(user, name) {
    const normalizedName = String(name || "").trim();
    if (!normalizedName || normalizedName.length > 80) throw error("invalid_token_name", 400);
    const secret = `espway_pat_${randomBytes(32).toString("base64url")}`;
    const id = randomUUID();
    this.db.prepare("INSERT INTO api_tokens(id,user_id,name,token_hash,created_at) VALUES(?,?,?,?,?)")
      .run(id, user.id, normalizedName, sha256(secret), now());
    this.audit(user, "api_token.create", "api_token", id, "success");
    return { id, name: normalizedName, token: secret, createdAt: now() };
  }
  listApiTokens(user) { return this.db.prepare("SELECT id,name,created_at createdAt,last_used_at lastUsedAt,revoked_at revokedAt FROM api_tokens WHERE user_id=? ORDER BY created_at DESC").all(user.id); }
  revokeApiToken(user, id) {
    const result = this.db.prepare("UPDATE api_tokens SET revoked_at=? WHERE id=? AND user_id=? AND revoked_at IS NULL").run(now(), id, user.id);
    if (!result.changes) throw error("api_token_not_found", 404);
    this.audit(user, "api_token.revoke", "api_token", id, "success");
  }
  authenticateBearer(token) {
    if (!token?.startsWith("espway_pat_")) return null;
    const row = this.db.prepare(`SELECT t.id token_id,u.* FROM api_tokens t JOIN users u ON u.id=t.user_id
      WHERE t.token_hash=? AND t.revoked_at IS NULL`).get(sha256(token));
    if (!row || row.enabled !== 1) return null;
    this.db.prepare("UPDATE api_tokens SET last_used_at=? WHERE id=?").run(now(), row.token_id);
    return publicUser(row);
  }

  createAccessTicket(user, deviceId) {
    if (!this.canAccessDevice(user, deviceId)) throw error("device_not_found", 404);
    const ticket = randomBytes(32).toString("base64url");
    this.tickets.set(sha256(ticket), { userId: user.id, deviceId, expiresAt: Date.now() + 60000 });
    return ticket;
  }
  consumeAccessTicket(ticket, deviceId) {
    const key = sha256(ticket || "");
    const record = this.tickets.get(key);
    this.tickets.delete(key);
    if (!record || record.deviceId !== deviceId || record.expiresAt < Date.now()) return null;
    const user = this.getUserById(record.userId);
    if (!this.canAccessDevice(user, deviceId)) return null;
    const token = randomBytes(32).toString("base64url");
    this.deviceSessions.set(sha256(token), { userId: user.id, deviceId, expiresAt: Date.now() + this.deviceSessionTtlMs });
    return token;
  }
  authenticateDeviceSession(token, deviceId) {
    const record = token && this.deviceSessions.get(sha256(token));
    if (!record || record.deviceId !== deviceId || record.expiresAt < Date.now()) return null;
    const user = this.getUserById(record.userId);
    return this.canAccessDevice(user, deviceId) ? user : null;
  }

  audit(actor, action, targetType, targetId, result, sourceIp = null) {
    this.db.prepare(`INSERT INTO audit_log(created_at,actor_user_id,actor_username,action,target_type,target_id,result,source_ip)
      VALUES(?,?,?,?,?,?,?,?)`).run(now(), actor?.id || null, actor?.username || null, action, targetType || null, targetId || null, result, sourceIp || null);
  }
  close() { this.db.close(); }
}
