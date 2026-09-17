#include "ThermostatSensor.h"

ThermostatSensor::ThermostatSensor(uint8_t gpio) : dht(gpio, DHT22) {
}

void ThermostatSensor::begin() {
  dht.begin();
}

bool ThermostatSensor::loop(uint32_t intervalMs) {
  const uint32_t now = millis();
  if (!firstAttempt && now - lastAttemptAt < intervalMs) {
    return false;
  }

  firstAttempt = false;
  lastAttemptAt = now;
  const float humidityReading = dht.readHumidity();
  const float temperatureReading = dht.readTemperature();
  latestReadingValid = isfinite(temperatureReading) && isfinite(humidityReading);

  if (!latestReadingValid) {
    Serial.println("DHT22 reading failed; last valid values retained");
    return true;
  }

  lastTemperature = temperatureReading;
  lastHumidity = humidityReading;
  lastValidAt = now;
  validReadingAvailable = true;
  Serial.println(
    "DHT22: " + String(lastTemperature, 1) + " C, " +
    String(lastHumidity, 1) + " %"
  );
  return true;
}

bool ThermostatSensor::valid() const {
  return latestReadingValid && validReadingAvailable;
}

bool ThermostatSensor::hasReading() const {
  return validReadingAvailable;
}

float ThermostatSensor::temperature() const {
  return lastTemperature;
}

float ThermostatSensor::humidity() const {
  return lastHumidity;
}

uint32_t ThermostatSensor::ageMs() const {
  return validReadingAvailable ? millis() - lastValidAt : UINT32_MAX;
}
