#pragma once

#include <ESPway.h>

class ESPwayBaseApp : public ESPwayApplication {
 public:
  const char* applicationId() const override;
  const char* firmwareVersion() const override;
  void begin(const ESPwayApplicationContext& context) override;
  void loop() override;
  bool handle(const WebRequest& request, WebResponse& response) override;
  const ESPwayNavigationItem* navigationItems(size_t& count) const override;

 private:
  static constexpr bool LED_ACTIVE_LOW = true;

  const String* deviceId = nullptr;
  bool ledOn = false;

  void applyLedState();
  String page() const;
};
