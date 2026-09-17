# ProgHard Link

ProgHard Link gives ESP8266 and ESP32 projects a local Web interface, secure
remote access through an outbound authenticated tunnel, a multi-user Device
Manager, OTA updates and a browser-based firmware installer. Local operation
does not depend on Internet access.

The first public baseline is ProgHard Link Base 0.2.3 with Arduino library
0.4.8. It supports ESP8266, ESP32 and ESP32-C3. The historical technical names
`ESPWAY_*`, `ESPway.h`, `espway-base` and `espway-tunnel/2` remain stable for
compatibility.

## Published versions

| Component | Version |
| --- | --- |
| Server | `0.5.0` |
| ProgHard Link Base | `0.2.3` |
| Arduino library | `0.4.8` |
| Tunnel protocol | `espway-tunnel/2` |

## Start here

- [Getting Started](docs/getting-started.md)
- [Install a self-hosted instance on Ubuntu](docs/vps-installation.md)
- [Use the Device Manager](docs/device-manager.md)
- [Use the Web Installer](docs/web-installer.md)
- [Understand remote access](docs/remote-access.md)
- [Build the firmware and server](docs/development.md)
- [Modify and relink third-party firmware code](docs/third-party-relinking.md)

## Components

```text
server/                Node.js gateway, authentication and Device Manager
caddy/                 HTTPS edge and On-Demand TLS policy
web-installer/         Browser firmware installer
firmware/              Arduino library, Base firmware and examples
firmware-repository/   Immutable OTA/Web Installer firmware artifacts
download-repository/   Immutable Arduino library ZIP
tools/                 Build and registry validation tools
build/firmware/        Reproducible official Base firmware environment
third-party/           Exact vendored third-party source and license material
docs/                  User, operator and developer documentation
```

The Docker Compose stack publishes only TCP 80 and 443 for ProgHard Link. The
Node service on 3000 and Caddy administration endpoint on 2019 stay private to
Docker. SSH exposure is controlled separately by the VPS operator.

## Quick verification

```bash
cp .env.example .env
# Set ESPWAY_DOMAIN and ACME_EMAIL before deployment.
sudo docker compose config
sudo docker compose build
cd server && npm ci && npm test
```

Do not start public certificate issuance until the apex and wildcard DNS names
point to the intended server. Follow the complete
[VPS installation guide](docs/vps-installation.md).

## Firmware releases

The public firmware registry initially contains only ProgHard Link Base 0.2.3
for ESP8266, ESP32 and ESP32-C3. Validate all sizes, hashes, manifests and
release locks with `node tools/validate-firmware-registry.js`.

## Experimental Polar H10 / ECG demonstration

The repository includes an advanced Polar H10 demonstration under
`docs/experimental/polar-ecg/` and `tools/experimental/polar-ecg/`.

**Experimental technical demonstration. Not a medical device. Not intended
for diagnosis, treatment, clinical monitoring, emergency use, or decisions
concerning a person's health.**

## Project status and roadmap

ProgHard Link is a hobby/open-source project. ESP32-C6 and ESP32-S3 are planned
hardware targets but are not currently supported. A shared public demo design
is documented as future work in [the roadmap](docs/roadmap.md); no public demo
service is promised or available yet.

## Security and license

Read [SECURITY.md](SECURITY.md) before reporting a vulnerability and
[docs/security.md](docs/security.md) before exposing an instance publicly.
ProgHard Link is licensed under the MIT License. Third-party components retain
their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
