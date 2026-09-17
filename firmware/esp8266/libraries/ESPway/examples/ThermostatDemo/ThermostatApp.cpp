#include "ThermostatApp.h"

#include <ArduinoJson.h>
#include <ctype.h>
#include <stdlib.h>

#include "ThermostatWeb.h"

const char* ThermostatApp::applicationId() const {
  return "thermostat-demo";
}

const char* ThermostatApp::firmwareVersion() const {
  return "0.2.0";
}

void ThermostatApp::begin(const ESPwayApplicationContext& context) {
  deviceId = context.deviceId;
  mqtt = &context.mqtt;

  configStore.begin();
  ESPwayMqttConfig legacyMqtt;
  if (!configStore.load(config, legacyMqtt)) {
    config = ThermostatConfig{};
    configStore.save(config);
    Serial.println("Thermostat defaults initialized");
  } else if (mqtt->importLegacyConfiguration(legacyMqtt)) {
    Serial.println(F("Legacy MQTT configuration migrated to ESPway"));
  }

  control.begin(config.fallbackSetpoint);
  sensor.begin();
  mqtt->subscribe("setpoint/set", mqttSetpointCallback, this);
  logHeap("Thermostat initialized");
}

void ThermostatApp::loop() {
  sensor.loop(config.measurementIntervalMs);
  control.update(sensor.valid(), sensor.temperature(), config.hysteresis);
  const bool mqttConnected = mqtt->connected();
  if (mqttConnected && (
        !statePublished ||
        publishedSetpoint != control.setpoint() ||
        publishedHeating != control.heating()
      )) {
    publishMqttState(false);
  }
  if (mqttConnected && millis() - lastPeriodicPublish >= config.publishIntervalMs) {
    lastPeriodicPublish = millis();
    publishMqttState(true);
  }
  if (!mqttConnected) {
    statePublished = false;
  }
}

bool ThermostatApp::handle(
  const WebRequest& request,
  WebResponse& response
) {
  if (request.path == "/thermostat") {
    response.contentType = "text/html";
    response.body = ThermostatWeb::page();
    return true;
  }

  if (request.path == "/thermostat/config") {
    response.contentType = "text/html";
    response.body = ThermostatWeb::configPage();
    return true;
  }

  if (request.path == "/thermostat/status.js") {
    response.contentType = "application/javascript";
    response.body = ThermostatWeb::statusScript();
    return true;
  }

  if (request.path == "/thermostat/config.js") {
    response.contentType = "application/javascript";
    response.body = ThermostatWeb::configScript();
    return true;
  }

  if (request.path == "/api/thermostat/status") {
    if (request.method != "GET") {
      response.status = 405;
      response.body = "{\"error\":\"method_not_allowed\"}";
      return true;
    }
    response.body = ThermostatWeb::statusJson(
      sensor,
      control,
      mqtt->connected()
    );
    return true;
  }

  if (handleRestApi(request, response)) {
    return true;
  }

  if (request.path != "/api/thermostat/config") {
    return false;
  }

  if (request.method == "GET") {
    response.body = ThermostatWeb::configJson(config);
    return true;
  }

  if (request.method != "POST") {
    response.status = 405;
    response.body = "{\"error\":\"method not allowed\"}";
    return true;
  }

  String error;
  if (!updateConfiguration(request.body, error)) {
    response.status = 400;
    response.body = "{\"error\":\"" + error + "\"}";
    return true;
  }

  response.body = "{\"status\":\"saved\"}";
  return true;
}

const ESPwayNavigationItem* ThermostatApp::navigationItems(
  size_t& count
) const {
  static const ESPwayNavigationItem items[] = {
    {"Thermostat", "/thermostat"},
    {"Config. thermostat", "/thermostat/config"}
  };
  count = sizeof(items) / sizeof(items[0]);
  return items;
}

