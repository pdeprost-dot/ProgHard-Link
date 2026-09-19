# Web Installer

The installer at `https://install.<ESPWAY_DOMAIN>/` uses Web Serial and works
in compatible desktop browsers such as Chrome and Edge. It selects the image by
chip family from `web-installer/manifest.json`.

The public release offers ProgHard Link Base 0.2.3 for ESP8266, ESP32,
ESP32-C3, ESP32-C6 and ESP32-S3. Installation erases the target. Use a USB data cable, select the
correct serial port, read the confirmation version, and wait for completion.

After flashing, connect to `ESPway-XXXXXX`. Wait briefly for the captive portal
before manually opening `http://192.168.4.1/`. The expected defaults are:

- title: ProgHard Link Setup;
- device name: ProgHard Link Device;
- instance: `https://admin.link.proghard.com` in the official build;
- remote access enabled when selected.

Self-hosters who publish a differently configured firmware must ensure its
default instance points to their service. A successful flash alone does not
register a device; enrollment is completed from the device's LAN page.
