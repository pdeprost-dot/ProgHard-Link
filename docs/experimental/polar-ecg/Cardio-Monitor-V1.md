# ProgHard Link / Polar H10 external cardio monitor V1

> **Experimental technical demonstration. Not a medical device. Not intended
> for diagnosis, treatment, clinical monitoring, emergency use, or decisions
> concerning a person's health.**

## Scope and architecture

```text
Polar H10 -> BLE/PMD -> ESP32-C3 -> SampleBlock V1 -> MQTT LAN
                                                        |
                                                        v
                              Node.js decode/filter/QRS/RR/BPM
                                                        |
                                                       SSE
                                                        |
                                                  local browser
```

The monitor is independent of the embedded `/polar` page. Node.js performs
the decoding and analysis; the browser only renders block-oriented SSE data.
The ESP32 firmware, HTTP SampleBlock path and ESPway WAN tunnel are unchanged.

This version is LAN-only. It neither exposes MQTT/Node.js on the Internet nor
changes Caddy, the VPS, TLS, WireGuard, or the ESPway tunnel. WAN access to the
embedded oscilloscope continues to use HTTP over ESPway tunnel v2.

## MQTT configuration

At startup, `config.js` reads `tools/experimental/polar-ecg/polar-ecg-node/.env` when present. Direct
environment variables take precedence:

| Variable | Default |
| --- | --- |
| `MQTT_HOST` | `broker.lan` |
| `MQTT_PORT` | `1883` |
| `MQTT_USERNAME` | empty |
| `MQTT_PASSWORD` | empty |
| `MQTT_BASE_TOPIC` | `espway` |
| `MQTT_DEVICE_ID` | `esp-a1b2c3` |
| `HTTP_PORT` | `3000` |

The ECG topic is assembled as
`<MQTT_BASE_TOPIC>/<MQTT_DEVICE_ID>/polar/ecg/block`. Username and password
are passed to mqtt.js only when configured. `/api/config` deliberately omits
the password.

## SampleBlock and continuity

`sampleblock/decoder.js` validates SampleBlock V1 magic, version, 32-byte
header, sample count and exact payload length before decoding signed int32
microvolt samples. Sample time is reconstructed from
`firstSampleTimestampNs` and `sampleRateHz`, never from MQTT arrival time.

Block and sample sequences detect transport discontinuities. A gap clears
filter and QRS history and is sent to the browser, which visibly breaks the
trace. `NEW_SESSION` resets continuity, filters, QRS and RR without counting
the sequence restart as an error. `samplesDroppedBeforeBlock` remains a
separate source-drop counter. MQTT has no HTTP-envelope `GAP` flag; gaps are
derived from the two sequences.

## Filtering and QRS V1

The raw microvolt value is always preserved. The optional displayed filtered
trace uses two transparent first-order stages:

1. high-pass at approximately 0.7 Hz to reduce baseline wander;
2. low-pass at approximately 25 Hz to reduce high-frequency noise.

QRS detection runs on the filtered signal. It computes the first derivative,
squares it, integrates it over 120 ms, and compares local maxima with an
adaptive signal/noise threshold. A 250 ms refractory period prevents double
detection. The R position is refined to the largest absolute filtered
amplitude in the recent integration window.

RR is the timestamp difference between consecutive accepted R peaks. Values
outside 300–2000 ms are excluded from RR/BPM metrics. ECG BPM uses the median
of up to the five latest valid RR intervals after a three-interval warm-up.
The median reduces isolated V1 detector errors without modifying raw data.

The service reports R count, latest/mean/min/max RR, ECG BPM, Polar BPM/RR,
their observed ranges, and mean absolute differences. Polar and ECG values
remain explicitly separate.

## Browser UI and APIs

The monitor at <http://localhost:3000> provides:

- raw or filtered ECG and visible R markers;
- 2, 5 and 10 second windows with a timestamp-derived axis;
- Auto, ±500, ±1000, ±2000 and ±5000 µV scales;
- MQTT, Polar and ECG state;
- Polar BPM/RR and independently calculated ECG BPM/RR;
- effective sample rate and sequence/drop/error counters;
- non-secret MQTT host, port, device ID and topic.

Local APIs are `/api/status`, `/api/ecg/status`, `/api/config`, and `/events`.
SSE sends complete processed blocks, not one event per sample.

## Run and test

```text
cd tools/experimental/polar-ecg/polar-ecg-node
npm install
npm test
npm start
```

The automated tests cover malformed SampleBlocks, signed sample decoding, a
synthetic periodic ECG, BPM/RR calculation and `NEW_SESSION` reset.

## Limitations

- This is not medical software and produces no diagnosis.
- QRS V1 is intentionally understandable and lightweight, not certified.
- Motion artefacts, poor electrode contact and uncommon morphologies may
  create missed or false detections.
- No advanced HRV (SDNN, RMSSD, pNN50 or spectral analysis) is implemented.
- No database, patient/session record, long-term storage or history exists.
- MQTT remains QoS 0 and LAN-only; gaps are detected but not replayed.
