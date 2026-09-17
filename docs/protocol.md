# ProgHard Link tunnel protocol

`espway-tunnel/2` is a compatibility identifier and remains intentionally named
after the project's development history. It is the only supported tunnel
protocol in the first public baseline.

The only device protocol is `espway-tunnel/2`, transported over plain HTTP
WebSocket at `ws://tunnel.<baseDomain>/tunnel`.

The server first sends an unsigned challenge containing:

- `tunnelProtocol: espway-tunnel/2`;
- `authProtocol: ESPWAY-AUTH-1`;
- a random 32-byte `serverNonce` encoded as hexadecimal.

The device answers with `type: auth`, `authProtocol`, `deviceId`, a random
`deviceNonce` and `authMac`. The MAC authenticates the protocol, identity and
both nonces with the individual device token. Session keys are derived with
`ESPWAY-SESSION-1` and separate C2S/S2C labels.

After the signed `hello-ack`, the device sends a signed hello containing the
tunnel protocol, identity, name, hardware, application, application version,
framework version and capabilities. The server registers no device metadata
before validating this hello. Current capabilities include `aead-selective`,
the explicit platform cipher (`aead-chacha20-poly1305` or
`aead-aes-128-gcm`), `http-ota` and `mqtt`.

Every subsequent frame uses `ESPWAY-FRAME-1`, a strict monotonically increasing
sequence and an HMAC-SHA256. A bad MAC, replay, skipped sequence, old session or
oversized frame closes the connection.

HTTP requests use `open`, zero or more `data`, and `close` frames sharing one
`streamId`. Secret-writing endpoints use `ESPWAY-AEAD-1`: ESP8266 advertises
and uses ChaCha20-Poly1305, while ESP32 and ESP32-C3 advertise and use
AES-128-GCM from mbedTLS. The envelope carries the selected algorithm. Its AAD
binds direction, sequence, stream, frame type, method and path. The 12-byte
nonce combines a session-and-direction-specific 32-bit prefix with the 64-bit
frame sequence; fresh handshake nonces derive fresh keys and prefixes, so a
key/nonce pair is never reused. Plaintext for a sensitive endpoint, AEAD on a
non-sensitive endpoint, an unknown algorithm or a capability mismatch is
rejected closed.

## OTA stream

`POST /ota/upload` is a specialized bounded stream. Its signed `open` frame
adds `otaSize`, `otaSha256` and `otaProof`. The ESP validates the one-use proof
and initializes the flash writer after the WebSocket JSON document has been
released. It then returns an `ack` with `received: 0`.

Each following signed `data` frame contains at most 512 decoded bytes. The ESP
writes it immediately and responds with the cumulative byte count. The server
keeps exactly one frame in flight and does not read the next multipart chunk
until that ACK arrives. `close` finalizes only after exact size and incremental
SHA-256 validation. `cancel`, timeout or tunnel loss calls the abort path on
both ends.
