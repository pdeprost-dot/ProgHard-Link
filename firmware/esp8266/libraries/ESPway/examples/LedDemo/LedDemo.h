#pragma once
#include <ESPway.h>

class LedDemo : public ESPwayApplication {
 public:
  const char* applicationId() const override;
  const char* firmwareVersion() const override;
  void begin(const ESPwayApplicationContext& context) override;
  void loop() override;
  bool handle(const WebRequest& request, WebResponse& response) override;
  bool isOn() const { return on; }

 private:
  bool on = false;
  void apply();
};
