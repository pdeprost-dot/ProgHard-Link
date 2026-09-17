# Changelog

## Unreleased

- Added Enrollment V1: a fresh device generates its machine credential,
  creates an expiring one-time claim, and becomes owned after authenticated
  confirmation without exposing Device ID or token entry to the user.
- Added configurable ProgHard Link instance URLs and server-provided device
  service domains so enrollment is not coupled to the historical hostname.
- Removed manual Device ID/token instructions and token inputs from the normal
  provisioning and Device Manager UX.
- Prepared the Arduino library changes first staged as 0.4.7 and subsequently
  published in 0.4.8, with accurate ESP8266, ESP32-C3 and ESP32 hardware
  identity in the authenticated device hello.
- Reserved the Base firmware root page for generic provisioning and enrollment;
  its demonstration application now lives under `/app`.
- Bounded ESP8266 TLS buffers and suspended unauthenticated tunnel retries while
  creating an enrollment, preventing heap fragmentation during HTTPS pairing.
- Clarified embedded Wi-Fi recovery, local OTA progress and the path back to
  the ProgHard Link Device Manager without weakening device authentication.
- Made clean first-boot provisioning reliable on ESP32 and allowed manual SSID
  entry for hidden networks.

## 0.5.0 — 2026-09-13

- Added application-level human authentication with `admin` and `user` roles.
- Added SQLite user, device-assignment, Personal API Token and audit storage.
- Enforced per-user device access for Device Manager, observability, OTA and
  every request proxied to a remote ESP.
- Added opaque browser sessions, CSRF protection, login rate limiting and
  single-use remote-browser access tickets with host-only cookies.
- Added local administrator bootstrap/recovery commands and a Node-RED Bearer
  token example.
- Made application login and authorization the primary human security boundary
  and removed the legacy Caddy Basic Auth gate from the admin hostname.
- Validated fail-closed admin routes, remote browser tickets, Personal API
  Tokens, per-user observability and Registry-backed OTA authorization.

## 0.4.0 — 2026-09-13

- Added supported ESP32/ESP32-C3 framework portability alongside ESP8266.
- Added MQTT V2 typed and binary publication, application subscriptions,
  generic availability, Last Will and system telemetry.
- Added the transport-independent binary SampleBlock V1 format.
- Added Polar H10 BLE/PMD examples with BPM, RR and ECG at 130 Hz.
- Added the embedded HTTP ECG oscilloscope and its ESPway WAN validation.
- Added optional QoS 0, non-retained SampleBlock ECG publication over LAN MQTT.
- Added the independent Node.js Cardio Monitor V1 with raw/filtered traces,
  QRS detection and technical BPM/RR comparison. It is experimental and is
  not a medical device.
- Added the ESP32-C3 resource budget and expanded MQTT/Polar documentation.
- Added the compiled, ESP8266-only QuadPzemWattmeter example for four
  PZEM-004T v3 Modbus meters. It has not been validated on physical meters.
- Refreshed the examples and getting-started documentation.

Historical firmware-registry artifacts and Arduino ZIP releases remain
immutable. Version 0.4.0 adds a new Arduino library artifact rather than
replacing 0.2.0 or 0.3.0.
