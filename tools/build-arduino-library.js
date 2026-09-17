#!/usr/bin/env node

import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertSafeZipEntries,
  buildArduinoLibrary,
  publishArduinoLibrary,
  repositoryLibraryRoot,
} from "./arduino-library.js";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const outputRoot = resolve(
  process.argv[2] || join(repositoryRoot, "download-repository", "arduino", "ESPway"),
);
const result = await buildArduinoLibrary({
  sourceRoot: repositoryLibraryRoot(repositoryRoot),
});
assertSafeZipEntries(result.entries);
const { archivePath } = await publishArduinoLibrary(result, outputRoot);
console.log(`${archivePath}\n${result.metadata.size} bytes\nSHA-256 ${result.metadata.sha256}`);
