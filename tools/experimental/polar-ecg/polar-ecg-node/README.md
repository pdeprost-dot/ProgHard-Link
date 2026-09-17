# Polar H10 external cardio monitor V1

> **Experimental technical demonstration. Not a medical device. Not intended
> for diagnosis, treatment, clinical monitoring, emergency use, or decisions
> concerning a person's health.**

This LAN-only Node.js application receives binary SampleBlock V1 messages
from ESPway MQTT, detects R peaks, derives ECG RR/BPM, and serves an
independent browser monitor over Server-Sent Events.

## Run

```text
npm install
npm start
```

Open <http://localhost:3000>. The server enables ECG MQTT while running and
disables it during a graceful Ctrl+C shutdown.

Copy `.env.example` to `.env` to configure the local instance. `.env` and
`node_modules` are ignored by Git.

```env
MQTT_HOST=broker.lan
MQTT_PORT=1883
MQTT_USERNAME=
MQTT_PASSWORD=
MQTT_BASE_TOPIC=espway
MQTT_DEVICE_ID=esp-a1b2c3
HTTP_PORT=3000
```

Shell environment variables override `.env`. No password is returned by
`GET /api/config` or displayed in the browser.

## Interfaces

- `GET /`: real-time cardio monitor;
- `GET /events`: block-oriented SSE stream;
- `GET /api/status` and `GET /api/ecg/status`: acquisition and QRS metrics;
- `GET /api/config`: non-secret MQTT settings and connection state.

The UI offers RAW/FILTERED traces, 2/5/10-second windows, automatic and fixed
amplitude scales, timestamp-derived time axes, R markers, separate Polar and
ECG BPM/RR, and continuity counters.

The browser communicates only with this server. It never calls the ESP32,
`/polar`, or embedded ESPway JavaScript. See
`docs/experimental/polar-ecg/Cardio-Monitor-V1.md` for
the processing algorithm and limitations. This is an engineering monitor,
not a medical device.
