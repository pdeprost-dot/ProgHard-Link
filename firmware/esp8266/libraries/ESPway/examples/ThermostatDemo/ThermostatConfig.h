#pragma once

#include <Arduino.h>
#include <ESPwayConfig.h>

struct ThermostatConfig {
  static constexpr uint16_t VERSION = 1;

  uint16_t configVersion = VERSION;
  uint32_t publishIntervalMs = 10000;
  float fallbackSetpoint = 21.0f;
  float hysteresis = 0.5f;
  uint32_t measurementIntervalMs = 10000;
};

class ThermostatConfigStore {
 public:
  bool begin();
  bool load(ThermostatConfig& config, ESPwayMqttConfig& legacyMqtt);
  bool save(const ThermostatConfig& config);

  static bool validate(ThermostatConfig& config);
  static bool isValidSetpoint(float value);

 private:
  static constexpr const char* PATH = "/thermostat.json";
  static constexpr const char* TEMP_PATH = "/thermostat.tmp";
};
