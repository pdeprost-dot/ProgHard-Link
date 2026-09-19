#include "ESPwayHmacSession.h"

#include "ESPwayPlatform.h"
#include <ctype.h>
#include <errno.h>

namespace {

constexpr const char* AUTH_PROTOCOL = "ESPWAY-AUTH-1";
constexpr const char* SESSION_PROTOCOL = "ESPWAY-SESSION-1";
constexpr const char* FRAME_PROTOCOL = "ESPWAY-FRAME-1";
constexpr const char* FRAME_SUFFIX = ",\"_espway\":";

}  // namespace

bool ESPwayHmacSession::beginAuthentication(
  const String& deviceId,
  const String& deviceToken,
  const String& authProtocol,
  const String& serverNonce,
  String& deviceNonce,
  String& authenticationMac
) {
  if (
    sessionKeysReady || authProtocol != AUTH_PROTOCOL ||
    serverNonce.length() != 64
  ) {
    return false;
  }

  uint8_t nonceBytes[32];
  if (!ESPwayPlatform::randomBytes(nonceBytes, sizeof(nonceBytes))) {
    return false;
  }
  deviceNonce = bytesToHex(nonceBytes, sizeof(nonceBytes));

  const String canonical = String(AUTH_PROTOCOL) + "\n" + deviceId + "\n" +
    serverNonce + "\n" + deviceNonce;
  uint8_t output[32];
  computeHmac(
    reinterpret_cast<const uint8_t*>(deviceToken.c_str()),
    deviceToken.length(),
    reinterpret_cast<const uint8_t*>(canonical.c_str()),
    canonical.length(),
    output
  );
  authenticationMac = bytesToHex(output, sizeof(output));
  memset(output, 0, sizeof(output));

  deriveSessionKeys(
    deviceId,
    deviceToken,
    serverNonce,
    deviceNonce
  );
  return true;
}

bool ESPwayHmacSession::acceptHelloAck(const String& authProtocol) {
  if (!sessionKeysReady || authProtocol != AUTH_PROTOCOL) {
    return false;
  }
  sessionAuthenticated = true;
  return true;
}

bool ESPwayHmacSession::verifyFrame(
  const uint8_t* payload,
  size_t length,
  const JsonDocument& document
) {
  if (
    !sessionKeysReady || length == 0 ||
    length > MAX_SIGNED_FRAME_SIZE
  ) {
    return false;
  }

  const JsonObjectConst envelope = document["_espway"];
  const char* version = envelope["version"] | "";
  const char* sequenceText = envelope["sequence"] | "";
  const char* macText = envelope["mac"] | "";
  if (strcmp(version, FRAME_PROTOCOL) != 0 || sequenceText[0] == '\0') {
    return false;
  }

  for (size_t index = 0; sequenceText[index] != '\0'; ++index) {
    if (!isdigit(static_cast<unsigned char>(sequenceText[index]))) {
      return false;
    }
  }
  errno = 0;
  char* sequenceEnd = nullptr;
  const uint64_t sequence = strtoull(sequenceText, &sequenceEnd, 10);
  if (
    errno != 0 || sequenceEnd == sequenceText || *sequenceEnd != '\0' ||
    sequence != expectedReceiveSequence
  ) {
    return false;
  }

  const size_t suffixLength = strlen(FRAME_SUFFIX);
  size_t suffixOffset = length;
  for (size_t index = 0; index + suffixLength <= length; ++index) {
    if (memcmp(payload + index, FRAME_SUFFIX, suffixLength) == 0) {
      suffixOffset = index;
    }
  }
  if (suffixOffset == length) {
    return false;
  }

  char expectedSuffix[192];
  const int expectedSuffixLength = snprintf(
    expectedSuffix,
    sizeof(expectedSuffix),
    ",\"_espway\":{\"version\":\"%s\",\"sequence\":\"%s\",\"mac\":\"%s\"}}",
    FRAME_PROTOCOL,
    sequenceText,
    macText
  );
  if (
    expectedSuffixLength <= 0 ||
    static_cast<size_t>(expectedSuffixLength) >= sizeof(expectedSuffix) ||
    length - suffixOffset != static_cast<size_t>(expectedSuffixLength) ||
    memcmp(payload + suffixOffset, expectedSuffix, expectedSuffixLength) != 0
  ) {
    return false;
  }

  char header[96];
  const size_t originalLength = suffixOffset + 1;
  const int headerLength = snprintf(
    header,
    sizeof(header),
    "%s\nS2C\n%llu\n%u\n",
    FRAME_PROTOCOL,
    static_cast<unsigned long long>(sequence),
    static_cast<unsigned int>(originalLength)
  );
  if (headerLength <= 0 || static_cast<size_t>(headerLength) >= sizeof(header)) {
    return false;
  }

  ESPwayPlatform::HmacSha256 context;
  uint8_t expectedMac[32];
  uint8_t receivedMac[32];
  const char closingBrace = '}';
  if (!context.begin(serverToClientKey, sizeof(serverToClientKey))) return false;
  context.update(header, headerLength);
  context.update(payload, suffixOffset);
  context.update(&closingBrace, 1);
  context.finish(expectedMac);
  if (
    !hexToBytes(macText, receivedMac, sizeof(receivedMac)) ||
    !constantTimeEqual(expectedMac, receivedMac, sizeof(expectedMac))
  ) {
    return false;
  }

  ++expectedReceiveSequence;
  return true;
}

