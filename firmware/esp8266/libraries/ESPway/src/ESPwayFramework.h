#pragma once
#include <DNSServer.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include "ESPwayPlatform.h"
#include "ESPwayConfig.h"
#include "ESPwayApplication.h"
#include "ESPwayWiFiManager.h"
#include "ESPwayMqttService.h"
#include "ESPwayHmacSession.h"
#include "ESPwayAeadSession.h"
#include "ESPwayHttpOta.h"
#include "ESPwayOtaAuthorization.h"
#include "ESPwayStreamOta.h"
#include "ESPwayEnrollment.h"

#define ESPWAY_FRAMEWORK_VERSION "0.4.9"

class ESPwayFramework {
 public:
  void begin(ESPwayApplication& app);
  void loop();
  ESPwayMqttService& mqtt() { return mqttService; }

 private:
  static constexpr unsigned long TUNNEL_RETRY_MS = 5000;
  static constexpr unsigned long TUNNEL_ATTEMPT_TIMEOUT_MS = 20000;
  static constexpr unsigned long TRANSPORT_RELEASE_GRACE_MS = 500;
  static constexpr size_t DATA_CHUNK_SIZE = 768;

  struct RemoteStream {
    bool used = false;
    String id;
    String method;
    String path;
    String body;
    bool sensitive = false;
    bool ota = false;
    bool otaStarting = false;
    size_t otaSize = 0;
    String otaSha256;
    String otaProof;
  };

  enum class RemoteOtaState : uint8_t {
    Idle,
    Accepted,
    WaitingForTunnel,
    Downloading
  };

  ESPwayWebServer web{80};
  DNSServer dns;
  WebSocketsClient tunnel;
  PersistentConfig store;
  ESPwayWiFiManager wifiManager;
  ESPwayMqttService mqttService;
  ESPwayConfig config;
  ESPwayApplication* application = nullptr;
  RemoteStream streams[4];
  ESPwayHmacSession hmacSession;
  ESPwayHttpOtaCommand remoteHttpOtaCommand;
  ESPwayOtaAuthorization otaAuthorization;
  ESPwayStreamOta streamOta;
  uint8_t otaChunkBuffer[ESPwayStreamOta::DATA_CHUNK_SIZE]{};
  bool localOtaSucceeded = false;

  String deviceId;
  bool provisioning = false;
  bool applicationStarted = false;
  bool dnsActive = false;
  bool tunnelStarted = false;
  bool tunnelConnected = false;
  bool wifiWasConnected = false;
  bool wifiWasNetworkReady = false;
  unsigned long tunnelAttemptStartedAt = 0;
  unsigned long nextTunnelAttemptAt = 0;
  unsigned long restartAt = 0;
  unsigned long remoteOtaTunnelClosedAt = 0;
  bool remoteRequestActive = false;
  RemoteOtaState remoteOtaState = RemoteOtaState::Idle;
  uint32_t heapBeforeTunnel = 0;
  uint32_t maxBlockBeforeTunnel = 0;
  uint32_t fragmentationBeforeTunnel = 0;
  uint32_t heapAfterTunnel = 0;
  uint32_t maxBlockAfterTunnel = 0;
  uint32_t fragmentationAfterTunnel = 0;

  void registerRoutes();
  void saveConfigurationFromRequest();
  WebResponse updateWifiProfile(uint8_t profileId, const String& body);
  WebResponse testWifiProfile(uint8_t profileId);
  WebResponse updateMqttConfiguration(const String& body);
  WebResponse createEnrollment();
  void dispatchLocal();
  WebResponse route(const WebRequest& request);
  WebResponse scheduleRemoteOta(const String& body);
  void handleRemoteOta();
  void failRemoteOta(const String& reason);
  String statusJson() const;
  String wifiStatusJson() const;
  String mqttStatusJson();

  void logHeap(const String& label) const;

  void connectTunnel();
  void stopTunnel(const __FlashStringHelper* reason, bool scheduleRetry);
  void scheduleTunnelRetry();
  bool tunnelRetryDue() const;
  void onTunnel(WStype_t type, uint8_t* payload, size_t length);
  void sendHello();
  void sendAuthentication(
    const String& authProtocol,
    const String& serverNonce
  );
  void clearTunnelSession();
  void openRemoteStream(const JsonDocument& document, const String& streamId);
  void closeRemoteStream(RemoteStream& stream);
  void startPendingOtaStream();
  void failOtaStream(RemoteStream& stream, const char* error);
  void logOtaMetrics(const __FlashStringHelper* path) const;
  RemoteStream* findStream(const String& id);
  void sendFrame(String message);

  bool normalizeConfiguration();
  String remoteHostname() const;
  String tunnelHostname() const;
  String remoteUrl() const;

  String page() const;
  String navigation() const;
  String setupPage() const;
  String configPage() const;
  String otaPage() const;
  String diagnosticsPage() const;
  String jsonEscape(const String& value) const;
  String boolJson(bool value) const;
};
