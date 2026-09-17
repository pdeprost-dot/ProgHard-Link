# Public download repository

This repository is separate from the device Firmware Registry. It contains
public, versioned developer downloads generated from source.

Arduino library releases live under `arduino/ESPway/<version>/`. The ZIP,
`metadata.json` and `released.json` are release artifacts intentionally tracked
in Git. Generate them with:

```text
node tools/build-arduino-library.js
```

The builder uses an allowlist, deterministic ZIP metadata and an immutable
release lock. It refuses to overwrite a released version when its size or
SHA-256 differs. Never edit a released ZIP or its metadata manually; publish a
new version instead.
