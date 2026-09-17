# OTA

The same `/ota` page works over LAN HTTP and the public device HTTPS endpoint.
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
so failed and successful attempts cannot be replayed. The firmware limit is
1 MiB and only one OTA may run per device.

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

The server defaults are `ESPWAY_MAX_OTA_UPLOAD_BYTES=1048576` and
`ESPWAY_OTA_UPLOAD_TIMEOUT_MS=120000`.
