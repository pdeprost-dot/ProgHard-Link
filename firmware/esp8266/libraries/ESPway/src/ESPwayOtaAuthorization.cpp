#include "ESPwayOtaAuthorization.h"

#include "ESPwayPlatform.h"
#include <ctype.h>

namespace {

constexpr char OTA_KDF_LABEL[] = "ESPWAY-OTA-KEY-1";
constexpr char OTA_PROOF_LABEL[] = "ESPWAY-OTA-AUTH-1";

String toHex(const uint8_t* bytes, size_t length) {
  static constexpr char HEX_DIGITS[] = "0123456789abcdef";
  String output;
  output.reserve(length * 2);
  for (size_t index = 0; index < length; ++index) {
    output += HEX_DIGITS[bytes[index] >> 4];
    output += HEX_DIGITS[bytes[index] & 0x0f];
  }
  return output;
}

void hmac(
  const uint8_t* key,
  size_t keyLength,
  const uint8_t* input,
  size_t inputLength,
  uint8_t output[32]
) {
  ESPwayPlatform::HmacSha256 context;
  if (!context.begin(key, keyLength)) {
    memset(output, 0, 32);
    return;
  }
  context.update(input, inputLength);
  context.finish(output);
}

bool validHex(const String& value, size_t length) {
  if (value.length() != length) return false;
  for (size_t index = 0; index < value.length(); ++index) {
    if (!isxdigit(static_cast<unsigned char>(value[index]))) return false;
  }
  return true;
}

bool constantTimeHexEqual(const String& first, const String& second) {
  if (first.length() != second.length()) return false;
  uint8_t difference = 0;
  for (size_t index = 0; index < first.length(); ++index) {
    difference |= static_cast<uint8_t>(first[index] ^ second[index]);
  }
  return difference == 0;
}

void deriveOtaKey(const String& deviceToken, uint8_t otaKey[32]) {
  hmac(
    reinterpret_cast<const uint8_t*>(deviceToken.c_str()),
    deviceToken.length(),
    reinterpret_cast<const uint8_t*>(OTA_KDF_LABEL),
    strlen(OTA_KDF_LABEL),
    otaKey
  );
}

String authorizationMessage(
  const String& deviceId,
  const String& nonce,
  size_t firmwareSize,
  const String& firmwareSha256
) {
  return String(OTA_PROOF_LABEL) + "\n" + deviceId + "\n" + nonce +
    "\n" + String(firmwareSize) + "\n" + firmwareSha256;
}

String computeProof(
  const String& deviceToken,
  const String& deviceId,
  const String& nonce,
  size_t firmwareSize,
  const String& firmwareSha256,
  String* derivedKeyHex = nullptr,
  size_t* messageLength = nullptr
) {
  uint8_t otaKey[32];
  deriveOtaKey(deviceToken, otaKey);
  if (derivedKeyHex != nullptr) *derivedKeyHex = toHex(otaKey, sizeof(otaKey));
  const String message = authorizationMessage(
    deviceId, nonce, firmwareSize, firmwareSha256
  );
  if (messageLength != nullptr) *messageLength = message.length();
  uint8_t proofBytes[32];
  hmac(
    otaKey, sizeof(otaKey),
    reinterpret_cast<const uint8_t*>(message.c_str()), message.length(),
    proofBytes
  );
  memset(otaKey, 0, sizeof(otaKey));
  const String proof = toHex(proofBytes, sizeof(proofBytes));
  memset(proofBytes, 0, sizeof(proofBytes));
  return proof;
}

}  // namespace

bool ESPwayOtaAuthorization::issueChallenge(String& nonce) {
  uint8_t random[32];
  if (!ESPwayPlatform::randomBytes(random, sizeof(random))) return false;
  challenge = toHex(random, sizeof(random));
  memset(random, 0, sizeof(random));
  issuedAt = millis();
  available = true;
  nonce = challenge;
  Serial.println(F("OTA authorization: challenge issued"));
  return true;
}

bool ESPwayOtaAuthorization::verify(
  const String& deviceToken,
  const String& deviceId,
  size_t firmwareSize,
  const String& firmwareSha256,
  const String& proof
) {
  if (!available) {
    Serial.println(F("OTA authorization rejected: challenge unavailable"));
    return false;
  }
  available = false;
  Serial.println(F("OTA authorization: challenge found"));
  if (millis() - issuedAt > CHALLENGE_TTL_MS) {
    Serial.println(F("OTA authorization rejected: challenge expired"));
    clear();
    return false;
  }
  Serial.println(F("OTA authorization: challenge valid"));
  Serial.print(F("OTA authorization: deviceId="));
  Serial.println(deviceId);
  Serial.print(F("OTA authorization: size="));
  Serial.println(firmwareSize);
  if (deviceToken.isEmpty()) {
    Serial.println(F("OTA authorization rejected: token unavailable"));
    clear();
    return false;
  }
  if (!validHex(firmwareSha256, SHA256_HEX_LENGTH) || !validHex(proof, 64)) {
    Serial.println(F("OTA authorization rejected: invalid metadata"));
    clear();
    return false;
  }
  Serial.println(F("OTA authorization: SHA-256 and proof formats valid"));
  size_t messageLength = 0;
  const String expected = computeProof(
    deviceToken, deviceId, challenge, firmwareSize, firmwareSha256,
    nullptr, &messageLength
  );
  Serial.println(F("OTA authorization: otaKey derived"));
  Serial.print(F("OTA authorization: HMAC message bytes="));
  Serial.println(messageLength);
  clear();
  const bool accepted = constantTimeHexEqual(expected, proof);
  if (!accepted) {
    Serial.println(F("OTA authorization rejected: proof mismatch"));
  } else {
    Serial.println(F("OTA authorization: HMAC comparison succeeded"));
  }
  return accepted;
}

bool ESPwayOtaAuthorization::selfTest() {
  const String deviceToken = F("test-device-token-32-bytes-0001");
  const String deviceId = F("esp-a1b2c3");
  const String nonce = F(
    "000102030405060708090a0b0c0d0e0f"
    "101112131415161718191a1b1c1d1e1f"
  );
  const String sha256 = F(
    "0123456789abcdef0123456789abcdef"
    "0123456789abcdef0123456789abcdef"
  );
  String keyHex;
  size_t messageLength = 0;
  const String proof = computeProof(
    deviceToken, deviceId, nonce, 534208, sha256, &keyHex, &messageLength
  );
  return messageLength == 165 &&
    keyHex == F("e555a8fc6eceda261dc437194cb8edeea"
                "7875778ee2a1182d9d334edc7961594") &&
    proof == F("f2d21c9cd8c6976420d8249d30b97ee"
               "71571fe2fc5c6518e8efd74fc7b28dd75");
}

void ESPwayOtaAuthorization::clear() {
  challenge = "";
  issuedAt = 0;
  available = false;
}
