import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  lstat,
  opendir,
  readFile,
  realpath,
  stat,
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { compareSemver } from "./semver.js";

const COMPONENT_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i;
const SHA256_RE = /^[a-f0-9]{64}$/;
const STATUSES = new Set(["candidate", "released", "deprecated"]);
const REQUIRED_FIELDS = [
  "schemaVersion",
  "status",
  "hardware",
  "application",
  "applicationVersion",
  "frameworkVersion",
  "size",
  "sha256",
  "file",
];

export function artifactId({ hardware, application, applicationVersion }) {
  return `${hardware}/${application}/${applicationVersion}`;
}

export function createWebInstallerManifest(manifest) {
  return {
    name: manifest.application === "espway-base"
      ? "ProgHard Link Base"
      : manifest.application,
    version: manifest.applicationVersion,
    new_install_prompt_erase: false,
    new_install_improv_wait_time: 0,
    builds: [
      {
        chipFamily: manifest.hardware.toUpperCase(),
        improv: false,
        parts: [{ path: manifest.file, offset: 0 }],
      },
    ],
  };
}

async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function directories(path) {
  const result = [];
  for await (const entry of await opendir(path)) {
    if (entry.isDirectory()) result.push(entry.name);
  }
  return result.sort();
}

async function rejectSymlinks(path, root, errors) {
  for await (const entry of await opendir(path)) {
    const child = join(path, entry.name);
    const metadata = await lstat(child);
    if (metadata.isSymbolicLink()) {
      errors.push(`symlink is not allowed: ${relative(root, child)}`);
    } else if (metadata.isDirectory()) {
      await rejectSymlinks(child, root, errors);
    }
  }
}

function validateManifestShape(manifest, expected, errors) {
  for (const field of REQUIRED_FIELDS) {
    if (!(field in manifest)) errors.push(`${expected.id}: missing ${field}`);
  }
  if (manifest.schemaVersion !== 1)
    errors.push(`${expected.id}: schemaVersion must be 1`);
  if (!STATUSES.has(manifest.status))
    errors.push(`${expected.id}: invalid status`);
  if (!COMPONENT_RE.test(manifest.hardware ?? ""))
    errors.push(`${expected.id}: invalid hardware`);
  if (!COMPONENT_RE.test(manifest.application ?? ""))
    errors.push(`${expected.id}: invalid application`);
  if (!VERSION_RE.test(manifest.applicationVersion ?? ""))
    errors.push(`${expected.id}: invalid applicationVersion`);
  if (!VERSION_RE.test(manifest.frameworkVersion ?? ""))
    errors.push(`${expected.id}: invalid frameworkVersion`);
  if (!Number.isSafeInteger(manifest.size) || manifest.size <= 0)
    errors.push(`${expected.id}: invalid size`);
  if (!SHA256_RE.test(manifest.sha256 ?? ""))
    errors.push(`${expected.id}: invalid sha256`);
  if (manifest.file !== "firmware.bin")
    errors.push(`${expected.id}: file must be firmware.bin`);
  for (const field of ["hardware", "application", "applicationVersion"]) {
    if (manifest[field] !== expected[field])
      errors.push(`${expected.id}: ${field} does not match its directory`);
  }
}

