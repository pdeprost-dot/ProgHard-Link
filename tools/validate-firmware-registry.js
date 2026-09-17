#!/usr/bin/env node

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFile } from "node:fs/promises";
import {
  createWebInstallerManifest,
  validateFirmwareRegistry,
} from "../server/src/firmware-registry.js";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const arguments_ = process.argv.slice(2);
const registryArgument = arguments_[0] &&
  arguments_[0] !== "--write-web-installer"
  ? arguments_[0]
  : null;
const registryRoot = registryArgument
  ? resolve(registryArgument)
  : resolve(repositoryRoot, "firmware-repository");
const selectorIndex = arguments_.indexOf("--write-web-installer");
let result = await validateFirmwareRegistry(registryRoot, {
  checkWebInstaller: selectorIndex === -1,
});

if (!result.ok) {
  for (const error of result.errors) console.error(`ERROR: ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Firmware Registry valid: ${result.artifacts.length} artifacts`);
  if (selectorIndex !== -1) {
    const id = arguments_[selectorIndex + 1];
    const artifact = result.artifacts.find((item) => item.id === id);
    if (!artifact || artifact.status !== "released") {
      console.error("ERROR: Web Installer requires an explicit released artifact");
      process.exitCode = 1;
    } else {
      const output = resolve(
        artifact.releasePath,
        "web-installer-manifest.json",
      );
      await writeFile(
        output,
        `${JSON.stringify(createWebInstallerManifest(artifact), null, 2)}\n`,
      );
      console.log(`Wrote ${output}`);
      result = await validateFirmwareRegistry(registryRoot);
      if (!result.ok) {
        for (const error of result.errors) console.error(`ERROR: ${error}`);
        process.exitCode = 1;
      }
    }
  }
}
