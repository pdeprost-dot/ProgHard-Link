#include "ESPwayWiFiManager.h"

#include "ESPwayPlatform.h"

void ESPwayWiFiManager::begin(
  ESPwayConfig& configuration,
  PersistentConfig& persistentStore,
  const String& deviceIdentifier
) {
  config = &configuration;
  store = &persistentStore;
  deviceId = deviceIdentifier;

  const uint8_t preferred = preferredProfile();
  if (preferred == 0) {
    startFallbackAp();
    scheduleRetryCycle();
    return;
  }
  WiFi.mode(WIFI_STA);
  attemptedMask = 0;
  startProfile(preferred, State::WaitingForConnection);
}

void ESPwayWiFiManager::loop() {
  const bool isConnected = WiFi.status() == WL_CONNECTED;

  if (currentState == State::TestScheduled) {
    if (millis() - stateStartedAt >= TEST_ACK_GRACE_MS) {
      rollbackProfileId = activeProfileId;
      attemptedMask = 0;
      startProfile(scheduledTestProfileId, State::TestingCandidate);
    }
    return;
  }

  if (isConnected) {
    const bool connectedToAttemptedProfile =
      validProfileId(attemptedProfileId) &&
      WiFi.SSID() == config->wifiProfiles[attemptedProfileId - 1].ssid;
    if (!connectedToAttemptedProfile) {
      return;
    }
    if (currentState != State::Connected) {
      markConnected();
    }
    if (
      !stableProfilePersisted &&
      millis() - connectedAt >= STABLE_CONNECTION_MS
    ) {
      stableProfilePersisted = true;
      if (config->lastKnownGoodWifiProfile != activeProfileId) {
        config->lastKnownGoodWifiProfile = activeProfileId;
        store->save(*config);
      }
      stopFallbackAp();
      Serial.println(
        "WiFi profile " + String(activeProfileId) + " stable"
      );
    }
    return;
  }

  if (currentState == State::Connected) {
    attemptedMask = 0;
    startProfile(activeProfileId, State::WaitingForConnection);
    return;
  }

  if (
    currentState == State::WaitingForConnection ||
    currentState == State::TestingCandidate ||
    currentState == State::RollingBack
  ) {
    if (millis() - stateStartedAt >= CONNECTION_TIMEOUT_MS) {
      handleConnectionFailure();
    }
    return;
  }

  if (
    currentState == State::RetryDelay &&
    millis() - stateStartedAt >= RETRY_BACKOFF_MS
  ) {
    attemptedMask = 0;
    const uint8_t preferred = preferredProfile();
    if (preferred != 0) {
      startProfile(preferred, State::WaitingForConnection);
    } else {
      stateStartedAt = millis();
    }
  }
}

bool ESPwayWiFiManager::saveProfile(
  uint8_t profileId,
  bool enabled,
  const String& ssid,
  const String& password,
  bool clear,
  String& error
) {
  if (!validProfileId(profileId)) {
    error = "invalid_profile";
    return false;
  }

  ESPwayWiFiProfile& profile = config->wifiProfiles[profileId - 1];
  const ESPwayWiFiProfile previousProfile = profile;
  const uint8_t previousLastKnownGood =
    config->lastKnownGoodWifiProfile;
  if (clear) {
    if (profileId == activeProfileId && alternateProfile(profileId) == 0) {
      error = "cannot_clear_only_active_profile";
      return false;
    }
    profile = ESPwayWiFiProfile{};
    if (config->lastKnownGoodWifiProfile == profileId) {
      config->lastKnownGoodWifiProfile =
        activeProfileId != profileId ? activeProfileId : 0;
    }
    if (!store->save(*config)) {
      profile = previousProfile;
      config->lastKnownGoodWifiProfile = previousLastKnownGood;
      error = "save_failed";
      return false;
    }
    return true;
  }

  if (!enabled && profileId == activeProfileId && alternateProfile(profileId) == 0) {
    error = "cannot_disable_only_active_profile";
    return false;
  }

  if (!validSsid(ssid) || !validPassword(password)) {
    error = "invalid_wifi_credentials";
    return false;
  }
  if (enabled && ssid.length() == 0) {
    error = "ssid_required";
    return false;
  }

  profile.enabled = enabled;
  profile.ssid = ssid;
  if (password.length() > 0) {
    profile.password = password;
  }
  if (!store->save(*config)) {
    profile = previousProfile;
    config->lastKnownGoodWifiProfile = previousLastKnownGood;
    error = "save_failed";
    return false;
  }
  return true;
}

bool ESPwayWiFiManager::scheduleTest(uint8_t profileId, String& error) {
  if (!usable(profileId)) {
    error = "profile_not_configured";
    return false;
  }
  if (testInProgress()) {
    error = "test_already_in_progress";
    return false;
  }
  scheduledTestProfileId = profileId;
  currentState = State::TestScheduled;
  stateStartedAt = millis();
  return true;
}

