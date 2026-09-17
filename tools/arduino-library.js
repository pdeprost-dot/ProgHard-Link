import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, posix, resolve } from "node:path";

const FIXED_DOS_DATE = 0x0021; // 1980-01-01
const FIXED_DOS_TIME = 0;
const REQUIRED_EXAMPLES = [
  "DhtSensorDemo",
  "ProgHardLinkBase",
  "LedDemo",
  "ThermostatDemo",
];

export function parseProperties(text) {
  return Object.fromEntries(text.split(/\r?\n/).filter(Boolean).map((line) => {
    const separator = line.indexOf("=");
    return [line.slice(0, separator), line.slice(separator + 1)];
  }));
}

async function filesUnder(root, prefix) {
  const directory = join(root, prefix);
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const child = posix.join(prefix.replaceAll("\\", "/"), entry.name);
    if (entry.isSymbolicLink()) throw new Error(`symlink is not allowed: ${child}`);
    if (entry.isDirectory()) result.push(...await filesUnder(root, child));
    else if (entry.isFile()) result.push(child);
  }
  return result;
}

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++)
      value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
  }
  return (value ^ 0xffffffff) >>> 0;
}

function zip(entries) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const checksum = crc32(entry.body);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6);
    header.writeUInt16LE(FIXED_DOS_TIME, 10);
    header.writeUInt16LE(FIXED_DOS_DATE, 12);
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(entry.body.length, 18);
    header.writeUInt32LE(entry.body.length, 22);
    header.writeUInt16LE(name.length, 26);
    local.push(header, name, entry.body);

    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(0x0800, 8);
    directory.writeUInt16LE(FIXED_DOS_TIME, 12);
    directory.writeUInt16LE(FIXED_DOS_DATE, 14);
    directory.writeUInt32LE(checksum, 16);
    directory.writeUInt32LE(entry.body.length, 20);
    directory.writeUInt32LE(entry.body.length, 24);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    directory.writeUInt32LE(offset, 42);
    central.push(directory, name);
    offset += header.length + name.length + entry.body.length;
  }
  const centralSize = central.reduce((sum, item) => sum + item.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}

export async function buildArduinoLibrary({ sourceRoot }) {
  const root = resolve(sourceRoot);
  const propertiesText = await readFile(join(root, "library.properties"), "utf8");
  const properties = parseProperties(propertiesText);
  if (properties.name !== "ProgHard Link") throw new Error("library name must be ProgHard Link");
  if (!/^\d+\.\d+\.\d+$/.test(properties.version)) throw new Error("invalid library version");
  const frameworkHeader = await readFile(join(root, "src", "ESPwayFramework.h"), "utf8");
  const frameworkVersion = frameworkHeader.match(
    /#define\s+ESPWAY_FRAMEWORK_VERSION\s+"([^"]+)"/,
  )?.[1];
  if (frameworkVersion !== properties.version) {
    throw new Error(`version mismatch: library=${properties.version}, framework=${frameworkVersion}`);
  }
  for (const example of REQUIRED_EXAMPLES)
    await stat(join(root, "examples", example));

  const allowed = ["library.properties", "README.md"];
  allowed.push(...await filesUnder(root, "src"));
  allowed.push(...await filesUnder(root, "examples"));
  allowed.sort((a, b) => a.localeCompare(b, "en"));
  const entries = await Promise.all(allowed.map(async (path) => ({
    name: `ProgHard-Link/${path.replaceAll("\\", "/")}`,
    body: await readFile(join(root, ...path.split("/"))),
  })));
  const archive = zip(entries);
  const file = `ProgHard-Link-${properties.version}.zip`;
  return {
    archive,
    metadata: {
      schemaVersion: 1,
      name: properties.name,
      version: properties.version,
      architectures: properties.architectures,
      esp8266Core: "3.1.2",
      file,
      size: archive.length,
      sha256: createHash("sha256").update(archive).digest("hex"),
      status: "released",
    },
    entries: entries.map((entry) => entry.name),
  };
}

export function assertSafeZipEntries(entries) {
  if (!entries.length || entries.some((name) => !name.startsWith("ProgHard-Link/")))
    throw new Error("ZIP must have exactly one ProgHard-Link root");
  const forbidden = /(^|\/)(\.git|\.env)(\/|$)|\.bin$|(^|\/)server\/|(^|\/)caddy\/|docker/i;
  for (const name of entries) {
    if (name.startsWith("/") || name.includes("\\") || name.split("/").includes(".."))
      throw new Error(`unsafe ZIP entry: ${name}`);
    if (forbidden.test(name)) throw new Error(`forbidden ZIP entry: ${name}`);
  }
}

export function repositoryLibraryRoot(repositoryRoot) {
  return join(repositoryRoot, "firmware", "esp8266", "libraries", "ESPway");
}

export async function publishArduinoLibrary(result, outputRoot) {
  const root = resolve(outputRoot);
  const releaseRoot = join(root, result.metadata.version);
  const archivePath = join(releaseRoot, result.metadata.file);
  const metadataPath = join(releaseRoot, "metadata.json");
  const lockPath = join(root, "released.json");
  let locks = { schemaVersion: 1, releases: {} };
  try {
    locks = JSON.parse(await readFile(lockPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const locked = locks.releases[result.metadata.version];
  if (
    locked &&
    (locked.sha256 !== result.metadata.sha256 ||
      locked.size !== result.metadata.size)
  ) {
    throw new Error(`released version ${result.metadata.version} is immutable`);
  }
  await mkdir(releaseRoot, { recursive: true });
  await writeFile(archivePath, result.archive);
  await writeFile(metadataPath, `${JSON.stringify(result.metadata, null, 2)}\n`);
  locks.releases[result.metadata.version] ??= {
    file: result.metadata.file,
    size: result.metadata.size,
    sha256: result.metadata.sha256,
  };
  await writeFile(lockPath, `${JSON.stringify(locks, null, 2)}\n`);
  return { archivePath, metadataPath, lockPath };
}
