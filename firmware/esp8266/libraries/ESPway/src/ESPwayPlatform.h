#pragma once

#include <Arduino.h>

#if defined(ESP8266)
#include <ESP8266HTTPClient.h>
#include <ESP8266WebServer.h>
#include <ESP8266WiFi.h>
#include <LittleFS.h>
#include <Updater.h>
using ESPwayWebServer = ESP8266WebServer;
#elif defined(ESP32)
#include <HTTPClient.h>
#include <WebServer.h>
#include <WiFi.h>
#include <LittleFS.h>
#include <Update.h>
using ESPwayWebServer = WebServer;
#else
#error "ESPway supports ESP8266 and ESP32 Arduino cores"
#endif

namespace ESPwayPlatform {

enum class SensitiveCipher {
  ChaCha20Poly1305,
  Aes128Gcm,
};

#if defined(ESP8266)
constexpr SensitiveCipher SENSITIVE_CIPHER = SensitiveCipher::ChaCha20Poly1305;
constexpr const char* SENSITIVE_CIPHER_NAME = "CHACHA20-POLY1305";
constexpr const char* SENSITIVE_CIPHER_CAPABILITY = "aead-chacha20-poly1305";
#else
constexpr SensitiveCipher SENSITIVE_CIPHER = SensitiveCipher::Aes128Gcm;
constexpr const char* SENSITIVE_CIPHER_NAME = "AES-128-GCM";
constexpr const char* SENSITIVE_CIPHER_CAPABILITY = "aead-aes-128-gcm";
#endif

bool beginFileSystem();
String deviceId();
const char* hardwareId();
uint32_t freeHeap();
uint32_t maxFreeBlock();
uint32_t heapFragmentation();
uint32_t flashSize();
String resetReason();
bool setHostname(const String& hostname);
bool randomBytes(uint8_t* output, size_t length);
void collectOtaHeaders(ESPwayWebServer& server);

class Sha256 {
 public:
  Sha256();
  ~Sha256();
  void begin();
  void update(const void* data, size_t length);
  void finish(uint8_t output[32]);

 private:
  struct State;
  State* state;
};

class HmacSha256 {
 public:
  HmacSha256();
  ~HmacSha256();
  bool begin(const uint8_t* key, size_t keyLength);
  void update(const void* data, size_t length);
  void finish(uint8_t output[32]);

 private:
  struct State;
  State* state;
};

bool sensitivePayloadDecrypt(
  SensitiveCipher cipher,
  const uint8_t* key,
  const uint8_t nonce[12],
  uint8_t* data,
  size_t dataLength,
  const void* aad,
  size_t aadLength,
  const uint8_t tag[16]
);

}  // namespace ESPwayPlatform
