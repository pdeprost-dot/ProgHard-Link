#pragma once

#include <Arduino.h>

class ESPwayOtaAuthorization {
 public:
  static constexpr unsigned long CHALLENGE_TTL_MS = 60000;
  static constexpr size_t SHA256_HEX_LENGTH = 64;

  bool issueChallenge(String& nonce);
  bool verify(
    const String& deviceToken,
    const String& deviceId,
    size_t firmwareSize,
    const String& firmwareSha256,
    const String& proof
  );
  void clear();
  static bool selfTest();

 private:
  String challenge;
  unsigned long issuedAt = 0;
  bool available = false;
};
