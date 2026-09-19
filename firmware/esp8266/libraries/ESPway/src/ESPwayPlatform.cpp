#include "ESPwayPlatform.h"

#include <new>

#if defined(ESP8266)
extern "C" {
#include <bearssl/bearssl_block.h>
#include <bearssl/bearssl_hash.h>
#include <bearssl/bearssl_hmac.h>
#include <user_interface.h>
}
#elif defined(ESP32)
#include <esp_system.h>
#include <mbedtls/gcm.h>
#include <mbedtls/md.h>
#include <mbedtls/sha256.h>
#endif

namespace ESPwayPlatform {

bool beginFileSystem() {
#if defined(ESP8266)
  return LittleFS.begin();
#else
  return LittleFS.begin(true);
#endif
}

String deviceId() {
#if defined(ESP8266)
  return "esp-" + String(ESP.getChipId(), HEX);
#else
  const uint32_t suffix = static_cast<uint32_t>(ESP.getEfuseMac() & 0xffffffffULL);
  char value[13];
  snprintf(value, sizeof(value), "esp-%08x", suffix);
  return String(value);
#endif
}

const char* hardwareId() {
#if defined(ESP8266)
  return "esp8266";
#elif defined(CONFIG_IDF_TARGET_ESP32C6)
  return "esp32-c6";
#elif defined(CONFIG_IDF_TARGET_ESP32S3)
  return "esp32-s3";
#elif defined(CONFIG_IDF_TARGET_ESP32C3)
  return "esp32-c3";
#else
  return "esp32";
#endif
}

uint32_t freeHeap() { return ESP.getFreeHeap(); }

uint32_t maxFreeBlock() {
#if defined(ESP8266)
  return ESP.getMaxFreeBlockSize();
#else
  return ESP.getMaxAllocHeap();
#endif
}

uint32_t heapFragmentation() {
#if defined(ESP8266)
  return ESP.getHeapFragmentation();
#else
  const uint32_t free = ESP.getFreeHeap();
  const uint32_t largest = ESP.getMaxAllocHeap();
  return free == 0 || largest >= free
    ? 0
    : static_cast<uint32_t>(100ULL * (free - largest) / free);
#endif
}

uint32_t flashSize() { return ESP.getFlashChipSize(); }

uint32_t otaMaxBytes() { return ESP.getFreeSketchSpace(); }

String resetReason() {
#if defined(ESP8266)
  return ESP.getResetReason();
#else
  return String(static_cast<int>(esp_reset_reason()));
#endif
}

bool setHostname(const String& hostname) {
  return WiFi.setHostname(hostname.c_str());
}

bool randomBytes(uint8_t* output, size_t length) {
  if (!output || length == 0) return false;
#if defined(ESP8266)
  return os_get_random(output, length) == 0;
#else
  esp_fill_random(output, length);
  return true;
#endif
}

void collectOtaHeaders(ESPwayWebServer& server) {
#if defined(ESP8266)
  server.collectHeaders(
    "X-ESPway-OTA-Size",
    "X-ESPway-OTA-SHA256",
    "X-ESPway-OTA-Proof"
  );
#else
  const char* headers[] = {
    "X-ESPway-OTA-Size",
    "X-ESPway-OTA-SHA256",
    "X-ESPway-OTA-Proof"
  };
  server.collectHeaders(headers, 3);
#endif
}

struct Sha256::State {
#if defined(ESP8266)
  br_sha256_context context;
#else
  mbedtls_sha256_context context;
#endif
};

Sha256::Sha256() : state(new (std::nothrow) State) {}
Sha256::~Sha256() { delete state; }

void Sha256::begin() {
#if defined(ESP8266)
  br_sha256_init(&state->context);
#else
  mbedtls_sha256_init(&state->context);
  mbedtls_sha256_starts(&state->context, 0);
#endif
}

void Sha256::update(const void* data, size_t length) {
#if defined(ESP8266)
  br_sha256_update(&state->context, data, length);
#else
  mbedtls_sha256_update(
    &state->context, static_cast<const unsigned char*>(data), length
  );
#endif
}

void Sha256::finish(uint8_t output[32]) {
#if defined(ESP8266)
  br_sha256_out(&state->context, output);
#else
  mbedtls_sha256_finish(&state->context, output);
  mbedtls_sha256_free(&state->context);
#endif
}

struct HmacSha256::State {
#if defined(ESP8266)
  br_hmac_key_context key;
  br_hmac_context context;
#else
  mbedtls_md_context_t context;
#endif
};

HmacSha256::HmacSha256() : state(new (std::nothrow) State) {
#if defined(ESP32)
  if (state) mbedtls_md_init(&state->context);
#endif
}

HmacSha256::~HmacSha256() {
#if defined(ESP32)
  if (state) mbedtls_md_free(&state->context);
#endif
  delete state;
}

bool HmacSha256::begin(const uint8_t* key, size_t keyLength) {
  if (!state) return false;
#if defined(ESP8266)
  br_hmac_key_init(&state->key, &br_sha256_vtable, key, keyLength);
  br_hmac_init(&state->context, &state->key, 32);
  return true;
#else
  const mbedtls_md_info_t* info = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
  return info && mbedtls_md_setup(&state->context, info, 1) == 0 &&
    mbedtls_md_hmac_starts(&state->context, key, keyLength) == 0;
#endif
}

void HmacSha256::update(const void* data, size_t length) {
#if defined(ESP8266)
  br_hmac_update(&state->context, data, length);
#else
  mbedtls_md_hmac_update(
    &state->context, static_cast<const unsigned char*>(data), length
  );
#endif
}

void HmacSha256::finish(uint8_t output[32]) {
#if defined(ESP8266)
  br_hmac_out(&state->context, output);
#else
  mbedtls_md_hmac_finish(&state->context, output);
#endif
}

bool sensitivePayloadDecrypt(
  SensitiveCipher cipher, const uint8_t* key,
  const uint8_t nonce[12], uint8_t* data,
  size_t dataLength, const void* aad, size_t aadLength, const uint8_t tag[16]
) {
#if defined(ESP8266)
  if (cipher != SensitiveCipher::ChaCha20Poly1305) return false;
  uint8_t computedTag[16];
  br_poly1305_ctmul32_run(
    key, nonce, data, dataLength, aad, aadLength,
    computedTag, &br_chacha20_ct_run, 0
  );
  uint8_t difference = 0;
  for (size_t i = 0; i < sizeof(computedTag); ++i) difference |= computedTag[i] ^ tag[i];
  return difference == 0;
#else
  if (cipher != SensitiveCipher::Aes128Gcm) return false;
  mbedtls_gcm_context context;
  mbedtls_gcm_init(&context);
  const int setup = mbedtls_gcm_setkey(
    &context, MBEDTLS_CIPHER_ID_AES, key, 128
  );
  const int result = setup == 0
    ? mbedtls_gcm_auth_decrypt(
        &context, dataLength, nonce, 12,
        static_cast<const unsigned char*>(aad), aadLength,
        tag, 16, data, data
      )
    : setup;
  mbedtls_gcm_free(&context);
  return result == 0;
#endif
}

}  // namespace ESPwayPlatform
