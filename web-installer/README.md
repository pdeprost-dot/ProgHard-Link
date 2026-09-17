# ProgHard Link Web Installer

The installer publishes one manifest with automatically selected builds for
ESP8266, ESP32 and ESP32-C3. It does not ask users to choose a chip family.

For local UI testing, serve the repository root so the absolute Registry paths
in the catalog remain available:

```text
web-installer/index.html
web-installer/manifest.json
firmware-repository/<hardware>/espway-base/0.1.0/firmware.bin
```

Create a local staging directory from the repository, then serve it in Chrome
or Edge:

```powershell
python -m http.server 8000
```

Open `http://localhost:8000/web-installer/`. Localhost is accepted as a secure
context for Web Serial. The page loads the pinned esp-web-tools 10.4.0 module
from unpkg and reads the multi-architecture manifest.

The official instance will publish the installer at
`https://install.link.proghard.com/`. Other instances derive the same
`install.<ESPWAY_DOMAIN>` hostname. Its static directory contains only
`index.html` and `manifest.json`. The Caddy fragment proxies the explicit
`/firmware/*` paths to immutable released Registry artifacts through the
ProgHard Link server. Every other path returns 404. The installer is publicly
accessible without authentication so esp-web-tools can fetch these same-origin
resources during installation.

ESP32 images are merged flash images generated with esptool and installed at
offset 0. The ESP8266 image is also installed at offset 0. The installer uses
the chip family detected by esp-web-tools and refuses unsupported chips.

This version intentionally does not implement Improv Wi-Fi. After flashing,
join the `ESPway-XXXXXX` access point and provision the device at
`http://192.168.4.1/`.
