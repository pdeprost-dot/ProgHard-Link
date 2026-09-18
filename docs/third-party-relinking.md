# Rebuilding firmware with a modified arduinoWebSockets

ProgHard Link Base statically links arduinoWebSockets 2.7.2 under
LGPL-2.1-or-later. The exact unmodified upstream source and license are in
`third-party/arduinoWebSockets-2.7.2/`.

This procedure is for advanced contributors and recipients who want to modify
that library and relink the official Base firmware. It is not part of normal
Arduino application development.

## 1. Make an isolated working copy

Clone or copy the repository, then edit files below:

```text
third-party/arduinoWebSockets-2.7.2/source/src/
```

Do not edit a published firmware release in place. Keep the original tag and
your changes so the resulting binary remains attributable.

## 2. Build all supported targets

Install Docker Engine or another compatible container runtime, then run from
the repository root:

```bash
docker build --pull=false -f build/firmware/Dockerfile -t proghard-link-firmware:0.2.3 .
docker run --rm -v "$PWD:/workspace" proghard-link-firmware:0.2.3
```

The container uses only the repository's vendored arduinoWebSockets source.
It does not install another WebSockets library. Results appear as:

```text
build/firmware/output/esp8266/firmware.bin
build/firmware/output/esp32/firmware.bin
build/firmware/output/esp32-c3/firmware.bin
```

These correspond respectively to NodeMCU/Wemos-class ESP8266, generic ESP32
and generic ESP32-C3 with the release partition options recorded in
`docs/development.md`.

## 3. Verify the result

Record the build log, SHA-256 values printed by the script, your source diff,
container Dockerfile and source commit. A changed library should normally
produce a changed application binary. For a stronger linkage test, add a
temporary distinctive string to an executed arduinoWebSockets client method,
build ESP8266, and inspect the binary with `strings` or a binary-safe search.
Remove the marker and rebuild before distributing any firmware.

## 4. Flash without replacing official artifacts

Keep custom images outside `firmware-repository/`. Connect the development
board by USB and use the matching core's upload tool or Arduino IDE custom
build workflow. For an already provisioned device, a trusted operator may use
the local or remote ProgHard Link OTA path after recording the expected hash.

ESP8266 output is a sketch image for its normal application offset. ESP32 and
ESP32-C3 outputs are merged images intended for offset zero. Confirm the board,
flash size and offset before writing; flashing the wrong target can erase its
configuration and requires recovery over USB.

## Normal Arduino IDE development remains separate

For an ordinary application, import `ProgHard-Link-0.4.11.zip`, include
`ESPway.h`, compile in Arduino IDE, then use **Sketch > Export Compiled Binary**.
The exported `.bin` can be installed through the documented ProgHard Link OTA
workflow. Docker, Arduino CLI and the official Base build image are not needed.
