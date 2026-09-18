# ProgHard Link Arduino Library

ProgHard Link provides local-first Wi-Fi provisioning, a local HTTP interface, an
authenticated remote tunnel, MQTT V2, diagnostics and OTA for ESP8266 and
ESP32 applications.

## Installation

Install the public `ProgHard-Link-0.4.11.zip` release with **Sketch > Include Library >
Add .ZIP Library...** in Arduino IDE. ProgHard Link requires:

- ESP8266 Arduino Core 3.1.2 or Arduino-ESP32 Core 3.3.11;
- ArduinoJson 7.4.2 or newer;
- arduinoWebSockets 2.7.2 or newer;
- PubSubClient 2.8 or newer.

Then select the platform-appropriate board and partition. The validated
profiles are NodeMCU 1.0 with **4MB (FS:2MB OTA:~1019KB)**, ESP32C3 Dev
Module with **Minimal SPIFFS (1.9 MB APP with OTA)**, and ESP32C6 Dev Module
with **8 MB Flash**, **8M with SPIFFS (3 MB APP/1.5 MB SPIFFS)** and USB CDC
enabled. The validated Waveshare ESP32-C6-Touch-LCD-1.47 display and touch
hardware are not used by ProgHard Link Base.

## Basic use

Open an included example from **File > Examples > ProgHard Link**. `ProgHardLinkBase` is a
minimal reusable starting point and `LedDemo` demonstrates application routes.
Applications implement `ESPwayApplication` and pass their instance to
`ESPwayFramework`.

`DhtSensorDemo` and `ThermostatDemo` additionally require **DHT sensor library**
and **Adafruit Unified Sensor**. These two dependencies are not required by
ProgHardLinkBase or LedDemo.

`QuadPzemWattmeter` demonstrates four PZEM-004T v3 meters on one Modbus bus
(addresses 1 through 4), a live web dashboard, a configurable 15-to-900-second
read interval, MQTT publication and a JSON API. It uses the ESP8266 core's
SoftwareSerial implementation and requires no additional library.

Documentation and downloads: <https://link.proghard.com/>

Canonical references: `ESP32-support.md`, `MQTT.md` and `SampleBlock-V1.md`.
The repository-level `docs/examples.md` describes every example and its actual
compile/hardware-validation status.
