# Device Manager V1

The Device Manager is the authenticated user interface at
`https://admin.<ESPWAY_DOMAIN>/`. Sign in, open **Devices** to see ownership,
online state, telemetry and firmware status, and use **Details** for management.
Administrators can manage users and all devices; ordinary users see only their
assigned devices.

New devices should normally be added through enrollment from the ESP's LAN
page. Review the device name, hardware, public application label and Device ID,
then confirm **Register device**. Use **Delete device** to revoke its machine
credential and ownership associations; do not edit `devices.json` manually.

For remote access use **My devices → Open**, not a direct wildcard URL. See
[remote access](remote-access.md).

Device Manager is the small administrative layer above the ESPway tunnel. It
uses the existing live `DeviceRegistry` and the persistent allowlist in
`data/devices.json`; it does not introduce a database or change device
firmware.

## Deployment boundary

The UI and API are served only when the HTTP `Host` equals
`admin.<ESPWAY_DOMAIN>`. The Caddy service in the project Compose stack
terminates TLS and forwards that hostname, but human authentication and
authorization remain enforced by the Node application:

```caddyfile
admin.{$ESPWAY_DOMAIN} {
    reverse_proxy server:3000
}
```

Device, installer and tunnel hostnames cannot access `/api/admin/*` or the
manager pages. Without an application session, pages redirect to `/login` and
administrative APIs return `401`. The application additionally requires JSON and the
`X-ESPway-Admin-Request: 1` header for every write, and rejects a foreign
`Origin` or `Referer`.

## Pages and refresh

- `/` and `/devices` list every authorized device, including offline devices.
- `/devices/<deviceId>` shows identity, signed metadata, connection state,
  capabilities and Firmware Registry status.
- The UI polls the read-only API every five seconds.
- **Open device** links directly to the device HTTPS hostname.

The frontend uses native HTML, CSS and JavaScript. Untrusted values are added
with `textContent`, never interpreted as HTML.

## Admin API

```text
GET  /api/admin/devices
GET  /api/admin/devices/:deviceId
GET  /api/enrollments/:temporaryToken
POST /api/enrollments/:temporaryToken/claim
POST /api/admin/devices/:deviceId/enable
POST /api/admin/devices/:deviceId/disable
POST /api/admin/devices/:deviceId/ota
```

Devices are normally created through Enrollment V1. A fresh device creates its
own 256-bit machine credential and submits it over verified HTTPS to the public
`POST /api/enrollments` endpoint. The browser claim URL contains a distinct
short-lived, one-time token. Claim confirmation atomically persists the machine
credential and assigns ownership to the authenticated user. No human-facing
response contains the permanent credential. Read APIs use explicit field
allowlists.

Disabling a device is deliberately non-disruptive: an existing tunnel remains
active, but subsequent authentication is refused. Re-enabling takes effect
immediately. Physical deletion and automatic token rotation are outside V1.

For controlled operational restoration, `SIGHUP` reloads the complete file
into the existing process without restarting it. This is not a public delete
API. A malformed replacement is rejected and leaves the current in-memory
registry untouched.

## Persistent and live state

`devices.json` remains the source for authorization, token, enabled state and
the most recent useful metadata. Writes use a same-directory temporary file,
an atomic rename and restrictive file permissions. The Docker data mount is
writable for this reason. Existing tokens supplied through
`ESPWAY_DEVICE_TOKENS` remain supported; a per-device token in `devices.json`
takes precedence.

Online state and `connectedSince` remain memory-only. A signed hello and a
disconnect update persisted `lastSeen`; ordinary tunnel packets do not cause
disk writes.

## Firmware and OTA

The manager compares valid semantic versions numerically. Only `released`
Registry artifacts can be latest or an OTA target; candidate and deprecated
artifacts are excluded by the Registry rules. Unsupported version strings are
reported rather than guessed.

OTA requires an online, metadata-verified tunnel v2 device with the
`http-ota` capability. The browser submits only the target version. The server
resolves that version to one exact released artifact, then sends its exact
application, version, size, SHA-256 and controlled Registry URL through the
existing OTA path. The confirmation dialog shows these values before sending.
The UI can explicitly reinstall the current released version; it never starts
an OTA automatically and never accepts an arbitrary URL.

## Current limitations

Heap, largest free block, fragmentation and reset information are not in the
signed tunnel hello, so Device Manager does not invent or display them. Stored
device tokens are plaintext at rest for compatibility with the current tunnel;
filesystem access control is therefore security-critical.
# Observability V1 Phase A

The server collects a small operational snapshot through the existing HTTP
tunnel. A single global scheduler polls online devices every 30 seconds, with
up to five seconds of jitter before the first poll after a connection. Wi-Fi
and MQTT are fetched sequentially with a dedicated four-second timeout, so a
device uses at most one telemetry stream at a time. A cycle is skipped while
another stream is active or while the previous telemetry cycle is unfinished;
interactive requests therefore remain the priority.
The scheduler starts at most four device cycles at once; additional due cycles
are skipped until a later scheduler tick instead of being queued.

Only `GET /api/espway/wifi` and `GET /api/espway/mqtt` are used. The last
sanitized sample is held in RAM and disappears when the server restarts. It is
marked stale when the device is offline or after 90 seconds without a
successful endpoint response. A failure from one endpoint does not discard a
successful response from the other.

The admin API and Device Manager expose connection state, active and
last-known-good Wi-Fi profiles, active SSID, LAN address, RSSI, recovery AP
state, and the MQTT enabled/connected state, broker, port, and base topic.
Passwords, password flags, MQTT usernames, complete Wi-Fi profiles, BSSIDs,
tokens, and cryptographic material are neither cached nor returned. Phase A
does not parse the diagnostics HTML and does not collect uptime, reset reason,
heap, flash, or boot counters. No firmware or tunnel protocol change is
required.
