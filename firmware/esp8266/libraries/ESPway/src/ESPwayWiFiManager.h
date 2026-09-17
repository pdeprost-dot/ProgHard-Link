#pragma once

#include <Arduino.h>

#include "ESPwayConfig.h"

class ESPwayWiFiManager {
 public:
  enum class State : uint8_t {
    Idle,
    WaitingForConnection,
    Connected,
    RetryDelay,
    TestScheduled,
    TestingCandidate,
    RollingBack
  };

  void begin(
    ESPwayConfig& configuration,
    PersistentConfig& persistentStore,
    const String& deviceIdentifier
  );
  void loop();

  bool saveProfile(
    uint8_t profileId,
    bool enabled,
    const String& ssid,
    const String& password,
    bool clear,
    String& error
  );
  bool scheduleTest(uint8_t profileId, String& error);
  void clearProfiles();

  uint8_t activeProfile() const;
  uint8_t lastKnownGoodProfile() const;
  bool apActive() const;
  bool testInProgress() const;
  bool connected() const;
  bool isNetworkReady() const;
  State state() const;

  static bool validProfileId(uint8_t profileId);
  static bool validSsid(const String& ssid);
  static bool validPassword(const String& password);

 private:
  static constexpr unsigned long CONNECTION_TIMEOUT_MS = 18000;
  static constexpr unsigned long STABLE_CONNECTION_MS = 5000;
  static constexpr unsigned long RETRY_BACKOFF_MS = 60000;
  static constexpr unsigned long TEST_ACK_GRACE_MS = 750;

  ESPwayConfig* config = nullptr;
  PersistentConfig* store = nullptr;
  String deviceId;
  State currentState = State::Idle;
  uint8_t activeProfileId = 0;
  uint8_t attemptedProfileId = 0;
  uint8_t attemptedMask = 0;
  uint8_t rollbackProfileId = 0;
  uint8_t scheduledTestProfileId = 0;
  bool fallbackApActive = false;
  bool stableProfilePersisted = false;
  unsigned long stateStartedAt = 0;
  unsigned long connectedAt = 0;

  uint8_t preferredProfile() const;
  uint8_t alternateProfile(uint8_t profileId) const;
  bool usable(uint8_t profileId) const;
  void startProfile(uint8_t profileId, State waitingState);
  void handleConnectionFailure();
  void markConnected();
  void startFallbackAp();
  void stopFallbackAp();
  void scheduleRetryCycle();
};