bool ESPwayHmacSession::signFrame(String& message) {
  if (!sessionKeysReady || message.isEmpty() || !message.endsWith("}")) {
    return false;
  }

  char header[96];
  const int headerLength = snprintf(
    header,
    sizeof(header),
    "%s\nC2S\n%llu\n%u\n",
    FRAME_PROTOCOL,
    static_cast<unsigned long long>(sendSequence),
    static_cast<unsigned int>(message.length())
  );
  if (headerLength <= 0 || static_cast<size_t>(headerLength) >= sizeof(header)) {
    return false;
  }

  uint8_t macBytes[32];
  ESPwayPlatform::HmacSha256 context;
  if (!context.begin(clientToServerKey, sizeof(clientToServerKey))) return false;
  context.update(header, headerLength);
  context.update(message.c_str(), message.length());
  context.finish(macBytes);
  const String mac = bytesToHex(macBytes, sizeof(macBytes));

  message.remove(message.length() - 1);
  message.reserve(message.length() + 150);
  message += F(",\"_espway\":{\"version\":\"ESPWAY-FRAME-1\",\"sequence\":\"");
  message += String(sendSequence);
  message += F("\",\"mac\":\"");
  message += mac;
  message += F("\"}}");
  ++sendSequence;
  return true;
}

bool ESPwayHmacSession::keysReady() const {
  return sessionKeysReady;
}

bool ESPwayHmacSession::authenticated() const {
  return sessionAuthenticated;
}

const uint8_t* ESPwayHmacSession::receiveEncryptionKey() const {
  return serverToClientEncryptionKey;
}

const uint8_t* ESPwayHmacSession::receiveNoncePrefix() const {
  return serverToClientNoncePrefix;
}

uint64_t ESPwayHmacSession::lastReceivedSequence() const {
  return expectedReceiveSequence - 1;
}

void ESPwayHmacSession::reset() {
  memset(clientToServerKey, 0, sizeof(clientToServerKey));
  memset(serverToClientKey, 0, sizeof(serverToClientKey));
  memset(clientToServerEncryptionKey, 0, sizeof(clientToServerEncryptionKey));
  memset(serverToClientEncryptionKey, 0, sizeof(serverToClientEncryptionKey));
  memset(clientToServerNoncePrefix, 0, sizeof(clientToServerNoncePrefix));
  memset(serverToClientNoncePrefix, 0, sizeof(serverToClientNoncePrefix));
  sendSequence = 1;
  expectedReceiveSequence = 1;
  sessionKeysReady = false;
  sessionAuthenticated = false;
}

const char* ESPwayHmacSession::authenticationProtocol() {
  return AUTH_PROTOCOL;
}

String ESPwayHmacSession::bytesToHex(
  const uint8_t* bytes,
  size_t length
) {
  static constexpr char HEX_DIGITS[] = "0123456789abcdef";
  String result;
  result.reserve(length * 2);
  for (size_t index = 0; index < length; ++index) {
    result += HEX_DIGITS[bytes[index] >> 4];
    result += HEX_DIGITS[bytes[index] & 0x0f];
  }
  return result;
}