export async function validateFirmwareRegistry(
  rootPath,
  { checkWebInstaller = true } = {},
) {
  const root = resolve(rootPath);
  const errors = [];
  const artifacts = [];
  const identities = new Set();
  let locks;

  try {
    const lockDocument = await readJson(join(root, "released.json"));
    if (lockDocument.schemaVersion !== 1 || !lockDocument.artifacts)
      errors.push("released.json: invalid schema");
    locks = lockDocument.artifacts ?? {};
  } catch (error) {
    errors.push(`released.json: ${error.message}`);
    locks = {};
  }

  try {
    await rejectSymlinks(root, root, errors);
    for (const hardware of await directories(root)) {
      if (!COMPONENT_RE.test(hardware)) {
        errors.push(`invalid hardware directory: ${hardware}`);
        continue;
      }
      const hardwarePath = join(root, hardware);
      for (const application of await directories(hardwarePath)) {
        if (!COMPONENT_RE.test(application)) {
          errors.push(`invalid application directory: ${hardware}/${application}`);
          continue;
        }
        const applicationPath = join(hardwarePath, application);
        for (const applicationVersion of await directories(applicationPath)) {
          const expected = {
            hardware,
            application,
            applicationVersion,
            id: `${hardware}/${application}/${applicationVersion}`,
          };
          if (!VERSION_RE.test(applicationVersion)) {
            errors.push(`invalid version directory: ${expected.id}`);
            continue;
          }

          let manifest;
          const releasePath = join(applicationPath, applicationVersion);
          try {
            manifest = await readJson(join(releasePath, "manifest.json"));
          } catch (error) {
            errors.push(`${expected.id}: invalid manifest (${error.message})`);
            continue;
          }
          validateManifestShape(manifest, expected, errors);
          const id = artifactId(manifest);
          if (identities.has(id)) errors.push(`${id}: duplicate artifact identity`);
          identities.add(id);

          const firmwarePath = resolve(releasePath, manifest.file ?? "");
          const child = relative(root, firmwarePath);
          if (child.startsWith("..") || isAbsolute(child)) {
            errors.push(`${expected.id}: firmware path escapes registry`);
            continue;
          }
          try {
            const canonicalRoot = await realpath(root);
            const canonicalFirmware = await realpath(firmwarePath);
            if (!canonicalFirmware.startsWith(canonicalRoot + sep)) {
              errors.push(`${expected.id}: firmware symlink escapes registry`);
              continue;
            }
            const metadata = await stat(canonicalFirmware);
            const actualSha256 = await sha256File(canonicalFirmware);
            if (!metadata.isFile()) errors.push(`${expected.id}: firmware is not a file`);
            if (metadata.size !== manifest.size)
              errors.push(`${expected.id}: size mismatch`);
            if (actualSha256 !== manifest.sha256)
              errors.push(`${expected.id}: sha256 mismatch`);
          } catch (error) {
            errors.push(`${expected.id}: firmware unavailable (${error.message})`);
          }

          const lock = locks[id];
          if (manifest.status === "released" || manifest.status === "deprecated") {
            if (!lock) errors.push(`${id}: released artifact is not locked`);
            else if (lock.size !== manifest.size || lock.sha256 !== manifest.sha256)
              errors.push(`${id}: released artifact differs from immutable lock`);
          } else if (lock) {
            errors.push(`${id}: candidate conflicts with immutable release lock`);
          }

          if (checkWebInstaller) {
            const installerPath = join(
              releasePath,
              "web-installer-manifest.json",
            );
            try {
              const installer = await readJson(installerPath);
              const expectedInstaller = createWebInstallerManifest(manifest);
              if (
                JSON.stringify(installer) !==
                JSON.stringify(expectedInstaller)
              ) {
                errors.push(`${id}: esp-web-tools manifest is stale`);
              }
            } catch (error) {
              if (error.code !== "ENOENT")
                errors.push(`${id}: invalid esp-web-tools manifest`);
            }
          }
          artifacts.push({ ...manifest, id, releasePath, firmwarePath });
        }
      }
    }
  } catch (error) {
    errors.push(`registry scan failed: ${error.message}`);
  }

  for (const id of Object.keys(locks)) {
    if (!identities.has(id)) errors.push(`${id}: immutable lock has no artifact`);
  }
  return { ok: errors.length === 0, errors, artifacts };
}

export class FirmwareRegistry {
  constructor(rootPath) {
    this.rootPath = resolve(rootPath);
  }

  async validatedArtifacts() {
    const result = await validateFirmwareRegistry(this.rootPath);
    if (!result.ok) {
      const error = new Error(`invalid firmware registry: ${result.errors.join("; ")}`);
      error.code = "INVALID_FIRMWARE_REGISTRY";
      throw error;
    }
    return result.artifacts;
  }

  async listReleased() {
    return (await this.validatedArtifacts())
      .filter((artifact) => artifact.status === "released")
      .map(publicManifest);
  }

  async listVersions(hardware, application) {
    return (await this.listReleased())
      .filter((item) => item.hardware === hardware && item.application === application)
      .sort((a, b) => compareSemver(b.applicationVersion, a.applicationVersion));
  }

  async resolve(hardware, application, version, { allowDeprecated = true } = {}) {
    const allowed = allowDeprecated
      ? new Set(["released", "deprecated"])
      : new Set(["released"]);
    const matching = (await this.validatedArtifacts()).filter(
      (item) => item.hardware === hardware &&
        item.application === application && allowed.has(item.status),
    );
    const selected = version === "latest"
      ? matching
        .filter((item) => item.status === "released")
        .sort((a, b) => compareSemver(b.applicationVersion, a.applicationVersion))[0]
      : matching.find((item) => item.applicationVersion === version);
    return selected ?? null;
  }
}

export function publicManifest(artifact) {
  return Object.fromEntries(REQUIRED_FIELDS.map((field) => [field, artifact[field]]));
}
