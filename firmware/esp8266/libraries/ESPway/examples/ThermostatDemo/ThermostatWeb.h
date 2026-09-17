#pragma once

#include <ESPway.h>

#include "ThermostatConfig.h"
#include "ThermostatControl.h"
#include "ThermostatSensor.h"

class ThermostatWeb {
 public:
  static String page();
  static String configPage();
  static String statusScript();
  static String configScript();
  static String statusJson(
    const ThermostatSensor& sensor,
    const ThermostatControl& control,
    bool mqttConnected
  );
  static String measurementJson(float value, const char* unit, bool valid);
  static String numberJson(float value);
  static String booleanJson(bool value);
  static String configJson(const ThermostatConfig& config);
};