bool ESPwayHmacSession::hexToBytes(
  const char* hex,
  uint8_t* output,
  size_t outputLength
) {
  if (hex == nullptr || strlen(hex) != outputLength * 2) {
    return false;
  }
  for (size_t index = 0; index < outputLength; ++index) {
    const char high = tolower(hex[index * 2]);
    const char low = tolower(hex[index * 2 + 1]);
    if (!isHexadecimalDigit(high) || !isHexadecimalDigit(low)) {
      return false;
    }
    const uint8_t highValue = high <= '9' ? high - '0' : high - 'a' + 10;
    const uint8_t lowValue = low <= '9' ? low - '0' : low - 'a' + 10;
    output[index] = (highValue << 4) | lowValue;
  }
  return true;
}

bool ESPwayHmacSession::constantTimeEqual(
  const uint8_t* first,
  const uint8_t* second,
  size_t length
) {
  uint8_t difference = 0;
  for (size_t index = 0; index < length; ++index) {
    difference |= first[index] ^ second[index];
  }
  return difference == 0;
}

void ESPwayHmacSession::computeHmac(
  const uint8_t* key,
  size_t keyLength,
  const uint8_t* data,
  size_t dataLength,
  uint8_t output[32]
) {
  ESPwayPlatform::HmacSha256 context;
  if (!context.begin(key, keyLength)) {
    memset(output, 0, 32);
    return;
  }
  context.update(data, dataLength);
  context.finish(output);
}

void ESPwayHmacSession::deriveSessionKeys(
  const String& deviceId,
  const String& deviceToken,
  const String& serverNonce,
  const String& deviceNonce
) {
  const String canonical = String(SESSION_PROTOCOL) + "\n" + deviceId +
    "\n" + serverNonce + "\n" + deviceNonce;
  uint8_t sessionMaster[32];
  computeHmac(
    reinterpret_cast<const uint8_t*>(deviceToken.c_str()),
    deviceToken.length(),
    reinterpret_cast<const uint8_t*>(canonical.c_str()),
    canonical.length(),
    sessionMaster
  );
  computeHmac(
    sessionMaster,
    sizeof(sessionMaster),
    reinterpret_cast<const uint8_t*>("ESPWAY-C2S-1"),
    strlen("ESPWAY-C2S-1"),
    clientToServerKey
  );
  computeHmac(
    sessionMaster,
    sizeof(sessionMaster),
    reinterpret_cast<const uint8_t*>("ESPWAY-S2C-1"),
    strlen("ESPWAY-S2C-1"),
    serverToClientKey
  );
  uint8_t derived[32];
  computeHmac(
    sessionMaster,
    sizeof(sessionMaster),
#if defined(ESP8266)
    reinterpret_cast<const uint8_t*>("ESPWAY-C2S-ENC-1"),
    strlen("ESPWAY-C2S-ENC-1"),
#else
    reinterpret_cast<const uint8_t*>("ESPWAY-C2S-AES-GCM-ENC-1"),
    strlen("ESPWAY-C2S-AES-GCM-ENC-1"),
#endif
    clientToServerEncryptionKey
  );
  computeHmac(
    sessionMaster,
    sizeof(sessionMaster),
#if defined(ESP8266)
    reinterpret_cast<const uint8_t*>("ESPWAY-S2C-ENC-1"),
    strlen("ESPWAY-S2C-ENC-1"),
#else
    reinterpret_cast<const uint8_t*>("ESPWAY-S2C-AES-GCM-ENC-1"),
    strlen("ESPWAY-S2C-AES-GCM-ENC-1"),
#endif
    serverToClientEncryptionKey
  );
  computeHmac(
    sessionMaster,
    sizeof(sessionMaster),
    reinterpret_cast<const uint8_t*>("ESPWAY-C2S-NONCE-1"),
    strlen("ESPWAY-C2S-NONCE-1"),
    derived
  );
  memcpy(clientToServerNoncePrefix, derived, 4);
  computeHmac(
    sessionMaster,
    sizeof(sessionMaster),
    reinterpret_cast<const uint8_t*>("ESPWAY-S2C-NONCE-1"),
    strlen("ESPWAY-S2C-NONCE-1"),
    derived
  );
  memcpy(serverToClientNoncePrefix, derived, 4);
  memset(derived, 0, sizeof(derived));
  memset(sessionMaster, 0, sizeof(sessionMaster));
  sendSequence = 1;
  expectedReceiveSequence = 1;
  sessionKeysReady = true;
  sessionAuthenticated = false;
}
