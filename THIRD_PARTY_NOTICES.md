# Third-party notices

ProgHard Link is MIT-licensed, but its dependencies remain under their own
licenses. This inventory describes the first public baseline and does not
replace complete upstream license texts.

| Component | Version | License | Use | Official source |
|---|---:|---|---|---|
| Node.js `ws` | 8.21.3 | MIT | Server WebSocket implementation | https://github.com/websockets/ws |
| Caddy | 2.10.2 | Apache-2.0 | HTTPS reverse proxy container | https://github.com/caddyserver/caddy |
| Node Docker image | 22.19.0-alpine3.22 | Multiple | Server runtime | https://github.com/nodejs/docker-node |
| ArduinoJson | 7.4.2 | MIT | Firmware JSON processing | https://github.com/bblanchon/ArduinoJson |
| arduinoWebSockets | 2.7.2 | LGPL-2.1-or-later | Statically linked firmware WebSocket client | https://github.com/Links2004/arduinoWebSockets |
| PubSubClient | 2.8 | MIT | Optional firmware MQTT | https://github.com/knolleary/pubsubclient |
| NimBLE-Arduino | 2.5.1 | Apache-2.0 | Experimental Polar H10 BLE examples | https://github.com/h2zero/NimBLE-Arduino |
| MQTT.js | 5.14.x | MIT | Experimental ECG monitor | https://github.com/mqttjs/MQTT.js |
| ESP8266 Arduino core | 3.1.2 | Multiple | ESP8266 runtime | https://github.com/esp8266/Arduino |
| Arduino-ESP32 core | 3.3.11 | Multiple | ESP32/ESP32-C3 runtime | https://github.com/espressif/arduino-esp32 |
| esp-web-tools | 10.4.0 | Apache-2.0 | Browser installer component | https://github.com/esphome/esp-web-tools |

## arduinoWebSockets and firmware redistribution

ProgHard Link Base statically links the unmodified upstream arduinoWebSockets
2.7.2 release under LGPL-2.1-or-later. Its exact source is vendored at
`third-party/arduinoWebSockets-2.7.2/source/`; the complete license is at
`third-party/arduinoWebSockets-2.7.2/LICENSE`. Provenance, tag and commit are
recorded in the adjacent `README-PROGHARD-LINK.md`.

The digest-pinned maintainer container, exact dependency versions and
relinking/flashing procedure are provided in `build/firmware/` and
`docs/third-party-relinking.md`. They let a recipient modify the vendored
library and rebuild the three Base firmware targets from source. Normal Arduino
IDE application development does not require this container.

This inventory describes the technical redistribution materials supplied by
the project; it is not legal advice or a certification of compliance.

Arduino cores and container images include additional third-party components;
their upstream notices must be reviewed when release packaging is finalized.
