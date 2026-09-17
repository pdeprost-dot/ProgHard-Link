#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>

class ESPwayAeadSession {
 public:
  static bool decrypt(
    const uint8_t key[32],
    const uint8_t noncePrefix[4],
    uint64_t sequence,
    const String& streamId,
    const String& type,
    const String& method,
    const String& path,
    const JsonObjectConst& envelope,
    String& plaintext
  );

  static bool isSensitiveRequest(const String& method, const String& path);
  static bool verifyCrossLanguageTestVector();
};
