#include "ESPwayAeadSession.h"

#include <base64.h>
#include "ESPwayPlatform.h"
#include <libb64/cdecode.h>
#include <memory>

namespace {

constexpr const char* AEAD_PROTOCOL = "ESPWAY-AEAD-1";

bool constantTimeEqual(const uint8_t* first, const uint8_t* second, size_t length) {
  uint8_t difference = 0;
  for (size_t index = 0; index < length; ++index) {
    difference |= first[index] ^ second[index];
  }
  return difference == 0;
}

}  // namespace

bool ESPwayAeadSession::decrypt(
  const uint8_t key[32],
  const uint8_t noncePrefix[4],
  uint64_t sequence,
  const String& streamId,
  const String& type,
  const String& method,
  const String& path,
  const JsonObjectConst& envelope,
  String& plaintext
) {
  if (strcmp(envelope["version"] | "", AEAD_PROTOCOL) != 0) return false;
  if (strcmp(
        envelope["algorithm"] | "",
        ESPwayPlatform::SENSITIVE_CIPHER_NAME
      ) != 0) return false;
  const String encodedCiphertext = envelope["ciphertext"] | "";
  const String encodedTag = envelope["tag"] | "";
  const size_t ciphertextCapacity =
    base64_decode_expected_len(encodedCiphertext.length()) + 1;
  std::unique_ptr<uint8_t[]> ciphertext(new (std::nothrow) uint8_t[ciphertextCapacity]);
  uint8_t receivedTag[16];
  if (!ciphertext) return false;
  const int ciphertextLength = base64_decode_chars(
    encodedCiphertext.c_str(), encodedCiphertext.length(),
    reinterpret_cast<char*>(ciphertext.get())
  );
  const int tagLength = base64_decode_chars(
    encodedTag.c_str(), encodedTag.length(), reinterpret_cast<char*>(receivedTag)
  );
  if (ciphertextLength < 0 || tagLength != 16) return false;

  uint8_t nonce[12];
  memcpy(nonce, noncePrefix, 4);
  for (uint8_t index = 0; index < 8; ++index) {
    nonce[4 + index] = static_cast<uint8_t>(sequence >> (56 - index * 8));
  }
  char sequenceText[24];
  snprintf(
    sequenceText,
    sizeof(sequenceText),
    "%llu",
    static_cast<unsigned long long>(sequence)
  );
  const String aad = String(AEAD_PROTOCOL) + "\nS2C\n" +
    sequenceText + "\n" + streamId +
    "\n" + type + "\n" + method + "\n" + path;
  if (!ESPwayPlatform::sensitivePayloadDecrypt(
        ESPwayPlatform::SENSITIVE_CIPHER,
        key, nonce, ciphertext.get(), ciphertextLength,
        aad.c_str(), aad.length(), receivedTag)) {
    memset(ciphertext.get(), 0, ciphertextCapacity);
    return false;
  }
  plaintext = "";
  plaintext.concat(
    reinterpret_cast<const char*>(ciphertext.get()), ciphertextLength
  );
  memset(ciphertext.get(), 0, ciphertextCapacity);
  return true;
}

bool ESPwayAeadSession::isSensitiveRequest(
  const String& method,
  const String& path
) {
  return method == "POST" && (
    path == "/setup/save" ||
    path == "/config/save" ||
    path == "/api/espway/mqtt" ||
    path == "/api/espway/wifi/profile/1" ||
    path == "/api/espway/wifi/profile/2"
  );
}

bool ESPwayAeadSession::verifyCrossLanguageTestVector() {
#if defined(ESP8266)
  static const uint8_t key[32] = {
    0xdf, 0xff, 0x7c, 0xfb, 0xd1, 0x3a, 0x80, 0x9e,
    0x77, 0x06, 0x19, 0xc7, 0xd0, 0x42, 0xac, 0xda,
    0x29, 0xd7, 0x89, 0xa7, 0x70, 0x71, 0x1d, 0x12,
    0xf9, 0x4a, 0xc2, 0xeb, 0x52, 0x61, 0x30, 0xa9
  };
#else
  static const uint8_t key[32] = {
    0xa1, 0x74, 0xe2, 0xb9, 0x29, 0xaa, 0xb1, 0x1a,
    0x53, 0x05, 0xc2, 0xa9, 0x75, 0xdd, 0x3e, 0xb4,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
  };
#endif
  static const uint8_t prefix[4] = {0xde, 0xbc, 0x74, 0x74};
  JsonDocument document;
  document["version"] = AEAD_PROTOCOL;
#if defined(ESP8266)
  document["algorithm"] = "CHACHA20-POLY1305";
  document["ciphertext"] = "pC/ItCLR";
  document["tag"] = "xGwyFspereV5QRWE4TK6pg==";
#else
  document["algorithm"] = "AES-128-GCM";
  document["ciphertext"] = "iaazAgpH";
  document["tag"] = "P9eTypCLDzXRIc1yfH58pA==";
#endif
  String plaintext;
  return decrypt(
    key,
    prefix,
    7,
    "stream-1",
    "open",
    "POST",
    "/api/espway/mqtt",
    document.as<JsonObjectConst>(),
    plaintext
  ) && plaintext == "secret";
}
