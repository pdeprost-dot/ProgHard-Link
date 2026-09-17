#!/bin/sh
set -eu

workspace=/workspace
output="$workspace/build/firmware/output"
espway="$workspace/firmware/esp8266/libraries/ESPway"
websockets="$workspace/third-party/arduinoWebSockets-2.7.2/source"

test -f "$espway/src/ESPway.h"
test -f "$websockets/src/WebSocketsClient.cpp"
test "$(sed -n 's/^version=//p' "$websockets/library.properties" | tr -d '\r')" = "2.7.2"

rm -rf /tmp/proghard-build-esp8266 /tmp/proghard-build-esp32 /tmp/proghard-build-esp32-c3 /tmp/proghard-build-esp32-c6
rm -rf /tmp/proghard-out-esp8266 /tmp/proghard-out-esp32 /tmp/proghard-out-esp32-c3 /tmp/proghard-out-esp32-c6
rm -rf "$output"
mkdir -p "$output/esp8266" "$output/esp32" "$output/esp32-c3" "$output/esp32-c6"

compile() {
  arduino-cli compile --clean --warnings all \
    --fqbn "$1" \
    --build-property 'compiler.c.extra_flags=-ffile-prefix-map=/root/.arduino15=/toolchain' \
    --build-property 'compiler.cpp.extra_flags=-ffile-prefix-map=/root/.arduino15=/toolchain' \
    --build-property 'compiler.S.extra_flags=-ffile-prefix-map=/root/.arduino15=/toolchain' \
    --library "$espway" \
    --library "$websockets" \
    --build-path "$2" \
    --output-dir "$3" \
    "$4"
}

# Keep ESP32-family builds sequential and give every target isolated paths.
compile 'esp8266:esp8266:nodemcuv2:eesz=4M2M' \
  /tmp/proghard-build-esp8266 /tmp/proghard-out-esp8266 \
  "$espway/examples/ProgHardLinkBase"
cp /tmp/proghard-out-esp8266/ProgHardLinkBase.ino.bin "$output/esp8266/firmware.bin"

compile 'esp32:esp32:esp32:PartitionScheme=min_spiffs' \
  /tmp/proghard-build-esp32 /tmp/proghard-out-esp32 \
  "$espway/examples/ProgHardLinkBaseESP32"
cp /tmp/proghard-out-esp32/ProgHardLinkBaseESP32.ino.merged.bin "$output/esp32/firmware.bin"

compile 'esp32:esp32:esp32c3:PartitionScheme=min_spiffs' \
  /tmp/proghard-build-esp32-c3 /tmp/proghard-out-esp32-c3 \
  "$espway/examples/ProgHardLinkBaseESP32"
cp /tmp/proghard-out-esp32-c3/ProgHardLinkBaseESP32.ino.merged.bin "$output/esp32-c3/firmware.bin"

compile 'esp32:esp32:esp32c6:FlashSize=8M,PartitionScheme=default_8MB,CDCOnBoot=cdc' \
  /tmp/proghard-build-esp32-c6 /tmp/proghard-out-esp32-c6 \
  "$espway/examples/ProgHardLinkBaseESP32"
cp /tmp/proghard-out-esp32-c6/ProgHardLinkBaseESP32.ino.merged.bin "$output/esp32-c6/firmware.bin"

sha256sum "$output"/*/firmware.bin
