#include <ESPway.h>

class ESPwayBaseESP32App : public ESPwayApplication {
 public:
  const char* applicationId() const override { return "espway-base"; }
  const char* firmwareVersion() const override { return "0.2.3"; }

  void begin(const ESPwayApplicationContext& context) override {
    Serial.println("ProgHard Link application ready: " + context.deviceId);
  }

  void loop() override {}

  bool handle(const WebRequest&, WebResponse&) override { return false; }
};

ESPwayFramework espway;
ESPwayBaseESP32App application;

void setup() {
  Serial.begin(115200);
  delay(500);
  espway.begin(application);
}

void loop() {
  espway.loop();
}
