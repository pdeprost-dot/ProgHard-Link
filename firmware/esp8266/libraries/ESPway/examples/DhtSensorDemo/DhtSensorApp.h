#pragma once

#include <DHT.h>
#include <ESPway.h>

class DhtSensorApp : public ESPwayApplication {
 public:
  const char* applicationId() const override;
  const char* firmwareVersion() const override;
  void begin(const ESPwayApplicationContext& context) override;
  void loop() override;
  bool handle(const WebRequest& request, WebResponse& response) override;
  const ESPwayNavigationItem* navigationItems(size_t& count) const override;

 private:
  static constexpr uint8_t DHT_GPIO = D5;
  static constexpr uint32_t MEASUREMENT_INTERVAL_MS = 10000;

  DHT sensor{DHT_GPIO, DHT22};
  float temperature = NAN;
  float humidity = NAN;
  uint32_t lastAttemptAt = 0;
  uint32_t lastValidAt = 0;
  bool firstAttempt = true;
  bool sensorValid = false;
  bool hasValidMeasurement = false;

  void readSensor();
  String page() const;
  String statusJson() const;
};
