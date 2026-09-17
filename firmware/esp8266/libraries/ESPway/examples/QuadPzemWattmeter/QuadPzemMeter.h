#pragma once

#include <Arduino.h>
#include <SoftwareSerial.h>

struct PzemReading {
  float voltage = NAN;
  float current = NAN;
  float power = NAN;
  uint32_t energyWh = 0;
  float frequency = NAN;
  float powerFactor = NAN;
  bool alarm = false;
  bool valid = false;
  uint32_t updatedAt = 0;
  uint32_t errors = 0;
};

class QuadPzemMeter {
 public:
  static constexpr uint8_t METER_COUNT = 4;
  static constexpr uint8_t RX_GPIO = 12;  // Wemos D6, connect to PZEM TX
  static constexpr uint8_t TX_GPIO = 14;  // Wemos D5, connect to PZEM RX

  QuadPzemMeter();
  void begin();
  void readAll();
  const PzemReading& reading(uint8_t index) const;

 private:
  SoftwareSerial bus;
  PzemReading readings[METER_COUNT];

  bool readOne(uint8_t address, PzemReading& result);
  static uint16_t crc16(const uint8_t* data, size_t length);
};
