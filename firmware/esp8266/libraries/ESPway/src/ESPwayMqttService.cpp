#include "ESPwayMqttService.h"

ESPwayMqttService* ESPwayMqttService::callbackOwner = nullptr;

ESPwayMqttService::ESPwayMqttService() : client(networkClient) {
}

void ESPwayMqttService::begin(
  ESPwayConfig& configuration,
  PersistentConfig& persistentStore,
  const String& deviceIdentifier
) {
  config = &configuration;
  store = &persistentStore;
  deviceId = deviceIdentifier;
  callbackOwner = this;
  client.setBufferSize(BUFFER_SIZE);
  client.setSocketTimeout(SOCKET_TIMEOUT_SECONDS);
#if defined(ESP32)
  networkClient.setConnectionTimeout(CONNECTION_TIMEOUT_MS);
#endif
  client.setCallback(callback);
}

void ESPwayMqttService::loop(bool networkReady) {
  if (!networkReady || config == nullptr || !config->mqtt.enabled ||
      config->mqtt.host.isEmpty()) {
    if (client.connected()) {
      disconnect();
    }
    networkWasReady = networkReady;
    return;
  }

  if (!networkWasReady) {
    nextConnectAttempt = millis();
  }
  networkWasReady = true;

  if (!client.connected()) {
    if (static_cast<long>(millis() - nextConnectAttempt) >= 0) {
      connect();
      nextConnectAttempt = millis() + RETRY_MS;
    }
    return;
  }
  client.loop();
  if (static_cast<int32_t>(millis() - nextTelemetryAt) >= 0) {
    publishSystemTelemetry();
    nextTelemetryAt = millis() + TELEMETRY_INTERVAL_MS;
  }
}

bool ESPwayMqttService::publish(
  const char* suffix,
  const char* payload,
  bool retained
) {
  if (payload == nullptr) {
    return false;
  }
  return publish(
    suffix, reinterpret_cast<const uint8_t*>(payload), strlen(payload), retained
  );
}

bool ESPwayMqttService::publish(
  const char* suffix,
  const uint8_t* payload,
  size_t length,
  bool retained
) {
  if (!client.connected() || !validSuffix(suffix) || payload == nullptr ||
      length > MAX_PAYLOAD_SIZE) {
    return false;
  }
  const String fullTopic = topic(suffix);
  return client.publish(fullTopic.c_str(), payload, length, retained);
}

bool ESPwayMqttService::publish(
  const char* suffix, int32_t value, bool retained
) {
  char payload[16];
  snprintf(payload, sizeof(payload), "%ld", static_cast<long>(value));
  return publish(suffix, payload, retained);
}

bool ESPwayMqttService::publish(
  const char* suffix, uint32_t value, bool retained
) {
  char payload[16];
  snprintf(payload, sizeof(payload), "%lu", static_cast<unsigned long>(value));
  return publish(suffix, payload, retained);
}

bool ESPwayMqttService::publish(
  const char* suffix, float value, uint8_t decimals, bool retained
) {
  if (decimals > 6) decimals = 6;
  char payload[32];
  dtostrf(value, 0, decimals, payload);
  return publish(suffix, payload, retained);
}

bool ESPwayMqttService::publish(
  const char* suffix, bool value, bool retained
) {
  return publish(suffix, value ? "true" : "false", retained);
}

bool ESPwayMqttService::subscribe(
  const char* suffix,
  MessageHandler handler,
  void* context
) {
  if (!validSuffix(suffix) || handler == nullptr ||
      subscriptionCount >= MAX_SUBSCRIPTIONS) {
    return false;
  }
  Subscription& subscription = subscriptions[subscriptionCount++];
  memcpy(subscription.suffix, suffix, strlen(suffix) + 1);
  subscription.handler = handler;
  subscription.context = context;
  if (client.connected()) {
    const String fullTopic = topic(suffix);
    return client.subscribe(fullTopic.c_str());
  }
  return true;
}

bool ESPwayMqttService::subscribe(
  const char* suffix,
  LegacyMessageHandler handler,
  void* context
) {
  if (!validSuffix(suffix) || handler == nullptr ||
      subscriptionCount >= MAX_SUBSCRIPTIONS) {
    return false;
  }
  Subscription& subscription = subscriptions[subscriptionCount++];
  memcpy(subscription.suffix, suffix, strlen(suffix) + 1);
  subscription.legacyHandler = handler;
  subscription.context = context;
  if (client.connected()) {
    const String fullTopic = topic(suffix);
    return client.subscribe(fullTopic.c_str());
  }
  return true;
}

bool ESPwayMqttService::connected() {
  return client.connected();
}