bool ThermostatApp::handleRestApi(
  const WebRequest& request,
  WebResponse& response
) {
  if (request.path == "/api/thermostat/setpoint") {
    if (request.method == "GET") {
      response.body = ThermostatWeb::numberJson(control.setpoint());
      return true;
    }
    if (request.method == "POST") {
      return updateSetpoint(request.body, response);
    }
  } else if (request.path == "/api/thermostat/temperature") {
    if (request.method == "GET") {
      response.body = ThermostatWeb::measurementJson(
        sensor.temperature(),
        "C",
        sensor.valid()
      );
      return true;
    }
  } else if (request.path == "/api/thermostat/humidity") {
    if (request.method == "GET") {
      response.body = ThermostatWeb::measurementJson(
        sensor.humidity(),
        "%",
        sensor.valid()
      );
      return true;
    }
  } else if (request.path == "/api/thermostat/heating") {
    if (request.method == "GET") {
      response.body = ThermostatWeb::booleanJson(control.heating());
      return true;
    }
  } else {
    return false;
  }

  response.status = 405;
  response.body = "{\"error\":\"method_not_allowed\"}";
  return true;
}

bool ThermostatApp::updateSetpoint(
  const String& body,
  WebResponse& response
) {
  JsonDocument document;
  if (deserializeJson(document, body)) {
    response.status = 400;
    response.body = "{\"error\":\"invalid_json\"}";
    return true;
  }

  if (!document["value"].is<float>()) {
    response.status = 400;
    response.body = "{\"error\":\"invalid_setpoint\"}";
    return true;
  }

  const float value = document["value"].as<float>();
  if (!control.setSetpoint(value)) {
    response.status = 400;
    response.body = "{\"error\":\"invalid_setpoint\"}";
    return true;
  }

  response.body = ThermostatWeb::numberJson(control.setpoint());
  return true;
}

bool ThermostatApp::updateConfiguration(const String& body, String& error) {
  JsonDocument document;
  if (deserializeJson(document, body)) {
    error = "invalid json";
    return false;
  }

  ThermostatConfig updated = config;
  if (document["publishIntervalMs"].is<uint32_t>()) {
    updated.publishIntervalMs = document["publishIntervalMs"];
  }
  if (document["fallbackSetpoint"].is<float>()) {
    updated.fallbackSetpoint = document["fallbackSetpoint"];
  }
  if (document["hysteresis"].is<float>()) {
    updated.hysteresis = document["hysteresis"];
  }
  if (document["measurementIntervalMs"].is<uint32_t>()) {
    updated.measurementIntervalMs = document["measurementIntervalMs"];
  }

  if (!ThermostatConfigStore::validate(updated)) {
    error = "invalid configuration";
    return false;
  }
  if (!configStore.save(updated)) {
    error = "cannot save configuration";
    return false;
  }

  config = updated;
  Serial.println("Thermostat configuration saved");
  return true;
}

void ThermostatApp::publishMqttState(bool includeMeasurements) {
  char number[16];
  dtostrf(control.setpoint(), 0, 1, number);
  mqtt->publish("setpoint", number, true);
  mqtt->publish("heating", control.heating() ? "on" : "off", true);
  if (includeMeasurements && sensor.hasReading()) {
    dtostrf(sensor.temperature(), 0, 1, number);
    mqtt->publish("temperature", number, true);
    dtostrf(sensor.humidity(), 0, 1, number);
    mqtt->publish("humidity", number, true);
  }
  publishedSetpoint = control.setpoint();
  publishedHeating = control.heating();
  statePublished = true;
}

void ThermostatApp::mqttSetpointCallback(
  void* context,
  const char* relativeTopic,
  const uint8_t* payload,
  size_t length
) {
  if (strcmp(relativeTopic, "setpoint/set") != 0) return;
  static_cast<ThermostatApp*>(context)->handleMqttSetpoint(payload, length);
}

void ThermostatApp::handleMqttSetpoint(
  const uint8_t* payload,
  size_t length
) {
  if (length == 0 || length > 15) return;
  char text[16];
  memcpy(text, payload, length);
  text[length] = '\0';
  char* end = nullptr;
  const float value = strtof(text, &end);
  while (end != nullptr && *end != '\0' && isspace(*end)) ++end;
  if (end == text || end == nullptr || *end != '\0' ||
      !control.setSetpoint(value)) {
    Serial.println(F("Invalid MQTT setpoint ignored"));
    return;
  }
  statePublished = false;
  publishMqttState(false);
}

void ThermostatApp::logHeap(const char* label) const {
  Serial.println(
    String(label) + ": free=" + String(ESP.getFreeHeap()) +
    ", maxBlock=" + String(ESP.getMaxFreeBlockSize()) +
    ", fragmentation=" + String(ESP.getHeapFragmentation()) + "%"
  );
}
