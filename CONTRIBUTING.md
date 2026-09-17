# Contributing

Open an issue before a large change. Keep public branding as “ProgHard Link”
while preserving documented compatibility identifiers. Do not commit secrets,
local captures, build caches or generated diagnostics.

Before proposing a change, run `npm ci` and `npm test` under `server/`, then
`node tools/validate-firmware-registry.js` and `git diff --check` at the root.

Firmware changes must document Arduino CLI, core, FQBN, partition scheme,
dependency versions, size and SHA-256. Released artifacts are immutable: use a
new version instead of replacing published bytes. Build ESP32 targets
sequentially with isolated build directories.

Contributions are expected to be compatible with the repository's MIT license.
Third-party code must include its origin and license.