String ESPwayMqttService::baseTopic() const {
  if (config == nullptr || config->mqtt.baseTopic.isEmpty()) {
    return "espway/" + deviceId;
  }
  String result = config->mqtt.baseTopic;
  while (result.endsWith("/")) {
    result.remove(result.length() - 1);
  }
  return result;
}

String ESPwayMqttService::topic(const char* suffix) const {
  String result = baseTopic();
  if (suffix != nullptr && suffix[0] != '\0') {
    if (suffix[0] != '/') {
      result += '/';
    }
    result += suffix;
  }
  return result;
}

void ESPwayMqttService::configurationChanged() {
  disconnect();
  nextConnectAttempt = millis();
}

bool ESPwayMqttService::importLegacyConfiguration(
  const ESPwayMqttConfig& legacy
) {
  if (config == nullptr || store == nullptr || config->mqtt.enabled ||
      !config->mqtt.host.isEmpty() || !validConfiguration(legacy)) {
    return false;
  }
  config->mqtt = legacy;
  return store->save(*config);
}

void ESPwayMqttService::callback(
  char* receivedTopic,
  uint8_t* payload,
  unsigned int length
) {
  if (callbackOwner != nullptr) {
    callbackOwner->dispatch(receivedTopic, payload, length);
  }
}

void ESPwayMqttService::dispatch(
  const char* receivedTopic,
  const uint8_t* payload,
  size_t length
) {
  const String prefix = baseTopic() + "/";
  if (strncmp(receivedTopic, prefix.c_str(), prefix.length()) != 0) return;
  const char* relativeTopic = receivedTopic + prefix.length();
  for (uint8_t index = 0; index < subscriptionCount; ++index) {
    const Subscription& subscription = subscriptions[index];
    if (strcmp(subscription.suffix, relativeTopic) == 0) {
      if (subscription.handler != nullptr) {
        subscription.handler(
          subscription.context, relativeTopic, payload, length
        );
      } else {
        subscription.legacyHandler(subscription.context, payload, length);
      }
      return;
    }
  }
}

void ESPwayMqttService::connect() {
  client.setServer(config->mqtt.host.c_str(), config->mqtt.port);
  const String clientId = "espway-" + deviceId;
  const String availabilityTopic = topic("status");
  bool success;
  if (config->mqtt.username.isEmpty()) {
    success = client.connect(
      clientId.c_str(), availabilityTopic.c_str(), 0, true, "offline"
    );
  } else {
    success = client.connect(
      clientId.c_str(),
      config->mqtt.username.c_str(),
      config->mqtt.password.c_str(),
      availabilityTopic.c_str(),
      0,
      true,
      "offline"
    );
  }
  if (!success) {
    Serial.println("MQTT connection failed, state=" + String(client.state()));
    return;
  }
  Serial.println(F("MQTT connected"));
  client.publish(availabilityTopic.c_str(), "online", true);
  for (uint8_t index = 0; index < subscriptionCount; ++index) {
    const String fullTopic = topic(subscriptions[index].suffix);
    client.subscribe(fullTopic.c_str());
  }
  publishSystemTelemetry();
  nextTelemetryAt = millis() + TELEMETRY_INTERVAL_MS;
}

void ESPwayMqttService::disconnect() {
  if (client.connected()) {
    client.disconnect();
  }
}

void ESPwayMqttService::publishSystemTelemetry() {
  publish("system/uptime", static_cast<uint32_t>(millis() / 1000UL), true);
  publish("system/free_heap", ESPwayPlatform::freeHeap(), true);
  publish("system/wifi_rssi", static_cast<int32_t>(WiFi.RSSI()), true);
  const IPAddress ip = WiFi.localIP();
  char payload[16];
  snprintf(payload, sizeof(payload), "%u.%u.%u.%u",
           ip[0], ip[1], ip[2], ip[3]);
  publish("system/ip", payload, true);
}

bool ESPwayMqttService::validSuffix(const char* suffix) const {
  if (suffix == nullptr || suffix[0] == '\0' || suffix[0] == '/' ||
      strlen(suffix) > MAX_TOPIC_SUFFIX_LENGTH) {
    return false;
  }
  return strchr(suffix, '#') == nullptr && strchr(suffix, '+') == nullptr;
}

bool ESPwayMqttService::validConfiguration(
  const ESPwayMqttConfig& candidate
) const {
  return candidate.host.length() <= 128 && candidate.port != 0 &&
         candidate.username.length() <= 64 &&
         candidate.password.length() <= 64 &&
         candidate.baseTopic.length() <= 128 &&
         candidate.baseTopic.indexOf('#') < 0 &&
         candidate.baseTopic.indexOf('+') < 0;
}
