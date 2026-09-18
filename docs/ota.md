# OTA

The advanced `/ota` page works over LAN HTTP and the public device HTTPS endpoint.
The browser calculates the firmware SHA-256, requests a one-use challenge and
derives an OTA authorization key from the individual device token. It sends a
multipart upload with the decimal size, lowercase hexadecimal digest and HMAC
proof. The token and derived key are never sent.

The canonical proof input is UTF-8, uses LF separators and has no trailing LF:

```text
ESPWAY-OTA-AUTH-1
<deviceId>
<64-character challenge nonce>
<decimal firmware size>
<lowercase SHA-256>
```

The challenge expires after 60 seconds and is invalidated before comparison,
so failed and successful attempts cannot be replayed. Only one OTA may run per
device. Current firmware announces `otaMaxBytes`, derived from the real next
OTA partition capacity. Older firmware without this signed metadata is limited
conservatively to 1 MiB.

For the normal remote workflow, Device Manager accepts a `.bin`, calculates
its SHA-256 in the browser and streams it to the device. The authenticated
server verifies session ownership and CSRF, obtains the one-use challenge,
loads the Device Token from its private device registry and computes the HMAC
proof. The user never enters or receives the Device Token in this workflow.

## Streaming

On LAN, the ESP8266 web server passes multipart file blocks directly to the OTA
sink. Remotely, Node parses multipart data incrementally and emits 512-byte
firmware chunks. It never calls a whole-body reader for `/ota/upload`.

The tunnel uses an OTA-specific `open`, waits for an explicit `ack` with
`received: 0`, then sends one `data` frame at a time. Node pauses consumption of
the HTTP request until the ESP acknowledges the cumulative byte count. The
maximum window is therefore one chunk. A final `close` is sent only after the
declared size has been streamed.

The ESP writes each decoded chunk directly with `Update.write()` while updating
BearSSL SHA-256 state. `Update.end(true)` is called only when the exact byte
count and digest match. Timeout, disconnect, malformed metadata, oversized
chunks and write or digest failures abort the update without rebooting.

The server operational defaults are `ESPWAY_MAX_OTA_UPLOAD_BYTES=8388608` and
`ESPWAY_MAX_FIRMWARE_BYTES=8388608`; the effective upload/Registry limit
remains the smaller of the applicable server value and the device capacity.
`ESPWAY_LEGACY_OTA_MAX_BYTES=1048576` controls the old-firmware fallback and
`ESPWAY_OTA_UPLOAD_TIMEOUT_MS=120000` controls the streaming timeout.
