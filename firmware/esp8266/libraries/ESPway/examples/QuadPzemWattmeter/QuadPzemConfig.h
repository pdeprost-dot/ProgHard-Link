#pragma once

#include <Arduino.h>

struct QuadPzemConfig {
  static constexpr uint16_t VERSION = 1;
  static constexpr uint32_t MIN_INTERVAL_MS = 15000;
  static constexpr uint32_t MAX_INTERVAL_MS = 900000;

  uint32_t readIntervalMs = 60000;
  String mqttTopic = "wattmeter/readings";
};

class QuadPzemConfigStore {
 public:
  bool begin();
  bool load(QuadPzemConfig& config);
  bool save(const QuadPzemConfig& config);
  static bool validate(const QuadPzemConfig& config);

 private:
  static constexpr const char* PATH = "/quad-pzem.json";
  static constexpr const char* TEMP_PATH = "/quad-pzem.tmp";
};
