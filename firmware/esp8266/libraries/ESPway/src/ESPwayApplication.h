#pragma once
#include <Arduino.h>

class ESPwayMqttService;

struct WebRequest {
  String method;
  String path;
  String body;
  String query;
};

struct WebResponse {
  int status = 200;
  String contentType = "application/json";
  String body;
};

struct ESPwayApplicationContext {
  const String& deviceId;
  ESPwayMqttService& mqtt;
};

struct ESPwayNavigationItem {
  const char* label;
  const char* path;
};

class ESPwayApplication {
 public:
  virtual const char* applicationId() const = 0;
  virtual const char* firmwareVersion() const = 0;
  virtual void begin(const ESPwayApplicationContext& context) = 0;
  virtual void loop() = 0;
  virtual bool handle(const WebRequest& request, WebResponse& response) = 0;
  virtual const ESPwayNavigationItem* navigationItems(size_t& count) const {
    count = 0;
    return nullptr;
  }
};
