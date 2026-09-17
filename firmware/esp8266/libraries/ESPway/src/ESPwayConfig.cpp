#include "ESPwayConfig.h"

#include <ArduinoJson.h>
#include "ESPwayPlatform.h"

bool PersistentConfig::begin() {
  return ESPwayPlatform::beginFileSystem();
}

bool PersistentConfig::load(ESPwayConfig& config) {
  File file = LittleFS.open("/config.json", "r");
  if (!file) {
    return false;
  }

  JsonDocument document;
  const DeserializationError error = deserializeJson(document, file);
  file.close();
  if (error) {
    return false;
  }

  const uint16_t version = document["configVersion"] | 0;
  if (version < 1 || version > ESPWAY_CONFIG_VERSION) {
    return false;
  }

  config.configVersion = version;
  config.deviceName = document["deviceName"] | "ProgHard Link Device";
  if (version < 3) {
    config.wifiProfiles[0].ssid = document["wifiSsid"] | "";
    config.wifiProfiles[0].password = document["wifiPassword"] | "";
    config.wifiProfiles[0].enabled =
      config.wifiProfiles[0].ssid.length() > 0;
    config.wifiProfiles[1] = ESPwayWiFiProfile{};
    config.lastKnownGoodWifiProfile =
      config.wifiProfiles[0].configured() ? 1 : 0;
  } else {
    const JsonArrayConst profiles = document["wifiProfiles"].as<JsonArrayConst>();
    for (uint8_t index = 0; index < 2; ++index) {
      const JsonObjectConst profile = profiles[index];
      config.wifiProfiles[index].enabled = profile["enabled"] | false;
      config.wifiProfiles[index].ssid = profile["ssid"] | "";
      config.wifiProfiles[index].password = profile["password"] | "";
    }
    config.lastKnownGoodWifiProfile =
      document["lastKnownGoodWifiProfile"] | 0;
  }
  config.remoteEnabled = document["remoteEnabled"] | true;
  if (version >= 5) {
    config.instanceUrl = document["instanceUrl"] | ESPWAY_DEFAULT_INSTANCE_URL;
  }
  if (version == 1) {
    config.remoteDomain = document["remoteHost"] | ESPWAY_DEFAULT_DOMAIN;
  } else {
    config.remoteDomain = document["remoteDomain"] | ESPWAY_DEFAULT_DOMAIN;
  }
  config.remotePort = document["remotePort"] | 443;
  config.deviceToken = document["deviceToken"] | "";
  if (version >= 4) {
    const JsonObjectConst mqtt = document["mqtt"];
    config.mqtt.enabled = mqtt["enabled"] | false;
    config.mqtt.host = mqtt["host"] | "";
    config.mqtt.port = mqtt["port"] | 1883;
    config.mqtt.username = mqtt["username"] | "";
    config.mqtt.password = mqtt["password"] | "";
    config.mqtt.baseTopic = mqtt["baseTopic"] | "";
  }
  return true;
}

bool PersistentConfig::save(const ESPwayConfig& config) {
  JsonDocument document;
  document["configVersion"] = ESPWAY_CONFIG_VERSION;
  document["deviceName"] = config.deviceName;
  JsonArray profiles = document["wifiProfiles"].to<JsonArray>();
  for (const ESPwayWiFiProfile& profile : config.wifiProfiles) {
    JsonObject item = profiles.add<JsonObject>();
    item["enabled"] = profile.enabled;
    item["ssid"] = profile.ssid;
    item["password"] = profile.password;
  }
  document["lastKnownGoodWifiProfile"] =
    config.lastKnownGoodWifiProfile;
  document["remoteEnabled"] = config.remoteEnabled;
  document["instanceUrl"] = config.instanceUrl;
  document["remoteDomain"] = config.remoteDomain;
  document["remotePort"] = config.remotePort;
  document["deviceToken"] = config.deviceToken;
  JsonObject mqtt = document["mqtt"].to<JsonObject>();
  mqtt["enabled"] = config.mqtt.enabled;
  mqtt["host"] = config.mqtt.host;
  mqtt["port"] = config.mqtt.port;
  mqtt["username"] = config.mqtt.username;
  mqtt["password"] = config.mqtt.password;
  mqtt["baseTopic"] = config.mqtt.baseTopic;

  File file = LittleFS.open("/config.tmp", "w");
  if (!file) {
    return false;
  }

  if (serializeJson(document, file) == 0) {
    file.close();
    LittleFS.remove("/config.tmp");
    return false;
  }
  file.close();

  LittleFS.remove("/config.json");
  return LittleFS.rename("/config.tmp", "/config.json");
}

void PersistentConfig::clear() {
  LittleFS.remove("/config.json");
}
