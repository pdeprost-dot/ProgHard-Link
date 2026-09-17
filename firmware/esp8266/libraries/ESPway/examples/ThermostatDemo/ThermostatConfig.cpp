#include "ThermostatConfig.h"

#include <ArduinoJson.h>
#include <LittleFS.h>

namespace {

constexpr uint32_t MIN_INTERVAL_MS = 2000;
constexpr uint32_t MAX_INTERVAL_MS = 3600000;

}  // namespace

bool ThermostatConfigStore::begin() {
  return LittleFS.begin();
}

bool ThermostatConfigStore::load(
  ThermostatConfig& config,
  ESPwayMqttConfig& legacyMqtt
) {
  config = ThermostatConfig{};
  legacyMqtt = ESPwayMqttConfig{};

  File file = LittleFS.open(PATH, "r");
  if (!file) {
    return false;
  }

  JsonDocument document;
  const DeserializationError error = deserializeJson(document, file);
  file.close();
  if (error || (document["configVersion"] | 0) != ThermostatConfig::VERSION) {
    return false;
  }

  legacyMqtt.enabled = document["mqttEnabled"] | false;
  legacyMqtt.host = document["mqttHost"] | "";
  legacyMqtt.port = document["mqttPort"] | 1883;
  legacyMqtt.username = document["mqttUsername"] | "";
  legacyMqtt.password = document["mqttPassword"] | "";
  legacyMqtt.baseTopic = document["baseTopic"] | "";
  config.publishIntervalMs = document["publishIntervalMs"] | 10000;
  config.fallbackSetpoint = document["fallbackSetpoint"] | 21.0f;
  config.hysteresis = document["hysteresis"] | 0.5f;
  config.measurementIntervalMs = document["measurementIntervalMs"] | 10000;
  return validate(config);
}

bool ThermostatConfigStore::save(const ThermostatConfig& config) {
  JsonDocument document;
  document["configVersion"] = ThermostatConfig::VERSION;
  document["publishIntervalMs"] = config.publishIntervalMs;
  document["fallbackSetpoint"] = config.fallbackSetpoint;
  document["hysteresis"] = config.hysteresis;
  document["measurementIntervalMs"] = config.measurementIntervalMs;

  File file = LittleFS.open(TEMP_PATH, "w");
  if (!file) {
    return false;
  }

  const bool written = serializeJson(document, file) > 0;
  file.close();
  if (!written) {
    LittleFS.remove(TEMP_PATH);
    return false;
  }

  LittleFS.remove(PATH);
  return LittleFS.rename(TEMP_PATH, PATH);
}

bool ThermostatConfigStore::validate(ThermostatConfig& config) {
  if (
    config.publishIntervalMs < MIN_INTERVAL_MS ||
    config.publishIntervalMs > MAX_INTERVAL_MS ||
    config.measurementIntervalMs < MIN_INTERVAL_MS ||
    config.measurementIntervalMs > MAX_INTERVAL_MS ||
    !isValidSetpoint(config.fallbackSetpoint) ||
    !isfinite(config.hysteresis) ||
    config.hysteresis < 0.1f ||
    config.hysteresis > 5.0f
  ) {
    return false;
  }

  return true;
}

bool ThermostatConfigStore::isValidSetpoint(float value) {
  return isfinite(value) && value >= 5.0f && value <= 35.0f;
}
