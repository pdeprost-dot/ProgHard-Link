#include "ThermostatControl.h"

#include "ThermostatConfig.h"

void ThermostatControl::begin(float initialSetpoint) {
  pinMode(LED_BUILTIN, OUTPUT);
  activeSetpoint = initialSetpoint;
  heatingState = false;
  applyOutput();
}

void ThermostatControl::update(
  bool sensorValid,
  float temperature,
  float hysteresis
) {
  bool nextState = heatingState;
  if (!sensorValid) {
    nextState = false;
  } else if (temperature < activeSetpoint - hysteresis) {
    nextState = true;
  } else if (temperature > activeSetpoint + hysteresis) {
    nextState = false;
  }

  if (nextState != heatingState) {
    heatingState = nextState;
    applyOutput();
    Serial.println(heatingState ? "Heating ON" : "Heating OFF");
  }
}

bool ThermostatControl::setSetpoint(float value) {
  if (!ThermostatConfigStore::isValidSetpoint(value)) {
    return false;
  }
  activeSetpoint = value;
  return true;
}

float ThermostatControl::setpoint() const {
  return activeSetpoint;
}

bool ThermostatControl::heating() const {
  return heatingState;
}

void ThermostatControl::applyOutput() {
  digitalWrite(LED_BUILTIN, heatingState ? LOW : HIGH);
}