void ESPwayWiFiManager::clearProfiles() {
  config->wifiProfiles[0] = ESPwayWiFiProfile{};
  config->wifiProfiles[1] = ESPwayWiFiProfile{};
  config->lastKnownGoodWifiProfile = 0;
  store->save(*config);
}

uint8_t ESPwayWiFiManager::activeProfile() const {
  return connected() ? activeProfileId : 0;
}

uint8_t ESPwayWiFiManager::lastKnownGoodProfile() const {
  return config->lastKnownGoodWifiProfile;
}

bool ESPwayWiFiManager::apActive() const {
  return fallbackApActive;
}

bool ESPwayWiFiManager::testInProgress() const {
  return currentState == State::TestScheduled ||
         currentState == State::TestingCandidate ||
         currentState == State::RollingBack;
}

bool ESPwayWiFiManager::connected() const {
  return WiFi.status() == WL_CONNECTED;
}

bool ESPwayWiFiManager::isNetworkReady() const {
  return connected() &&
         currentState == State::Connected &&
         stableProfilePersisted &&
         !testInProgress();
}

ESPwayWiFiManager::State ESPwayWiFiManager::state() const {
  return currentState;
}

bool ESPwayWiFiManager::validProfileId(uint8_t profileId) {
  return profileId == 1 || profileId == 2;
}

bool ESPwayWiFiManager::validSsid(const String& ssid) {
  return ssid.length() <= 32;
}

bool ESPwayWiFiManager::validPassword(const String& password) {
  if (password.length() == 0) {
    return true;
  }
  if (password.length() >= 8 && password.length() <= 63) {
    return true;
  }
  if (password.length() != 64) {
    return false;
  }
  for (const char character : password) {
    if (!isHexadecimalDigit(character)) {
      return false;
    }
  }
  return true;
}

uint8_t ESPwayWiFiManager::preferredProfile() const {
  if (usable(config->lastKnownGoodWifiProfile)) {
    return config->lastKnownGoodWifiProfile;
  }
  if (usable(1)) {
    return 1;
  }
  return usable(2) ? 2 : 0;
}

uint8_t ESPwayWiFiManager::alternateProfile(uint8_t profileId) const {
  const uint8_t alternate = profileId == 1 ? 2 : 1;
  return usable(alternate) ? alternate : 0;
}

bool ESPwayWiFiManager::usable(uint8_t profileId) const {
  return validProfileId(profileId) &&
         config->wifiProfiles[profileId - 1].configured();
}

void ESPwayWiFiManager::startProfile(
  uint8_t profileId,
  State waitingState
) {
  if (!usable(profileId)) {
    startFallbackAp();
    scheduleRetryCycle();
    return;
  }
  const ESPwayWiFiProfile& profile = config->wifiProfiles[profileId - 1];
  WiFi.mode(fallbackApActive ? WIFI_AP_STA : WIFI_STA);
  WiFi.disconnect();
  WiFi.begin(profile.ssid.c_str(), profile.password.c_str());
  attemptedProfileId = profileId;
  attemptedMask |= 1U << (profileId - 1);
  currentState = waitingState;
  stateStartedAt = millis();
  stableProfilePersisted = false;
  Serial.println("Trying WiFi profile " + String(profileId));
}

void ESPwayWiFiManager::handleConnectionFailure() {
  if (
    currentState == State::TestingCandidate &&
    usable(rollbackProfileId)
  ) {
    startProfile(rollbackProfileId, State::RollingBack);
    return;
  }

  const uint8_t alternate = alternateProfile(attemptedProfileId);
  if (alternate != 0 && (attemptedMask & (1U << (alternate - 1))) == 0) {
    startProfile(alternate, State::WaitingForConnection);
    return;
  }

  startFallbackAp();
  scheduleRetryCycle();
}

void ESPwayWiFiManager::markConnected() {
  activeProfileId = attemptedProfileId;
  currentState = State::Connected;
  connectedAt = millis();
  stableProfilePersisted = false;
  Serial.println("Connected with WiFi profile " + String(activeProfileId));
}

void ESPwayWiFiManager::startFallbackAp() {
  if (fallbackApActive) {
    return;
  }
  WiFi.mode(WIFI_AP_STA);
  String suffix = deviceId.substring(4);
  suffix.toUpperCase();
  const String ssid = "ESPway-" + suffix;
  WiFi.softAP(ssid);
  fallbackApActive = true;
  Serial.println("WiFi fallback AP active");
  Serial.println("AP SSID: " + ssid);
  Serial.println("AP IP: " + WiFi.softAPIP().toString());
}

void ESPwayWiFiManager::stopFallbackAp() {
  if (!fallbackApActive) {
    return;
  }
  WiFi.softAPdisconnect(true);
  WiFi.mode(WIFI_STA);
  fallbackApActive = false;
  Serial.println("WiFi fallback AP stopped");
}

void ESPwayWiFiManager::scheduleRetryCycle() {
  currentState = State::RetryDelay;
  stateStartedAt = millis();
}
