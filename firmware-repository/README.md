# ProgHard Link Firmware Registry V1

The initial public registry contains only ProgHard Link Base 0.2.3 for ESP8266,
ESP32, ESP32-C3 and ESP32-C6.

```text
hardware/application/version/
├── firmware.bin
├── manifest.json
└── web-installer-manifest.json
```

Each internal manifest records status, hardware, application and framework
versions, exact size, SHA-256 and filename. `released.json` is the immutable
release lock. Validate the registry with:

```bash
node tools/validate-firmware-registry.js
```

ESP32, ESP32-C3 and ESP32-C6 files are merged images flashed at offset zero. The Web
Installer manifests are derived from the internal manifests and checked by the
validator. Never replace a public released binary in place; increment its
application version.
