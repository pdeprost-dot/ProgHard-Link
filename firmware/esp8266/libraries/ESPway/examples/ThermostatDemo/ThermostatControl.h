#pragma once

#include <Arduino.h>

class ThermostatControl {
 public:
  void begin(float initialSetpoint);
  void update(bool sensorValid, float temperature, float hysteresis);
  bool setSetpoint(float value);

  float setpoint() const;
  bool heating() const;

 private:
  float activeSetpoint = 21.0f;
  bool heatingState = false;

  void applyOutput();
};
