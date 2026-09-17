#include "QuadPzemConfig.h"

#include <ArduinoJson.h>
#include <LittleFS.h>

bool QuadPzemConfigStore::begin() {
  return LittleFS.begin();
}

bool QuadPzemConfigStore::load(QuadPzemConfig& config) {
  File file = LittleFS.open(PATH, "r");
  if (!file) return false;
  JsonDocument document;
  const DeserializationError error = deserializeJson(document, file);
  file.close();
  if (error || (document["version"] | 0) != QuadPzemConfig::VERSION) {
    return false;
  }
  config.readIntervalMs = document["readIntervalMs"] | 60000;
  config.mqttTopic = document["mqttTopic"] | "wattmeter/readings";
  return validate(config);
}

bool QuadPzemConfigStore::save(const QuadPzemConfig& config) {
  if (!validate(config)) return false;
  JsonDocument document;
  document["version"] = QuadPzemConfig::VERSION;
  document["readIntervalMs"] = config.readIntervalMs;
  document["mqttTopic"] = config.mqttTopic;
  File file = LittleFS.open(TEMP_PATH, "w");
  if (!file) return false;
  const bool written = serializeJson(document, file) > 0;
  file.close();
  if (!written) {
    LittleFS.remove(TEMP_PATH);
    return false;
  }
  LittleFS.remove(PATH);
  return LittleFS.rename(TEMP_PATH, PATH);
}

bool QuadPzemConfigStore::validate(const QuadPzemConfig& config) {
  return config.readIntervalMs >= QuadPzemConfig::MIN_INTERVAL_MS &&
         config.readIntervalMs <= QuadPzemConfig::MAX_INTERVAL_MS &&
         !config.mqttTopic.isEmpty() && config.mqttTopic.length() <= 96 &&
         config.mqttTopic[0] != '/' && !config.mqttTopic.endsWith("/") &&
         config.mqttTopic.indexOf('#') < 0 && config.mqttTopic.indexOf('+') < 0;
}
