# ECG SampleBlock V1 over MQTT

> **Experimental technical demonstration. Not a medical device. Not intended
> for diagnosis, treatment, clinical monitoring, emergency use, or decisions
> concerning a person's health.**

## Architecture and scope

The Polar H10 is sampled by `PolarH10ProgHardLinkDemo` over BLE/PMD at 130 Hz. Each
completed SampleBlock V1 is inserted into the existing HTTP ring and may also
be published to the LAN MQTT broker:

```text
Polar H10 -> ESP32-C3 -> HTTP SampleBlock ring -> ESPway LAN/WAN UI
                        |
                        +-> LAN MQTT -> Node.js -> local browser
```

The two transports carry the same logical SampleBlock. MQTT does not replace
`GET /api/polar/ecg/blocks` and the external browser never calls the ESP32.

> Le broker MQTT utilisé actuellement est local au LAN. Le flux ECG MQTT
> n'est donc testé et supporté ici qu'en LAN.

> L'accès WAN à l'oscilloscope ESPway reste assuré par HTTP via le tunnel
> ESPway v2.

No broker port is exposed to the Internet, and this feature does not modify
Caddy, TLS, WireGuard, the VPS, or the ESPway tunnel.

## Topics and activation

With the default base topic, the data topic is:

```text
espway/<deviceId>/polar/ecg/block
```

For the validated device it is
`espway/esp-a1b2c3/polar/ecg/block`. Its payload is binary, QoS 0 and not
retained. Blocks contain alternately 32 or 33 samples, producing approximately
four MQTT publications per second rather than 130 publications per second.

Raw ECG MQTT starts disabled after every ESP boot. Control it by publishing a
non-retained command:

```text
espway/<deviceId>/polar/ecg/mqtt_enabled/set = on | 1
espway/<deviceId>/polar/ecg/mqtt_enabled/set = off | 0
```

The current state is reported as retained `on` or `off` on
`polar/ecg/mqtt_enabled`. Turning MQTT ECG off affects only publication; BLE
acquisition, PMD streaming and the HTTP ring continue normally. Broker outages
also drop MQTT history deliberately: after reconnection the live stream
resumes at the current sequence.

## Binary payload

The payload is exactly SampleBlock V1, serialized field by field in little
endian order (never as a raw C++ structure):

| Offset | Size | Field |
| ---: | ---: | --- |
| 0 | 2 | magic `0xEC01` |
| 2 | 1 | version `1` |
| 3 | 1 | flags (`NEW_SESSION = 0x01`) |
| 4 | 4 | sourceId |
| 8 | 4 | blockSequence |
| 12 | 4 | firstSampleSequence |
| 16 | 8 | firstSampleTimestampNs |
| 24 | 2 | sampleRateHz |
| 26 | 2 | sampleCount |
| 28 | 2 | samplesDroppedBeforeBlock |
| 30 | 2 | headerSize (`32`) |
| 32 | 4 x count | signed int32 samples in microvolts |

A full 33-sample block is 164 bytes. Including the topic and MQTT framing, it
fits comfortably in ESPway MQTT V2's existing 768-byte wire buffer; the buffer
was not enlarged.

`NEW_SESSION` resets client-side continuity expectations. SampleBlock V1 has
no separate `GAP` flag: `GAP` belongs to the HTTP response envelope. MQTT
consumers detect transport gaps by comparing `blockSequence` and
`firstSampleSequence`, while `samplesDroppedBeforeBlock` reports source-side
drops. Consumers must report gaps and must not interpolate them silently.

## Independent Node.js monitor

The reference consumer is in `tools/experimental/polar-ecg/polar-ecg-node`. It uses Node.js and
`mqtt.js`, validates every header and payload length, decodes the signed int32
microvolt samples, checks continuity, and serves a small oscilloscope over SSE.

```powershell
cd tools/experimental/polar-ecg/polar-ecg-node
npm install
npm start
```

Then open <http://localhost:3000>. The server enables ECG MQTT on broker
connection and sends `off` during a graceful Ctrl+C shutdown. Override its
defaults with `MQTT_URL`, `DEVICE_ID`, `BASE_TOPIC`, and `PORT`; see the local
README for an example.

The page offers 2, 5 and 10 second windows and displays BPM, Polar state,
effective sample rate, gaps, last block sequence and total samples. Its signal
source is exclusively `MQTT -> Node.js -> SSE -> browser`.

## Limitations

- Transport is QoS 0 with no replay; loss is detected, not repaired.
- Activation is runtime state and intentionally resets to off at ESP boot.
- The reference server is a LAN diagnostic/demo tool, not a hardened service.
- This layer performs no filtering, QRS detection, HRV analysis or medical
  interpretation.
- The example broker is `mqtt://broker.lan:1883` without TLS and is for
  trusted-LAN use only.
