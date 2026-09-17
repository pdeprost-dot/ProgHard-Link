import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import {
  FirmwareRegistry,
  createWebInstallerManifest,
  validateFirmwareRegistry,
} from "../src/firmware-registry.js";

const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) =>
      rm(path, { recursive: true, force: true })
    ),
  );
});

async function fixture({
  status = "released",
  hardware = "esp8266",
  application = "test-app",
  version = "1.0.0",
  firmware = Buffer.from("firmware bytes"),
  manifestOverrides = {},
  lockOverrides = {},
} = {}) {
  const root = await mkdtemp(join(tmpdir(), "espway-registry-"));
  temporaryRoots.push(root);
  const directory = join(root, hardware, application, version);
  await mkdir(directory, { recursive: true });
  const sha256 = createHash("sha256").update(firmware).digest("hex");
  const manifest = {
    schemaVersion: 1,
    status,
    hardware,
    application,
    applicationVersion: version,
    frameworkVersion: "0.2.0",
    size: firmware.length,
    sha256,
    file: "firmware.bin",
    ...manifestOverrides,
  };
  await writeFile(join(directory, "firmware.bin"), firmware);
  await writeFile(
    join(directory, "manifest.json"),
    JSON.stringify(manifest),
  );
  const locked = status === "released" || status === "deprecated";
  await writeFile(
    join(root, "released.json"),
    JSON.stringify({
      schemaVersion: 1,
      artifacts: locked
        ? {
          [`${hardware}/${application}/${version}`]: {
            size: manifest.size,
            sha256: manifest.sha256,
            ...lockOverrides,
          },
        }
        : {},
    }),
  );
  return { root, directory, manifest, firmware };
}

test("validates a complete released artifact", async () => {
  const { root } = await fixture();
  const result = await validateFirmwareRegistry(root);
  assert.equal(result.ok, true, result.errors.join("\n"));
  assert.equal(result.artifacts.length, 1);
});

test("rejects invalid JSON and a missing firmware", async () => {
  const invalid = await fixture();
  await writeFile(join(invalid.directory, "manifest.json"), "{");
  assert.equal((await validateFirmwareRegistry(invalid.root)).ok, false);

  const missing = await fixture();
  await rm(join(missing.directory, "firmware.bin"));
  assert.match(
    (await validateFirmwareRegistry(missing.root)).errors.join("\n"),
    /firmware unavailable/,
  );
});

test("rejects size and SHA-256 mismatches", async () => {
  const wrongSize = await fixture({ manifestOverrides: { size: 1 } });
  assert.match(
    (await validateFirmwareRegistry(wrongSize.root)).errors.join("\n"),
    /size mismatch/,
  );

  const wrongHash = await fixture({
    manifestOverrides: { sha256: "0".repeat(64) },
  });
  assert.match(
    (await validateFirmwareRegistry(wrongHash.root)).errors.join("\n"),
    /sha256 mismatch/,
  );
});

test("rejects invalid status and path traversal", async () => {
  const badStatus = await fixture({ status: "private" });
  assert.match(
    (await validateFirmwareRegistry(badStatus.root)).errors.join("\n"),
    /invalid status/,
  );

  const traversal = await fixture({ manifestOverrides: { file: "../firmware.bin" } });
  const errors = (await validateFirmwareRegistry(traversal.root)).errors.join("\n");
  assert.match(errors, /file must be firmware\.bin/);
  assert.match(errors, /firmware path escapes registry|firmware unavailable/);
});

test("rejects symlinks inside the registry", async (context) => {
  const { root } = await fixture();
  const outside = await mkdtemp(join(tmpdir(), "espway-outside-"));
  temporaryRoots.push(outside);
  try {
    await symlink(outside, join(root, "linked-outside"), "junction");
  } catch (error) {
    context.skip(`symlinks unavailable: ${error.code}`);
    return;
  }
  assert.match(
    (await validateFirmwareRegistry(root)).errors.join("\n"),
    /symlink is not allowed/,
  );
});

test("immutable lock rejects replacement under a released version", async () => {
  const { root } = await fixture({
    lockOverrides: { sha256: "f".repeat(64) },
  });
  assert.match(
    (await validateFirmwareRegistry(root)).errors.join("\n"),
    /differs from immutable lock/,
  );
});

test("detects contradictory duplicate artifact identities", async () => {
  const first = await fixture();
  const duplicateDirectory = join(first.root, "esp8266", "other-app", "1.0.0");
  await mkdir(duplicateDirectory, { recursive: true });
  await writeFile(join(duplicateDirectory, "firmware.bin"), first.firmware);
  await writeFile(
    join(duplicateDirectory, "manifest.json"),
    JSON.stringify(first.manifest),
  );
  assert.match(
    (await validateFirmwareRegistry(first.root)).errors.join("\n"),
    /duplicate artifact identity/,
  );
});

test("only released artifacts are listed and latest ignores deprecated", async () => {
  const released = await fixture();
  const candidateDirectory = join(released.root, "esp8266", "test-app", "2.0.0");
  await mkdir(candidateDirectory, { recursive: true });
  const candidate = {
    ...released.manifest,
    status: "candidate",
    applicationVersion: "2.0.0",
  };
  await writeFile(join(candidateDirectory, "firmware.bin"), released.firmware);
  await writeFile(join(candidateDirectory, "manifest.json"), JSON.stringify(candidate));

  const registry = new FirmwareRegistry(released.root);
  assert.deepEqual(
    (await registry.listReleased()).map((item) => item.applicationVersion),
    ["1.0.0"],
  );
  assert.equal(await registry.resolve("esp8266", "test-app", "2.0.0"), null);
  assert.equal(
    (await registry.resolve("esp8266", "test-app", "latest")).applicationVersion,
    "1.0.0",
  );
});

test("deprecated artifacts remain explicitly addressable but are not proposed", async () => {
  const { root } = await fixture({ status: "deprecated" });
  const registry = new FirmwareRegistry(root);
  assert.deepEqual(await registry.listReleased(), []);
  assert.ok(await registry.resolve("esp8266", "test-app", "1.0.0"));
  assert.equal(await registry.resolve("esp8266", "test-app", "latest"), null);
});

test("generates the esp-web-tools manifest from the internal identity", () => {
  const manifest = createWebInstallerManifest({
    hardware: "esp8266",
    application: "espway-base",
    applicationVersion: "0.1.0",
    file: "firmware.bin",
  });
  assert.equal(manifest.name, "ProgHard Link Base");
  assert.equal(manifest.version, "0.1.0");
  assert.deepEqual(manifest.builds[0].parts, [
    { path: "firmware.bin", offset: 0 },
  ]);
});
