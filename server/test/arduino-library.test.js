import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  assertSafeZipEntries,
  buildArduinoLibrary,
  parseProperties,
  publishArduinoLibrary,
  repositoryLibraryRoot,
} from "../../tools/arduino-library.js";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const sourceRoot = repositoryLibraryRoot(repositoryRoot);
const currentVersion = "0.4.8";
const releaseRoot = new URL(
  `download-repository/arduino/ESPway/${currentVersion}/`,
  new URL("../../", import.meta.url),
);

function zipEntryNames(buffer) {
  const names = [];
  let offset = 0;
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    names.push(buffer.subarray(offset + 30, offset + 30 + nameLength).toString("utf8"));
    offset += 30 + nameLength + extraLength + compressedSize;
  }
  return names;
}

test("Arduino library metadata matches the framework version", async () => {
  const properties = parseProperties(
    await readFile(`${sourceRoot}/library.properties`, "utf8"),
  );
  assert.equal(properties.name, "ProgHard Link");
  assert.equal(properties.version, currentVersion);
  assert.equal(properties.architectures, "esp8266,esp32");
  assert.equal(properties.includes, "ESPway.h");
  assert.equal(properties.url, "https://link.proghard.com/");
  assert.match(properties.depends, /ArduinoJson \(>=7\.4\.2\)/);
  assert.match(properties.depends, /WebSockets \(>=2\.7\.2\)/);
  assert.match(properties.depends, /PubSubClient \(>=2\.8\)/);
  await buildArduinoLibrary({ sourceRoot });
});

test("Arduino ZIP build is byte-for-byte reproducible", async () => {
  const first = await buildArduinoLibrary({ sourceRoot });
  const second = await buildArduinoLibrary({ sourceRoot });
  assert.deepEqual(first.archive, second.archive);
  assert.equal(first.metadata.sha256, second.metadata.sha256);
  assert.equal(first.metadata.size, second.metadata.size);
});

test("released ZIP and metadata exactly match a fresh build", async () => {
  const generated = await buildArduinoLibrary({ sourceRoot });
  const [archive, metadata] = await Promise.all([
    readFile(new URL(`ProgHard-Link-${currentVersion}.zip`, releaseRoot)),
    readFile(new URL("metadata.json", releaseRoot), "utf8").then(JSON.parse),
  ]);
  assert.deepEqual(archive, generated.archive);
  assert.deepEqual(metadata, generated.metadata);
  assert.equal(createHash("sha256").update(archive).digest("hex"), metadata.sha256);
});

test("immutable release lock rejects different bytes for the same version", async () => {
  const directory = await mkdtemp(join(tmpdir(), "espway-arduino-release-"));
  try {
    const generated = await buildArduinoLibrary({ sourceRoot });
    await writeFile(
      join(directory, "released.json"),
      JSON.stringify({
        schemaVersion: 1,
        releases: {
          [currentVersion]: {
            file: `ProgHard-Link-${currentVersion}.zip`,
            size: generated.metadata.size,
            sha256: "0".repeat(64),
          },
        },
      }),
    );
    await assert.rejects(
      publishArduinoLibrary(generated, directory),
      new RegExp(`released version ${currentVersion.replaceAll(".", "\\.")} is immutable`),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("ZIP has one safe Arduino library root and required examples", async () => {
  const archive = await readFile(new URL(`ProgHard-Link-${currentVersion}.zip`, releaseRoot));
  const entries = zipEntryNames(archive);
  assertSafeZipEntries(entries);
  for (const required of [
    "ProgHard-Link/library.properties", "ProgHard-Link/README.md", "ProgHard-Link/src/ESPway.h",
    "ProgHard-Link/examples/ProgHardLinkBase/ProgHardLinkBase.ino",
    "ProgHard-Link/examples/LedDemo/LedDemo.ino",
    "ProgHard-Link/examples/DhtSensorDemo/DhtSensorDemo.ino",
    "ProgHard-Link/examples/ThermostatDemo/ThermostatDemo.ino",
  ]) assert.ok(entries.includes(required), required);
  assert.equal(new Set(entries.map((name) => name.split("/")[0])).size, 1);
});

test("public library content contains no private repository or secrets", async () => {
  const generated = await buildArduinoLibrary({ sourceRoot });
  const content = generated.archive.toString("latin1");
  assert.doesNotMatch(content, /github\.com\/[^/]+\/ESPway/i);
  assert.doesNotMatch(content, /ESPWAY_DEVICE_TOKENS|ESPWAY_OTA_OPERATOR_TOKEN/i);
});
