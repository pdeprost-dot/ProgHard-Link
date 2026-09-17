#pragma once

#include <ESPway.h>

#include "QuadPzemConfig.h"
#include "QuadPzemMeter.h"

class QuadPzemApp : public ESPwayApplication {
 public:
  const char* applicationId() const override;
  const char* firmwareVersion() const override;
  void begin(const ESPwayApplicationContext& context) override;
  void loop() override;
  bool handle(const WebRequest& request, WebResponse& response) override;
  const ESPwayNavigationItem* navigationItems(size_t& count) const override;

 private:
  QuadPzemMeter meter;
  QuadPzemConfig config;
  QuadPzemConfigStore configStore;
  ESPwayMqttService* mqtt = nullptr;
  uint32_t lastCycleAt = 0;
  bool firstCycle = true;

  void measureAndPublish();
  bool updateConfiguration(const String& body, String& error);
  String statusJson() const;
  String configJson() const;
  String page() const;
};
