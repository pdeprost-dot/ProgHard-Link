#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>

class ESPwayHmacSession {
 public:
  static constexpr size_t MAX_SIGNED_FRAME_SIZE = 4096;

  bool beginAuthentication(
    const String& deviceId,
    const String& deviceToken,
    const String& authProtocol,
    const String& serverNonce,
    String& deviceNonce,
    String& authenticationMac
  );
  bool acceptHelloAck(const String& authProtocol);
  bool verifyFrame(
    const uint8_t* payload,
    size_t length,
    const JsonDocument& document
  );
  bool signFrame(String& message);

  bool keysReady() const;
  bool authenticated() const;
  const uint8_t* receiveEncryptionKey() const;
  const uint8_t* receiveNoncePrefix() const;
  uint64_t lastReceivedSequence() const;
  void reset();

  static const char* authenticationProtocol();

 private:
  uint8_t clientToServerKey[32] = {};
  uint8_t serverToClientKey[32] = {};
  uint8_t clientToServerEncryptionKey[32] = {};
  uint8_t serverToClientEncryptionKey[32] = {};
  uint8_t clientToServerNoncePrefix[4] = {};
  uint8_t serverToClientNoncePrefix[4] = {};
  uint64_t sendSequence = 1;
  uint64_t expectedReceiveSequence = 1;
  bool sessionKeysReady = false;
  bool sessionAuthenticated = false;

  static String bytesToHex(const uint8_t* bytes, size_t length);
  static bool hexToBytes(
    const char* hex,
    uint8_t* output,
    size_t outputLength
  );
  static bool constantTimeEqual(
    const uint8_t* first,
    const uint8_t* second,
    size_t length
  );
  static void computeHmac(
    const uint8_t* key,
    size_t keyLength,
    const uint8_t* data,
    size_t dataLength,
    uint8_t output[32]
  );
  void deriveSessionKeys(
    const String& deviceId,
    const String& deviceToken,
    const String& serverNonce,
    const String& deviceNonce
  );
};
