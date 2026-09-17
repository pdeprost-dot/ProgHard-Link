# Roadmap

This document describes planned work, not currently available functionality.

## Shared public demo instance

A future shared demo may provide a public demo account, a global device quota
and automatic expiry after 48 hours. It will provide no retention guarantee,
must not receive sensitive data, and may delete devices early in response to
abuse.

The server design should add an explicit demo policy/role, persistent
`createdAt` and `expiresAt`, atomic quota enforcement during claim, and an
idempotent periodic cleanup. Cleanup must disconnect the tunnel, remove device
authorization and ownership, and write an audit event. Administrator e-mail
after enrollment should be asynchronous and non-blocking and must never contain
credentials. Rate limiting and a global kill switch are required.

## Hardware targets

Planned physical validation target after the initial public release:

- ESP32-S3: Seeed Studio ESP32-S3 board with camera and microphone.

ESP32-C6 is now supported and physically validated on a Waveshare
ESP32-C6-Touch-LCD-1.47. ProgHard Link Base does not use its display or touch
hardware. ESP32-S3 is not currently supported. The build/Web Installer chain should
evolve toward a declarative matrix containing hardware ID, Arduino FQBN,
partition scheme, source sketch, flash offsets, library/core versions and
artifact checks. Camera and microphone support should remain optional
applications rather than enlarging the Base firmware.
