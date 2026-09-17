import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { lstat, readFile, realpath, stat } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";

const VERSION_RE = /^\d+\.\d+\.\d+$/;
const DOWNLOAD_RE = /^\/downloads\/arduino\/(?:ESPway|ProgHard-Link)-(\d+\.\d+\.\d+)\.zip$/;

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function publicMetadata(metadata) {
  return Object.fromEntries([
    "schemaVersion", "name", "version", "architectures", "esp8266Core",
    "file", "size", "sha256", "status",
  ].map((field) => [field, metadata[field]]));
}

export class ArduinoDownloadRepository {
  constructor(rootPath) {
    this.rootPath = resolve(rootPath);
    this.libraryRoot = join(this.rootPath, "arduino", "ESPway");
  }

  async resolveVersion(version) {
    if (!VERSION_RE.test(version)) return null;
    const releaseRoot = join(this.libraryRoot, version);
    const metadataPath = join(releaseRoot, "metadata.json");
    const lockPath = join(this.libraryRoot, "released.json");
    try {
      const [metadata, locks] = await Promise.all([
        readFile(metadataPath, "utf8").then(JSON.parse),
        readFile(lockPath, "utf8").then(JSON.parse),
      ]);
      const expectedNames = {
        ESPway: `ESPway-${version}.zip`,
        "ProgHard Link": `ProgHard-Link-${version}.zip`,
      };
      const expectedFile = expectedNames[metadata.name];
      if (
        metadata.schemaVersion !== 1 || !expectedFile ||
        metadata.version !== version || metadata.file !== expectedFile ||
        metadata.status !== "released" || !Number.isSafeInteger(metadata.size) ||
        !/^[a-f0-9]{64}$/.test(metadata.sha256)
      ) return null;
      const lock = locks.releases?.[version];
      if (!lock || lock.file !== expectedFile || lock.size !== metadata.size ||
          lock.sha256 !== metadata.sha256) return null;
      const archivePath = join(releaseRoot, expectedFile);
      if ((await lstat(archivePath)).isSymbolicLink()) return null;
      const [canonicalLibrary, canonicalArchive] = await Promise.all([
        realpath(this.libraryRoot), realpath(archivePath),
      ]);
      if (!canonicalArchive.startsWith(canonicalLibrary + sep)) return null;
      const info = await stat(canonicalArchive);
      if (!info.isFile() || info.size !== metadata.size ||
          await sha256(canonicalArchive) !== metadata.sha256) return null;
      return { metadata: publicMetadata(metadata), archivePath: canonicalArchive };
    } catch { return null; }
  }

  async current() {
    const locks = JSON.parse(await readFile(join(this.libraryRoot, "released.json"), "utf8"));
    const versions = Object.keys(locks.releases ?? {}).filter((item) => VERSION_RE.test(item));
    versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    return versions[0] ? this.resolveVersion(versions[0]) : null;
  }

  async resolveRequest(rawUrl) {
    if (typeof rawUrl !== "string" || rawUrl.includes("\\") || rawUrl.includes("\0") || rawUrl.includes("%"))
      return null;
    const pathname = rawUrl.split("?", 1)[0];
    const match = DOWNLOAD_RE.exec(pathname);
    if (!match) return null;
    const release = await this.resolveVersion(match[1]);
    if (!release || basename(release.archivePath) !== release.metadata.file ||
        basename(pathname) !== release.metadata.file) return null;
    return release;
  }
}

export function portalHtml(template, metadata, config = {}) {
  const values = {
    "{{LIBRARY_VERSION}}": metadata.version,
    "{{LIBRARY_ARCHITECTURES}}": metadata.architectures,
    "{{LIBRARY_SIZE}}": new Intl.NumberFormat("en").format(metadata.size),
    "{{LIBRARY_SHA256}}": metadata.sha256,
    "{{LIBRARY_DOWNLOAD}}": `/downloads/arduino/${metadata.file}`,
    "{{ADMIN_URL}}": `https://${config.adminHost}`,
    "{{INSTALLER_URL}}": `https://${config.installerHost}`,
    "{{DEVICE_HOST_EXAMPLE}}": `esp-&lt;deviceId&gt;.${config.baseDomain}`,
  };
  return Object.entries(values).reduce(
    (html, [marker, value]) => html.replaceAll(marker, String(value)), template,
  );
}
