import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { readHiddenLine, readPasswordFromStdin, rejectPasswordArguments } from "../src/cli/input.js";
import { AuthService } from "../src/auth/auth-service.js";
import { openAuthDatabase } from "../src/auth/database.js";

class FakeTty extends EventEmitter {
  isTTY = true;
  isRaw = false;
  paused = true;
  setRawMode(value) { this.isRaw = value; }
  isPaused() { return this.paused; }
  resume() { this.paused = false; }
  pause() { this.paused = true; }
}

function runCli(args, { input = "", authFile } = {}) {
  return new Promise((resolve, reject) => {
    const script = fileURLToPath(new URL("../src/cli/create-admin.js", import.meta.url));
    const child = spawn(process.execPath, [script, ...args], {
      env: { ...process.env, ESPWAY_AUTH_DATABASE_FILE: authFile },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({
      code,
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8"),
    }));
    child.stdin.end(input);
  });
}

test("hidden TTY input does not echo characters and restores terminal state", async () => {
  const input = new FakeTty();
  const writes = [];
  const result = readHiddenLine(input, { write: (value) => writes.push(value) }, "Password: ", () => {});
  input.emit("keypress", "s", { name: "s" });
  input.emit("keypress", "e", { name: "e" });
  input.emit("keypress", "x", { name: "x" });
  input.emit("keypress", "x", { name: "backspace" });
  input.emit("keypress", "c", { name: "c" });
  input.emit("keypress", "\r", { name: "return" });
  assert.equal(await result, "sec");
  assert.deepEqual(writes, ["Password: ", "\n"]);
  assert.equal(input.isRaw, false);
  assert.equal(input.isPaused(), true);
});

test("interactive password input requires matching confirmation", async () => {
  const answers = ["first-password", "second-password"];
  await assert.rejects(
    () => readPasswordFromStdin({ input: { isTTY: true }, output: {}, readHidden: async () => answers.shift() }),
    /password_confirmation_mismatch/,
  );
});

test("password-like command-line arguments are rejected", () => {
  assert.throws(() => rejectPasswordArguments(["--password", "secret-value"]), /must not be passed/);
  assert.throws(() => rejectPasswordArguments(["PASSWORD=secret-value"]), /must not be passed/);
  assert.doesNotThrow(() => rejectPasswordArguments(["--username", "admin"]));
});

test("create-admin still accepts non-interactive stdin and stores a verifiable hash", async () => {
  const directory = await mkdtemp(join(tmpdir(), "espway-cli-"));
  const authFile = join(directory, "auth.sqlite");
  const password = "stdin-password-long";
  const result = await runCli(["--username", "admin"], { input: password, authFile });
  assert.equal(result.code, 0, result.stderr);
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(password));
  const auth = new AuthService(openAuthDatabase(authFile));
  try {
    assert.equal((await auth.login("admin", password)).user.username, "admin");
  } finally { auth.close(); }
});

test("create-admin rejects password arguments before reading stdin", async () => {
  const directory = await mkdtemp(join(tmpdir(), "espway-cli-arg-"));
  const secret = "argument-password-long";
  const result = await runCli(["--username", "admin", "--password", secret], {
    input: "ignored-stdin-password",
    authFile: join(directory, "auth.sqlite"),
  });
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /must not be passed as a command-line argument/);
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(secret));
});

test("create-admin preserves password length validation for non-interactive stdin", async () => {
  const directory = await mkdtemp(join(tmpdir(), "espway-cli-short-"));
  const result = await runCli(["--username", "admin"], {
    input: "too-short",
    authFile: join(directory, "auth.sqlite"),
  });
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /invalid_password/);
  assert.doesNotMatch(result.stdout + result.stderr, /too-short/);
});
