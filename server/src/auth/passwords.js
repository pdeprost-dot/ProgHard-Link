import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const PARAMETERS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export function validatePassword(password) {
  if (typeof password !== "string" || password.length < 12 || password.length > 256)
    throw Object.assign(new Error("invalid_password"), { statusCode: 400 });
}

export async function hashPassword(password) {
  validatePassword(password);
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 32, PARAMETERS);
  return `scrypt$v=1$N=${PARAMETERS.N}$r=${PARAMETERS.r}$p=${PARAMETERS.p}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password, encoded) {
  const parts = String(encoded).split("$");
  if (parts.length !== 7 || parts[0] !== "scrypt" || parts[1] !== "v=1") return false;
  const N = Number(parts[2].slice(2));
  const r = Number(parts[3].slice(2));
  const p = Number(parts[4].slice(2));
  if (N !== PARAMETERS.N || r !== PARAMETERS.r || p !== PARAMETERS.p) return false;
  try {
    const expected = Buffer.from(parts[6], "base64");
    const actual = await scrypt(password, Buffer.from(parts[5], "base64"), expected.length, PARAMETERS);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch { return false; }
}
