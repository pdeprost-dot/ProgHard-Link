# ESP32 support

ESPway supports the Arduino ESP8266 and ESP32 cores through
`src/ESPwayPlatform.h`. The common framework keeps the same configuration
format, HTTP routes and tunnel v2 protocol on both platforms.

## Published and validated platforms

Published means that the Firmware Registry contains an official ProgHard Link
Base artifact for the target. Compile validation and physical hardware
validation are recorded separately and should not be treated as equivalent.

| Platform | Arduino core | Arduino board profile | Published Base | Compile validation | Hardware validation documented in this repository |
| --- | --- | --- | --- | --- | --- |
| ESP8266 | 3.1.2 | NodeMCU 1.0 (ESP-12E Module) | Yes | ESP8266 examples | Previously exercised on ESP8266 |
| ESP32-C3 | 3.3.11 | ESP32C3 Dev Module | Yes | ESPway and supported ESP32 examples | ESPway, MQTT, Polar BLE/PMD, HTTP/WAN and MQTT ECG |
| ESP32-C6 | 3.3.11 | ESP32C6 Dev Module | Yes | ProgHard Link Base | Waveshare ESP32-C6-Touch-LCD-1.47 end-to-end Base workflow |
| ESP32-S3 | 3.3.11 | ESP32S3 Dev Module, 8 MB flash, 8M with SPIFFS, USB CDC | Yes | ProgHard Link Base | Seeed Studio ESP32-S3: provisioning, enrollment, local/remote UI, tunnel and remote OTA validated on hardware |
| ESP32 | 3.3.11 | ESP32 Dev Module | Yes | ESPway and AES-GCM | None documented |

For the tested 4 MB ESP32-C3, select **Minimal SPIFFS (1.9 MB APP with
OTA/128 KB SPIFFS)**. The complete framework is larger than the 1.25 MB
application slot in the default partition scheme. Minimal SPIFFS retains two
application slots, so local and remote OTA remain possible.

For the tested 8 MB ESP32-C6, select **8M with SPIFFS (3 MB APP/1.5 MB
SPIFFS)**, **8 MB Flash** and **USB CDC On Boot: Enabled**. The validated board
is Waveshare ESP32-C6-Touch-LCD-1.47. Its display and touch hardware are not
used by ProgHard Link Base.

For the 8 MB ESP32-S3 Base build, select **8M with SPIFFS (3 MB APP/1.5 MB
SPIFFS)**, **8 MB Flash** and **USB CDC On Boot: Enabled**. Camera and
microphone features are outside Base.

Required Arduino libraries remain:

- ArduinoJson 7.4.2 or later
- WebSockets 2.7.2 or later
- PubSubClient 2.8 or later

Open `examples/ProgHardLinkBaseESP32/ProgHardLinkBaseESP32.ino` in Arduino IDE
for the minimal ESP32-C3 validation application. Its serial speed is 115200
baud.

## Compatibility inventory

`ESPwayPlatform` owns the platform-specific includes and services:

| Concern | ESP8266 | ESP32 |
| --- | --- | --- |
| Wi-Fi | `ESP8266WiFi.h` | `WiFi.h` |
| HTTP client | `ESP8266HTTPClient.h` | `HTTPClient.h` |
| Local HTTP server | `ESP8266WebServer` | `WebServer` |
| Filesystem | LittleFS | LittleFS |
| Firmware update | `Updater.h` | `Update.h` |
| Device identity | `ESP.getChipId()` | low 32 bits of `ESP.getEfuseMac()` |
| Random source | `os_get_random()` | `esp_fill_random()` |
| SHA-256/HMAC | BearSSL | mbedTLS |
| Heap metrics | ESP8266 native metrics | ESP32 free/max-allocation metrics |
| Reset reason | readable ESP8266 reason | numeric `esp_reset_reason()` value |

`DNSServer`, ArduinoJson, PubSubClient and the Links2004 WebSockets library
already expose compatible APIs. Wi-Fi STA, AP+STA fallback, asynchronous scan,
RSSI, local/AP addresses, reconnect, HTTP routes, local OTA and HTTP remote OTA
therefore remain common code.

The stable ESP8266 device ID format is unchanged. ESP32 IDs use
`esp-xxxxxxxx`, lowercase and deterministic across restarts.

## Sensitive payload encryption

ESP8266 retains BearSSL ChaCha20-Poly1305. ESP32, ESP32-C3 and ESP32-C6 use AES-128-GCM
from the mbedTLS bundled with Arduino-ESP32 3.3.11. Both algorithms protect the
same `ESPWAY-AEAD-1` sensitive envelope and the signed hello advertises the
actual cipher. Tunnel v2 HMAC signing and strict sequencing remain unchanged;
there is no plaintext fallback.
