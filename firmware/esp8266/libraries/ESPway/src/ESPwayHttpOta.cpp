#include "ESPwayHttpOta.h"


#include <ArduinoJson.h>
#include "ESPwayPlatform.h"
#include <memory>
#include <new>

namespace {

constexpr size_t DATA_BUFFER_SIZE = 1024;
constexpr unsigned long HTTP_TIMEOUT_MS = 15000;
constexpr unsigned long PROGRESS_INTERVAL_MS = 5000;

bool validHttpUrl(const String& url) {
  if (!url.startsWith("http://") ||
      url.length() <= strlen("http://") ||
      url.length() > ESPwayHttpOta::URL_MAX_LENGTH) {
    return false;
  }
  for (size_t index = 0; index < url.length(); ++index) {
    const char character = url[index];
    if (character <= ' ' || character == '#' || character == '\\') {
      return false;
    }
  }
  const int authorityEnd = url.indexOf('/', strlen("http://"));
  const String authority = authorityEnd < 0
    ? url.substring(strlen("http://"))
    : url.substring(strlen("http://"), authorityEnd);
  return !authority.isEmpty() && authority[0] != ':' &&
         authority.indexOf('@') < 0;
}

bool parseSha256(const String& text, uint8_t output[32]) {
  if (text.length() != 64) {
    return false;
  }
  for (size_t index = 0; index < 32; ++index) {
    const char high = text[index * 2];
    const char low = text[index * 2 + 1];
    if (!isHexadecimalDigit(high) || !isHexadecimalDigit(low)) {
      return false;
    }
    const uint8_t highValue = high <= '9'
      ? high - '0'
      : tolower(high) - 'a' + 10;
    const uint8_t lowValue = low <= '9'
      ? low - '0'
      : tolower(low) - 'a' + 10;
    output[index] = (highValue << 4) | lowValue;
  }
  return true;
}

bool constantTimeEqual(
  const uint8_t first[32],
  const uint8_t second[32]
) {
  uint8_t difference = 0;
  for (size_t index = 0; index < 32; ++index) {
    difference |= first[index] ^ second[index];
  }
  return difference == 0;
}

void abortUpdate() {
  if (Update.isRunning()) {
    Update.end(false);
  }
}

}  // namespace

bool ESPwayHttpOta::parseCommand(
  const String& body,
  ESPwayHttpOtaCommand& command,
  String& error
) {
  JsonDocument document;
  if (deserializeJson(document, body)) {
    error = "invalid_json";
    return false;
  }
  if (!document["url"].is<const char*>()) {
    error = "invalid_url";
    return false;
  }
  if (!document["sha256"].is<const char*>()) {
    error = "invalid_sha256";
    return false;
  }
  if (!document["firmwareVersion"].is<const char*>()) {
    error = "invalid_firmware_version";
    return false;
  }

  ESPwayHttpOtaCommand candidate;
  candidate.url = document["url"].as<String>();
  candidate.sha256 = document["sha256"].as<String>();
  candidate.sha256.toLowerCase();
  candidate.firmwareVersion = document["firmwareVersion"].as<String>();
  candidate.firmwareVersion.trim();
  if (document["size"].is<uint32_t>()) {
    candidate.size = document["size"].as<uint32_t>();
    if (candidate.size == 0) {
      error = "invalid_size";
      return false;
    }
  } else if (!document["size"].isNull()) {
    error = "invalid_size";
    return false;
  }

  uint8_t digest[32];
  if (!validHttpUrl(candidate.url)) {
    error = "invalid_url";
    return false;
  }
  if (!parseSha256(candidate.sha256, digest)) {
    error = "invalid_sha256";
    return false;
  }
  if (candidate.firmwareVersion.isEmpty() ||
      candidate.firmwareVersion.length() > VERSION_MAX_LENGTH) {
    error = "invalid_firmware_version";
    return false;
  }
  for (size_t index = 0; index < candidate.firmwareVersion.length(); ++index) {
    if (candidate.firmwareVersion[index] < ' ') {
      error = "invalid_firmware_version";
      return false;
    }
  }
  if (candidate.size > ESP.getFreeSketchSpace()) {
    error = "firmware_too_large";
    return false;
  }

  command = candidate;
  return true;
}

