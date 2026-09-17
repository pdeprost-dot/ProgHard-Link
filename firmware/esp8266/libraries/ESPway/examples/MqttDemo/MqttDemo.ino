#include <ESPway.h>

namespace {
class MqttDemoApplication : public ESPwayApplication {
 public:
  const char* applicationId() const override { return "mqtt-demo"; }
  const char* firmwareVersion() const override { return "0.1.0"; }

  void begin(const ESPwayApplicationContext& context) override {
    mqtt_ = &context.mqtt;
    mqtt_->subscribe("demo/value/set", onValueSet, this);
  }

  void loop() override {
    if (mqtt_ != nullptr && mqtt_->connected() && !published_) {
      published_ = mqtt_->publish("demo/value", value_, true);
    }
    if (mqtt_ != nullptr && !mqtt_->connected()) published_ = false;
  }

  bool handle(const WebRequest& request, WebResponse& response) override {
    if (request.path != "/api/demo") return false;
    response.body = "{\"value\":" + String(value_) + "}";
    return true;
  }

 private:
  ESPwayMqttService* mqtt_ = nullptr;
  int32_t value_ = 0;
  bool published_ = false;

  static void onValueSet(void* context, const char* relativeTopic,
                         const uint8_t* payload, size_t length) {
    if (strcmp(relativeTopic, "demo/value/set") != 0 || length == 0 ||
        length >= 16) {
      return;
    }
    char text[16];
    memcpy(text, payload, length);
    text[length] = '\0';
    char* end = nullptr;
    const long parsed = strtol(text, &end, 10);
    if (*end != '\0') return;
    MqttDemoApplication* self =
      static_cast<MqttDemoApplication*>(context);
    self->value_ = static_cast<int32_t>(parsed);
    self->published_ = self->mqtt_->publish(
      "demo/value", self->value_, true
    );
  }
};

MqttDemoApplication application;
ESPwayFramework espway;
}

void setup() {
  Serial.begin(115200);
  espway.begin(application);
}

void loop() { espway.loop(); }
