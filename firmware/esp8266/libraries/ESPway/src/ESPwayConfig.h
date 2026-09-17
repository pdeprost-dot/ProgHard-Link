#pragma once
#include <Arduino.h>

constexpr uint16_t ESPWAY_CONFIG_VERSION = 5;
constexpr const char* ESPWAY_DEFAULT_DOMAIN = "link.proghard.com";
constexpr const char* ESPWAY_DEFAULT_INSTANCE_URL =
  "https://admin.link.proghard.com";

struct ESPwayWiFiProfile {
  bool enabled = false;
  String ssid;
  String password;

  bool configured() const {
    return enabled && ssid.length() > 0;
  }
};

struct ESPwayMqttConfig {
  bool enabled = false;
  String host;
  uint16_t port = 1883;
  String username;
  String password;
  String baseTopic;
};

struct ESPwayConfig {
  uint16_t configVersion = ESPWAY_CONFIG_VERSION;
  String deviceName = "ProgHard Link Device";
  ESPwayWiFiProfile wifiProfiles[2];
  uint8_t lastKnownGoodWifiProfile = 0;
  bool remoteEnabled = true;
  String instanceUrl = ESPWAY_DEFAULT_INSTANCE_URL;
  String remoteDomain = ESPWAY_DEFAULT_DOMAIN;
  uint16_t remotePort = 443;
  String deviceToken;
  ESPwayMqttConfig mqtt;
};

class PersistentConfig {
 public:
  bool begin();
  bool load(ESPwayConfig& config);
  bool save(const ESPwayConfig& config);
  void clear();
};
