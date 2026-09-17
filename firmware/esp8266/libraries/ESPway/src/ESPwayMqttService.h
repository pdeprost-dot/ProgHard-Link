#pragma once

#include <Arduino.h>
#include "ESPwayPlatform.h"
#include <PubSubClient.h>

#include "ESPwayConfig.h"

class ESPwayMqttService {
 public:
  using MessageHandler = void (*)(
    void* context,
    const char* relativeTopic,
    const uint8_t* payload,
    size_t length
  );
  using LegacyMessageHandler = void (*)(
    void* context,
    const uint8_t* payload,
    size_t length
  );

  static constexpr size_t MAX_PAYLOAD_SIZE = 512;
  static constexpr size_t MAX_TOPIC_SUFFIX_LENGTH = 96;

  ESPwayMqttService();

  void begin(
    ESPwayConfig& configuration,
    PersistentConfig& persistentStore,
    const String& deviceIdentifier
  );
  void loop(bool networkReady);
  bool publish(const char* suffix, const char* payload, bool retained = false);
  bool publish(const char* suffix, const uint8_t* payload, size_t length,
               bool retained = false);
  bool publish(const char* suffix, int32_t value, bool retained = false);
  bool publish(const char* suffix, uint32_t value, bool retained = false);
  bool publish(const char* suffix, float value, uint8_t decimals = 2,
               bool retained = false);
  bool publish(const char* suffix, bool value, bool retained = false);
  bool subscribe(const char* suffix, MessageHandler handler, void* context);
  bool subscribe(const char* suffix, LegacyMessageHandler handler,
                 void* context);
  bool connected();
  String baseTopic() const;
  String topic(const char* suffix) const;
  void configurationChanged();
  bool importLegacyConfiguration(const ESPwayMqttConfig& legacy);

 private:
  static constexpr uint8_t MAX_SUBSCRIPTIONS = 4;
  // 512-byte payload + maximum base/suffix topic + MQTT framing.
  static constexpr uint16_t BUFFER_SIZE = 768;
  static constexpr uint16_t SOCKET_TIMEOUT_SECONDS = 2;
  static constexpr uint16_t CONNECTION_TIMEOUT_MS = 500;
  static constexpr uint32_t RETRY_MS = 5000;
  static constexpr uint32_t TELEMETRY_INTERVAL_MS = 60000;

  struct Subscription {
    char suffix[MAX_TOPIC_SUFFIX_LENGTH + 1]{};
    MessageHandler handler = nullptr;
    LegacyMessageHandler legacyHandler = nullptr;
    void* context = nullptr;
  };

  WiFiClient networkClient;
  PubSubClient client;
  ESPwayConfig* config = nullptr;
  PersistentConfig* store = nullptr;
  String deviceId;
  Subscription subscriptions[MAX_SUBSCRIPTIONS];
  uint8_t subscriptionCount = 0;
  uint32_t nextConnectAttempt = 0;
  bool networkWasReady = false;
  uint32_t nextTelemetryAt = 0;

  static ESPwayMqttService* callbackOwner;
  static void callback(char* topic, uint8_t* payload, unsigned int length);
  void dispatch(const char* receivedTopic, const uint8_t* payload, size_t length);
  void connect();
  void disconnect();
  void publishSystemTelemetry();
  bool validSuffix(const char* suffix) const;
  bool validConfiguration(const ESPwayMqttConfig& candidate) const;
};
