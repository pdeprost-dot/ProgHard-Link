# Getting Started

Choose one of two paths:

- use an existing trusted ProgHard Link instance and start at the Web Installer;
- self-host the complete stack by following [VPS installation](vps-installation.md).

For a first device, use a sacrificial ESP8266, ESP32, ESP32-C3 or ESP32-C6 and a USB data
cable. In Chrome or Edge, open the instance's `install` hostname, select
**Install ProgHard Link**, confirm ProgHard Link Base 0.2.3 and erase the device.

After flashing, join `ESPway-XXXXXX`. The captive portal should open; otherwise
visit `http://192.168.4.1/`. Enter the Wi-Fi credentials, leave remote access
enabled when wanted, and verify the instance URL before saving.

Back on the LAN, try `http://esp-xxxxxx/` first. Select **Register this device
in ProgHard Link**, sign in, inspect the pending device and confirm. The Device
Manager should show it online. Use **My devices → Open** for remote HTTPS access.

Never paste a device credential, API token, session cookie or Wi-Fi password in
an issue or support message.
