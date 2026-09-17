import crypto from "node:crypto";
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

const SHA256_RE = /^[a-f0-9]{64}$/i;
const MAX_URL_LENGTH = 240;
const MAX_VERSION_LENGTH = 32;

function failure(error, status = 400) {
  return { ok: false, error, status };
}

async function sha256File(path) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export async function prepareOtaCommand(
  body,
  { firmwareOrigin, firmwareDir, maxFirmwareBytes },
) {
  let input;
  try {
    input = JSON.parse(body.toString("utf8"));
  } catch {
    return failure("invalid_json");
  }
  if (!input || Array.isArray(input) || typeof input !== "object")
    return failure("invalid_json");
  if (typeof input.url !== "string") return failure("invalid_url");
  if (typeof input.sha256 !== "string" || !SHA256_RE.test(input.sha256))
    return failure("invalid_sha256");
  if (
    typeof input.firmwareVersion !== "string" ||
    input.firmwareVersion.trim().length === 0 ||
    input.firmwareVersion.trim().length > MAX_VERSION_LENGTH
  )
    return failure("invalid_firmware_version");
  if (
    input.size !== undefined &&
    (!Number.isSafeInteger(input.size) || input.size <= 0)
  )
    return failure("invalid_size");

  let url;
  let allowedOrigin;
  try {
    url = new URL(input.url);
    allowedOrigin = new URL(firmwareOrigin);
  } catch {
    return failure("invalid_url");
  }
  if (
    input.url.length > MAX_URL_LENGTH ||
    url.protocol !== "http:" ||
    url.origin !== allowedOrigin.origin ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.pathname.startsWith("/firmware/")
  )
    return failure("invalid_url");

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(url.pathname.slice("/firmware/".length));
  } catch {
    return failure("invalid_url");
  }
  const root = resolve(firmwareDir);
  const requestedPath = resolve(root, decodedPath);
  const childPath = relative(root, requestedPath);
  if (!decodedPath || childPath.startsWith("..") || isAbsolute(childPath))
    return failure("invalid_url");

  let metadata;
  let actualSha256;
  try {
    const canonicalRoot = await realpath(root);
    const firmwarePath = await realpath(requestedPath);
    const canonicalChild = relative(canonicalRoot, firmwarePath);
    if (canonicalChild.startsWith("..") || isAbsolute(canonicalChild))
      return failure("invalid_url");
    metadata = await stat(firmwarePath);
    if (!metadata.isFile()) return failure("firmware_not_found", 404);
    actualSha256 = await sha256File(firmwarePath);
  } catch {
    return failure("firmware_not_found", 404);
  }
  if (metadata.size <= 0 || metadata.size > maxFirmwareBytes)
    return failure("firmware_too_large");
  if (input.size !== undefined && input.size !== metadata.size)
    return failure("size_mismatch");
  if (input.sha256.toLowerCase() !== actualSha256)
    return failure("sha256_mismatch");

  return {
    ok: true,
    command: {
      url: url.toString(),
      sha256: actualSha256,
      firmwareVersion: input.firmwareVersion.trim(),
      size: metadata.size,
    },
  };
}

export async function prepareRegistryOtaCommand(
  body,
  { registry, firmwareOrigin, maxFirmwareBytes },
) {
  let input;
  try {
    input = JSON.parse(body.toString("utf8"));
  } catch {
    return failure("invalid_json");
  }
  if (!input || Array.isArray(input) || typeof input !== "object")
    return failure("invalid_json");
  const { hardware, application, applicationVersion } = input;
  if (
    typeof hardware !== "string" ||
    typeof application !== "string" ||
    typeof applicationVersion !== "string"
  ) {
    return failure("invalid_firmware_selector");
  }

  let artifact;
  try {
    artifact = await registry.resolve(
      hardware,
      application,
      applicationVersion,
      { allowDeprecated: false },
    );
  } catch {
    return failure("firmware_registry_unavailable", 503);
  }
  if (!artifact) return failure("released_firmware_not_found", 404);
  if (artifact.size > maxFirmwareBytes) return failure("firmware_too_large");

  const url = new URL(
    `/firmware/${artifact.id}/${artifact.file}`,
    firmwareOrigin,
  ).toString();
  return {
    ok: true,
    command: {
      url,
      sha256: artifact.sha256,
      firmwareVersion: artifact.applicationVersion,
      size: artifact.size,
    },
  };
}
