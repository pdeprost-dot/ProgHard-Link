#include "ESPwayStreamOta.h"

#include "ESPwayPlatform.h"
#include <ctype.h>

namespace {

bool parseDigest(const String& text, uint8_t output[32]) {
  if (text.length() != 64) return false;
  for (size_t index = 0; index < 32; ++index) {
    const char high = tolower(text[index * 2]);
    const char low = tolower(text[index * 2 + 1]);
    if (!isxdigit(static_cast<unsigned char>(high)) ||
        !isxdigit(static_cast<unsigned char>(low))) return false;
    const auto value = [](char digit) -> uint8_t {
      return digit <= '9' ? digit - '0' : digit - 'a' + 10;
    };
    output[index] = (value(high) << 4) | value(low);
  }
  return true;
}

bool constantTimeEqual(const uint8_t* first, const uint8_t* second, size_t length) {
  uint8_t difference = 0;
  for (size_t index = 0; index < length; ++index) difference |= first[index] ^ second[index];
  return difference == 0;
}

}  // namespace

bool ESPwayStreamOta::begin(
  ESPwayOtaAuthorization& authorization,
  const String& deviceToken,
  const String& deviceId,
  size_t expectedSize,
  const String& expectedSha256,
  const String& proof
) {
  abort();
  if (expectedSize == 0 || expectedSize > MAX_FIRMWARE_SIZE ||
      expectedSize > ESP.getFreeSketchSpace() ||
      !parseDigest(expectedSha256, expectedDigest)) {
    Serial.println(F("OTA stream rejected: invalid size or digest"));
    return false;
  }
  if (!authorization.verify(
        deviceToken, deviceId, expectedSize, expectedSha256, proof)) {
    return false;
  }
  Serial.printf_P(
    PSTR("OTA stream before Update.begin: heap=%u maxBlock=%u fragmentation=%u%%\n"),
    ESPwayPlatform::freeHeap(), ESPwayPlatform::maxFreeBlock(),
    ESPwayPlatform::heapFragmentation()
  );
  if (!Update.begin(expectedSize, U_FLASH)) {
    Serial.print(F("OTA stream Update.begin failed: "));
    Update.printError(Serial);
    return false;
  }
  expected = expectedSize;
  written = 0;
  shaContext.begin();
  running = true;
  minHeap = ESPwayPlatform::freeHeap();
  minBlock = ESPwayPlatform::maxFreeBlock();
  maxFragmentation = ESPwayPlatform::heapFragmentation();
  startedAt = millis();
  elapsedMs = 0;
  return true;
}

bool ESPwayStreamOta::write(const uint8_t* data, size_t length) {
  if (!running || !data || length == 0 || written + length > expected) {
    abort();
    return false;
  }
  if (Update.write(const_cast<uint8_t*>(data), length) != length) {
    abort();
    return false;
  }
  shaContext.update(data, length);
  written += length;
  sampleMemory();
  return true;
}

bool ESPwayStreamOta::finish() {
  if (!running || written != expected) {
    abort();
    return false;
  }
  uint8_t digest[32];
  shaContext.finish(digest);
  const bool digestMatches = constantTimeEqual(digest, expectedDigest, sizeof(digest));
  Serial.println(
    digestMatches
      ? F("OTA validation: streamed SHA-256 matches expected digest")
      : F("OTA validation: streamed SHA-256 mismatch")
  );
  memset(digest, 0, sizeof(digest));
  if (!digestMatches || !Update.end(true)) {
    abort();
    return false;
  }
  elapsedMs = millis() - startedAt;
  running = false;
  return true;
}

void ESPwayStreamOta::abort() {
  if (running || Update.isRunning()) Update.end(false);
  running = false;
  expected = 0;
  written = 0;
  memset(expectedDigest, 0, sizeof(expectedDigest));
}

void ESPwayStreamOta::sampleMemory() {
  minHeap = min(minHeap, ESPwayPlatform::freeHeap());
  minBlock = min(minBlock, ESPwayPlatform::maxFreeBlock());
  maxFragmentation = max(
    maxFragmentation,
    static_cast<uint8_t>(ESPwayPlatform::heapFragmentation())
  );
}
