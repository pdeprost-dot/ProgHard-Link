#pragma once

#include <Arduino.h>
#include <DHT.h>

class ThermostatSensor {
 public:
  explicit ThermostatSensor(uint8_t gpio);

  void begin();
  bool loop(uint32_t intervalMs);

  bool valid() const;
  bool hasReading() const;
  float temperature() const;
  float humidity() const;
  uint32_t ageMs() const;

 private:
  DHT dht;
  bool latestReadingValid = false;
  bool validReadingAvailable = false;
  float lastTemperature = NAN;
  float lastHumidity = NAN;
  uint32_t lastAttemptAt = 0;
  uint32_t lastValidAt = 0;
  bool firstAttempt = true;
};
