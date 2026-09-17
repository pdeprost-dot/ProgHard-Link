#pragma once

#include <ESPway.h>

#include "ThermostatConfig.h"
#include "ThermostatControl.h"
#include "ThermostatSensor.h"

class ThermostatApp : public ESPwayApplication {
 public:
  const char* applicationId() const override;
  const char* firmwareVersion() const override;
  void begin(const ESPwayApplicationContext& context) override;
  void loop() override;
  bool handle(const WebRequest& request, WebResponse& response) override;
  const ESPwayNavigationItem* navigationItems(size_t& count) const override;

 private:
  static constexpr uint8_t DHT_GPIO = D5;

  String deviceId;
  ThermostatConfigStore configStore;
  ThermostatConfig config;
  ThermostatSensor sensor{DHT_GPIO};
  ThermostatControl control;
  ESPwayMqttService* mqtt = nullptr;
  uint32_t lastPeriodicPublish = 0;
  float publishedSetpoint = NAN;
  bool publishedHeating = false;
  bool statePublished = false;

  bool handleRestApi(const WebRequest& request, WebResponse& response);
  bool updateSetpoint(const String& body, WebResponse& response);
  bool updateConfiguration(const String& body, String& error);
  void publishMqttState(bool includeMeasurements);
  static void mqttSetpointCallback(
    void* context,
    const char* relativeTopic,
    const uint8_t* payload,
    size_t length
  );
  void handleMqttSetpoint(const uint8_t* payload, size_t length);
  void logHeap(const char* label) const;
};
