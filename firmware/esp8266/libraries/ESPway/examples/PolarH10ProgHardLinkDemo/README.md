# PolarH10ProgHardLinkDemo

> **Experimental technical demonstration. Not a medical device. Not intended
> for diagnosis, treatment, clinical monitoring, emergency use, or decisions
> concerning a person's health.**

This ESP32-only Arduino example runs ESPway Wi-Fi, provisioning, local HTTP
and OTA services alongside the reusable NimBLE `PolarH10Client`.

Requirements:

- an ESP32 with Bluetooth LE (validated on ESP32-C3);
- Arduino-ESP32 3.3.6;
- NimBLE-Arduino 2.5.1;
- the `Minimal SPIFFS (1.9 MB APP with OTA / 128 KB SPIFFS)` partition on the
  validated 4 MB ESP32-C3.

The Polar H10 is optional at boot. The client scans asynchronously and retries
without preventing ESPway from serving requests. `GET /api/polar` returns the
current connection state, BPM, latest RR interval, ECG streaming state,
nominal sample rate, received-sample counter, dropped-sample counter and Polar
address when known.

`GET /api/polar/ecg/blocks?after=<sequence>&max=<count>` returns recent ECG
SampleBlock V1 records as `application/octet-stream`. The default and maximum
response count is four. The 16-block ring provides about four seconds of
history and explicitly reports when a client falls behind it. See
`SampleBlock-V1.md` in the ESPway library root for the binary format.

Open `/polar` for the built-in ECG oscilloscope. The responsive canvas uses
the same relative HTTP endpoints in local and projected ESPway pages. It polls
SampleBlock records sequentially (without overlapping requests), keeps a
fixed-size browser buffer, and offers 2, 5 and 10 second windows plus automatic
or fixed vertical scales. Pause and background-tab modes suspend ECG polling;
gaps and new sessions clear stale samples before acquisition resumes.

Commands `p` and `d` retain the Serial Plotter and diagnostic modes.

When generic ESPway MQTT is enabled, the example publishes these suffixes
under the configured base topic (default `espway/<deviceId>`):

- `polar/status`: retained `searching`, `connected` or `disconnected`;
- `polar/heart_rate`: retained BPM on change and every ten seconds;
- `polar/rr`: each new RR interval, not retained;
- `polar/ecg/status`: retained `stopped` or `streaming`.
- `polar/ecg/mqtt_enabled`: retained `on` or `off` state;
- `polar/ecg/block`: SampleBlock V1 binary payload, QoS 0, not retained.

Raw ECG publication is disabled after every boot. Publish `on` (or `1`) to
`polar/ecg/mqtt_enabled/set` to enable it, and `off` (or `0`) to stop it.
This does not stop BLE acquisition or the HTTP SampleBlock ring. See
`docs/experimental/polar-ecg/ECG-MQTT.md` and
`tools/experimental/polar-ecg/polar-ecg-node` for the independent LAN client.