bool ESPwayHttpOta::download(
  const ESPwayHttpOtaCommand& command,
  String& error
) {
  if (WiFi.status() != WL_CONNECTED) {
    error = "wifi_disconnected";
    return false;
  }

  WiFiClient client;
  HTTPClient http;
  http.setTimeout(HTTP_TIMEOUT_MS);
  http.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
  if (!http.begin(client, command.url)) {
    error = "http_initialization_failed";
    return false;
  }

  const int status = http.GET();
  Serial.println("OTA HTTP status: " + String(status));
  if (status != HTTP_CODE_OK) {
    http.end();
    error = "http_status_" + String(status);
    return false;
  }

  const int contentLength = http.getSize();
  if (contentLength <= 0) {
    http.end();
    error = "content_length_required";
    return false;
  }
  const size_t expectedSize = static_cast<size_t>(contentLength);
  if (command.size != 0 && command.size != expectedSize) {
    http.end();
    error = "size_mismatch";
    return false;
  }
  if (expectedSize > ESP.getFreeSketchSpace()) {
    http.end();
    error = "firmware_too_large";
    return false;
  }
  if (!Update.begin(expectedSize, U_FLASH)) {
    http.end();
    Update.printError(Serial);
    error = "update_begin_failed";
    return false;
  }

  std::unique_ptr<uint8_t[]> buffer(
    new (std::nothrow) uint8_t[DATA_BUFFER_SIZE]
  );
  std::unique_ptr<uint8_t[]> pending(
    new (std::nothrow) uint8_t[DATA_BUFFER_SIZE]
  );
  if (!buffer || !pending) {
    abortUpdate();
    http.end();
    error = "buffer_allocation_failed";
    return false;
  }

  Serial.println("OTA HTTP download started");
  Serial.println("OTA target version: " + command.firmwareVersion);
  Serial.println("OTA expected bytes: " + String(expectedSize));

  ESPwayPlatform::Sha256 hash;
  hash.begin();
  WiFiClient* stream = http.getStreamPtr();
  size_t received = 0;
  size_t pendingLength = 0;
  unsigned long lastDataAt = millis();
  unsigned long lastProgressAt = millis();

  while (received < expectedSize) {
    const size_t available = stream->available();
    if (available == 0) {
      if (!http.connected()) {
        break;
      }
      if (millis() - lastDataAt >= HTTP_TIMEOUT_MS) {
        abortUpdate();
        http.end();
        error = "download_timeout";
        return false;
      }
      delay(1);
      yield();
      continue;
    }

    const size_t count = stream->readBytes(
      buffer.get(),
      min(
        min(available, DATA_BUFFER_SIZE),
        expectedSize - received
      )
    );
    if (count == 0) {
      continue;
    }
    lastDataAt = millis();
    hash.update(buffer.get(), count);
    if (pendingLength != 0 &&
        Update.write(pending.get(), pendingLength) != pendingLength) {
      abortUpdate();
      http.end();
      Update.printError(Serial);
      error = "update_write_failed";
      return false;
    }
    memcpy(pending.get(), buffer.get(), count);
    pendingLength = count;
    received += count;
    if (millis() - lastProgressAt >= PROGRESS_INTERVAL_MS) {
      Serial.println("OTA bytes received: " + String(received));
      lastProgressAt = millis();
    }
    yield();
  }

  http.end();
  if (received != expectedSize) {
    abortUpdate();
    error = "truncated_firmware";
    return false;
  }

  uint8_t actualDigest[32];
  uint8_t expectedDigest[32];
  hash.finish(actualDigest);
  parseSha256(command.sha256, expectedDigest);
  if (!constantTimeEqual(actualDigest, expectedDigest)) {
    memset(actualDigest, 0, sizeof(actualDigest));
    memset(expectedDigest, 0, sizeof(expectedDigest));
    abortUpdate();
    error = "sha256_mismatch";
    return false;
  }
  memset(actualDigest, 0, sizeof(actualDigest));
  memset(expectedDigest, 0, sizeof(expectedDigest));
  Serial.println(F("OTA SHA-256 verified"));

  if (pendingLength == 0 ||
      Update.write(pending.get(), pendingLength) != pendingLength) {
    abortUpdate();
    Update.printError(Serial);
    error = "update_write_failed";
    return false;
  }
  if (!Update.end(false)) {
    Update.printError(Serial);
    error = "update_finalize_failed";
    return false;
  }

  Serial.println("OTA bytes received: " + String(received));
  Serial.println(F("OTA update finalized"));
  return true;
}
