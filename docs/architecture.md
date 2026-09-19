# ProgHard Link architecture

This document describes the first public self-hosted architecture. The stack is
one Docker Compose project with persistent application and Caddy volumes; it
does not require a host-installed reverse proxy.

## Public portal

The lightweight public portal is served directly by `espway-server` when the
request Host exactly matches `ESPWAY_DOMAIN`. This branch runs before
device-host resolution and is deliberately isolated from Device Manager,
Firmware Registry, tunnel and device proxy routes. It serves static HTML/CSS
plus an explicit, immutable Arduino library download resolved from the separate
`download-repository`.

The project Caddy is part of the same Docker Compose stack. It owns public TCP
ports 80 and 443, while the Node service remains reachable only on the private
Compose network. The apex hostname needs its own DNS record because a wildcard
record does not cover the apex itself.

ProgHard Link is local-first. The device owns its HTTP interface and application
routes; LAN access therefore continues without Internet or a ProgHard Link server.

For remote access the device opens one outbound WebSocket connection to
`ws://tunnel.<ESPWAY_DOMAIN>/tunnel`. The server accepts only
`espway-tunnel/2`. Authentication, signed framing, sequencing and selective
encryption are provided by the application protocol described in
`protocol.md`.

Browser traffic remains HTTPS on
`https://esp-<deviceId>.<baseDomain>/`. Caddy terminates browser TLS and sends
the root-relative HTTP request to the Node server, which correlates it with a
tunnel stream. No device-specific Caddy configuration is required.

The firmware framework owns identity, Config V4, dual Wi-Fi recovery, local
HTTP, MQTT, the tunnel, diagnostics and OTA. Applications implement the public
`ESPwayApplication` lifecycle and remain independent of transport internals.

The tunnel uses OPEN/DATA/CLOSE streams with independent identifiers. This
allows concurrent requests and future bounded streaming without buffering a
whole response. Backpressure remains required before high-rate camera streams
are introduced.

## Firmware Registry V1

`firmware-repository` is the single filesystem source of truth for firmware.
Each artifact is addressed by hardware, application and application version,
then verified by its immutable size and SHA-256. The model is hardware-neutral;
the current public registry contains ESP8266, ESP32, ESP32-C3 and ESP32-C6 artifacts,
without embedding those values in registry logic.

The Node server exposes read-only release metadata and explicit firmware files.
The Web Installer manifest is derived from the ProgHard Link Base registry manifest.
Registry-backed remote OTA resolves a released identity before sending exact
version, size, SHA-256 and URL through tunnel v2. Device Manager also accepts a
user-supplied `.bin` for authenticated remote streaming OTA without adding it
to the Registry.

## Device Manager V1

The Device Manager is an admin-host-only product layer. It merges the
persistent authorized-device file with the in-memory tunnel registry, so
offline devices remain visible while connection state stays live. It uses the
Firmware Registry for semantic current/latest status and exact released OTA
targets, and offers a separate upload path for a user's `.bin`. See
`device-manager.md` for its API and security boundary.

## Authentication and multi-user V1

Human identities and relationships are stored in SQLite. An `admin` has global
device access; a `user` is authorized only through an explicit `user_devices`
relationship. The same server-side check filters Device Manager and
observability responses and gates every generic request before it enters a
device tunnel. Browser access uses a short-lived one-time ticket followed by a
device-host-only cookie. Automation uses revocable Personal API Tokens.

These controls do not modify device authentication. Device tokens, tunnel
HMAC, AEAD, MQTT configuration and OTA device proofs remain a separate machine
security domain. See `authentication.md`.
