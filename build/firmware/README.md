# Official Base firmware build

This container is for maintainers who reconstruct official ProgHard Link Base
firmware. It is not needed to install the server, use the Web Installer, or
develop an Arduino sketch.

From the repository root:

```bash
docker build --pull=false -f build/firmware/Dockerfile -t proghard-link-firmware:0.2.3 .
docker run --rm -v "$PWD:/workspace" proghard-link-firmware:0.2.3
```

The three results are written below `build/firmware/output/`. The build script
selects the vendored arduinoWebSockets 2.7.2 directory explicitly and builds
ESP32 targets sequentially in isolated directories.

The base image is digest-pinned. Arduino CLI and every direct Arduino
dependency are version-pinned; the CLI archive is checked before extraction.
Core package indexes resolve those exact versions and their upstream checksums.

Resolved compiler packages are `xtensa-lx106-elf-gcc`
`3.1.0-gcc10.3-e5f9fec` (GCC 10.3.0) for ESP8266 and Espressif `esp-x32`
plus `esp-rv32` `2601` (GCC 14.2.0, crosstool-NG
`esp-14.2.0_20260121`) for ESP32 and ESP32-C3.
