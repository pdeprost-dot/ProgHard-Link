# ESPway Polar H10 demo

> **Experimental technical demonstration. Not a medical device. Not intended
> for diagnosis, treatment, clinical monitoring, emergency use, or decisions
> concerning a person's health.**

This first ESP32 example validates the path **Polar H10 -> BLE -> ESP32 -> Serial**.
It automatically scans and reconnects, subscribes to the standard Heart Rate
Measurement characteristic (BPM and RR), then starts raw Polar PMD ECG at
130 Hz. It intentionally does not enable Wi-Fi, MQTT, OTA, or the ESPway tunnel:
BLE/ECG is validated in isolation before those subsystems are combined.

## Requirements

- An ESP32 board with Bluetooth LE (the generic `ESP32 Dev Module` profile is
  the portable default; ESP32-S2 has no Bluetooth and is not supported).
- Polar H10 sensor and chest strap. No wires are required between them.
- Arduino ESP32 core 3.3.6 (version used for this validation).
- NimBLE-Arduino 2.5.1 (installed version used for the current compile and
  hardware validation).

Wet the strap electrodes, snap the H10 onto the strap, and wear it. Close Polar
Flow and other applications that might already hold the sensor connection.

Hardware validation was performed with an ESP32-C3 QFN32 revision 0.4, 4 MB
embedded flash, using the `ESP32C3 Dev Module` profile and USB Serial/JTAG.

## Arduino IDE

1. Add `https://espressif.github.io/arduino-esp32/package_esp32_index.json`
   to the Additional Boards Manager URLs.
2. Install **esp32 by Espressif Systems** and **NimBLE-Arduino** from Library
   Manager.
3. Set the sketchbook directory to `firmware/esp8266` (the historic directory
   name is retained for compatibility), then open **File > Examples > ESPway >
   PolarH10Demo**.
4. Select the exact detected board when known, otherwise **ESP32 Dev Module**,
   its COM port, and upload.
5. Open Serial Monitor at 115200 baud.

Expected diagnostic output includes `HR=72 BPM`, `RR=842 ms`, and throttled
`ECG=-123 uV` lines. All ECG samples pass through a 512-entry circular buffer;
the diagnostic display prints one sample in 13 to keep logs readable.

For Arduino Serial Plotter, send `p` in Serial Monitor and then open Serial
Plotter at 115200 baud. It prints one raw ECG value in microvolts per line at
130 Hz. Send `d` to return to diagnostics. The compile-time defaults
`START_IN_PLOTTER_MODE` and `BLE_DEBUG_LOGS` are at the top of the `.ino`.

## Protocol notes and limits

The implementation uses the standard Heart Rate Service UUID `0x180D` and
Measurement UUID `0x2A37`. RR units are 1/1024 second and are converted to
milliseconds. Polar PMD uses service `FB005C80-...`, control `FB005C81-...`,
and data `FB005C82-...`. The H10 ECG request selects 130 Hz and 14-bit input;
uncompressed samples are signed 24-bit little-endian microvolts. Packet
timestamps are nanoseconds in the Polar epoch; per-sample timestamps are
interpolated at 130 Hz and a monotonic sample counter is also emitted.
The H10 used for hardware validation required a bonded, encrypted BLE link for
PMD; the client establishes this automatically using BLE Secure Connections
with no passkey.

- The sensor must be worn to advertise reliably.
- Only the H10 uncompressed ECG frame type is decoded in this first version.
- PMD failure does not stop standard BPM/RR reception.
- MQTT batching and ESPway UI integration are deliberately deferred until the
  physical BLE/ECG path has been validated.

## ESPway compatibility status

This demo deliberately excludes ESPway networking so the BLE path can be
tested in isolation. ESPway itself supports ESP8266 and ESP32; use
`PolarH10ESPwayDemo` for the combined Wi-Fi, HTTP/WAN, MQTT and ECG example.
