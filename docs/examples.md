# ProgHard Link Arduino examples

This matrix records the supported target for each example. A dash means the
example is intentionally platform-specific, not that the ESPway core lacks
support for that platform. Compilation was repeated with ESP8266 core 3.1.2
and ESP32 core 3.3.6 on the profiles shown below.

| Example | ESP8266 | ESP32-C3 | Hardware status | Role |
| --- | --- | --- | --- | --- |
| ProgHardLinkBase | compiled | — | previously exercised on ESP8266 | Minimal ESP8266 application, UI, LED, provisioning, OTA and WAN-ready routes |
| ProgHardLinkBaseESP32 | — | compiled; hardware validated | Minimal ESP32-C3 framework application |
| LedDemo | compiled | compiled | compiled in this audit | Small actuator and HTTP-route example |
| DhtSensorDemo | compiled | — | compiled; DHT hardware not re-tested | DHT22 temperature/humidity and local/projectable UI |
| MqttDemo | compiled | compiled | MQTT V2 validated through the ESP32 Polar integration | Canonical MQTT V2 publish/command example |
| ThermostatDemo | compiled | — | previously validated on ESP8266 | DHT22, setpoint, heating output, persistent configuration, HTTP UI and MQTT |
| PolarH10Demo | — | compiled; hardware validated | ESP32-C3 + Polar H10 | Isolated BLE/PMD, BPM, RR, ECG 130 Hz and Serial Plotter |
| PolarH10ProgHardLinkDemo | — | compiled; LAN/WAN/MQTT hardware validated | ESP32-C3 + Polar H10 | ProgHard Link, HTTP SampleBlock scope, WAN UI and binary MQTT ECG |
| QuadPzemWattmeter | compiled | — | not hardware validated | Four PZEM-004T v3 meters, Modbus, dashboard, configuration, JSON API and MQTT |

## Profiles and dependencies

- ESP8266: NodeMCU 1.0 (`esp8266:esp8266:nodemcuv2`), core 3.1.2.
- ESP32: ESP32C3 Dev Module, core 3.3.6, Minimal SPIFFS partition.
- All ESPway network examples: ArduinoJson 7.4.2, WebSockets 2.7.2 and
  PubSubClient 2.8 or compatible later releases.
- DHT examples: DHT sensor library 1.4.7 and Adafruit Unified Sensor 1.1.15.
- Polar examples: NimBLE-Arduino 2.5.1 in the current compile environment;
  the real Polar validation was performed with the installed environment.

`ProgHardLinkBase` retains an ESP8266-specific Wi-Fi include; use
`ProgHardLinkBaseESP32` on ESP32. The DHT and thermostat examples use NodeMCU pin
aliases, and QuadPzem uses ESP8266 SoftwareSerial, so they are intentionally
listed only for ESP8266. `LedDemo` and `MqttDemo` are portable examples.

## Recommended path

Start with the base example matching the board, then use `LedDemo`,
`DhtSensorDemo` and `MqttDemo` to learn one concern at a time.
`ThermostatDemo` combines those concepts into a real application.
`PolarH10Demo` and `PolarH10ProgHardLinkDemo` are advanced ESP32 examples.
`QuadPzemWattmeter` is specialized and assumes safe experience with Modbus
equipment connected to mains-powered meters.

## ESP8266 memory warning

The audit builds use 93% IRAM for the generic examples and 95% for
`QuadPzemWattmeter`. They compile successfully, but future generic ESP8266
changes must continue to monitor this narrow IRAM margin.
