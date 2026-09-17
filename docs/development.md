# Development and release builds

## Validated toolchain

The first public firmware baseline was built with:

| Component | Version |
|---|---:|
| Arduino CLI | 1.5.2-rc.1 |
| ESP8266 Arduino core | 3.1.2 |
| Arduino-ESP32 core | 3.3.11 |
| ArduinoJson | 7.4.2 |
| arduinoWebSockets | 2.7.2 |
| PubSubClient | 2.8 |
| NimBLE-Arduino, experimental Polar examples | 2.5.1 installed; validate per example |

The core packages resolve the following compiler toolchains: ESP8266
`xtensa-lx106-elf-gcc` package `3.1.0-gcc10.3-e5f9fec` (GCC 10.3.0), and
ESP32 `esp-x32` plus ESP32-C3 `esp-rv32` package `2601` (GCC 14.2.0,
Espressif crosstool-NG `esp-14.2.0_20260121`). These are installed by the
pinned core releases rather than downloaded separately by the project.

## Choose the right workflow

Normal application development uses Arduino IDE: import the public ProgHard
Link library ZIP, include the compatibility header `ESPway.h`, write and
compile a normal sketch, then select **Sketch > Export Compiled Binary**. The
resulting `.bin` can be installed with the documented LAN or remote OTA flow.
This workflow requires neither Docker, Arduino CLI, Node.js nor the official
Base firmware build environment.

The container under `build/firmware/` is only for maintainers reconstructing
official ProgHard Link Base releases or recipients relinking a modified
arduinoWebSockets. See [third-party relinking](third-party-relinking.md).

## Server

```bash
cd server
npm ci
npm test
npm run simulator
```

The simulator needs an explicitly configured test identity. Never use a real
production token in a development shell or committed file.

## Library layout

Use `--library firmware/esp8266/libraries/ESPway` explicitly. A broad
`--libraries` search may silently select a stale copy installed elsewhere.

Applications implement `ESPwayApplication`, keep `loop()` non-blocking and own
only their routes and state. Compatibility identifiers in the library are
deliberately retained.

## Official Base release environment

Compilers can embed absolute source and core paths in firmware. Official public
images are built in the digest-pinned container documented in
`build/firmware/README.md`, where the repository is always mounted at
`/workspace`. Scan the resulting binaries before publication.

Build ESP32 and ESP32-C3 sequentially. Give every target an isolated build
directory; shared parallel caches have produced corrupt cross-architecture
objects in testing.

Equivalent release commands executed by the container are:

```bash
docker build --pull=false -f build/firmware/Dockerfile -t proghard-link-firmware:0.2.3 .
docker run --rm -v "$PWD:/workspace" proghard-link-firmware:0.2.3
```

The internal script supplies both `--library firmware/esp8266/libraries/ESPway`
and `--library third-party/arduinoWebSockets-2.7.2/source` explicitly. It never
downloads a substitute WebSockets library.

Use the ESP8266 sketch `.bin` and the ESP32/ESP32-C3 `.merged.bin` images. The
merged 4 MiB images include bootloader, partition table, boot application and
application and are flashed at offset zero.

## Public Base 0.2.3 artifacts

| Target | Size | SHA-256 |
|---|---:|---|
| ESP8266 | 559984 | `9108b08739237bc6a70e4ddb2f5d1115318c164347bde61100d83958650df1d3` |
| ESP32 | 4194304 | `6865daa11e4f580edfe3720b573ba046ab5371955e36d8af762f824f856ef43b` |
| ESP32-C3 | 4194304 | `b8350ee72f6333078a5351e1e2f2af9dd24c53d468043b977e835f0eae9a5ecf` |

ESP8266 used 46,536/80,192 bytes global RAM, 60,959/65,536 bytes IRAM and
509,656/1,048,576 bytes flash code. ESP32 used 1,292,451/1,966,080 bytes
program storage and 52,056/327,680 bytes globals. ESP32-C3 produced a
1,395,929-byte application inside its 4 MiB merged image.

## Release validation

```bash
node tools/build-arduino-library.js
node tools/validate-firmware-registry.js
cd server && npm test
```

Released Registry and Arduino ZIP artifacts are immutable. Publish a new
version rather than replacing already public bytes. Before publication scan
binaries for personal paths, credentials, unintended domains and SSIDs, and
review [third-party notices](../THIRD_PARTY_NOTICES.md).
