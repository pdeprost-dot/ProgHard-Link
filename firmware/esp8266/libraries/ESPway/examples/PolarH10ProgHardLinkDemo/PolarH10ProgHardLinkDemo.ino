#include <ESPway.h>
#include <PolarH10Client.h>
#include "PolarH10Web.h"

namespace {
constexpr bool BLE_DEBUG_LOGS = true;

PolarH10Client polar;
ESPwayTelemetry::SampleBlockBuilder ecgBuilder(0, 130);
ESPwayTelemetry::SampleBlockRing<16> ecgBlocks;
ESPwayMqttService* mqttService = nullptr;
bool mqttEcgEnabled = false;
uint32_t mqttEcgBlocksPublished = 0;
uint32_t mqttEcgPublishFailures = 0;
bool plotterMode = false;
uint32_t activeEcgSession = 0;
uint32_t bootHeap = 0;
uint32_t heapAfterBle = 0;
uint32_t minimumHeap = UINT32_MAX;
uint32_t lastHeapLogMs = 0;
bool initialHeapLogged = false;

void onEcg(const PolarH10Client::EcgSample& sample, void*) {
  const uint32_t session = polar.ecgSessionSequence();
  if (session != activeEcgSession) {
    ecgBuilder.startNewSession();
    activeEcgSession = session;
  }
  ESPwayTelemetry::SampleBlock completed;
  if (ecgBuilder.add(sample.microvolts, sample.sequence,
                     sample.polarTimestampNs, completed)) {
    ecgBlocks.push(completed);
    if (mqttEcgEnabled && mqttService != nullptr &&
        mqttService->connected()) {
      uint8_t serialized[
        ESPwayTelemetry::SAMPLE_BLOCK_HEADER_SIZE +
        ESPwayTelemetry::SAMPLE_BLOCK_MAX_SAMPLES * 4
      ];
      const size_t length = completed.serializedSize();
      if (completed.serialize(serialized, sizeof(serialized)) &&
          mqttService->publish(
            "polar/ecg/block", serialized, length, false
          )) {
        ++mqttEcgBlocksPublished;
      } else {
        ++mqttEcgPublishFailures;
      }
    }
  }
  if (plotterMode) Serial.println(sample.microvolts);
}

uint32_t fnv1a(const String& value) {
  uint32_t hash = 2166136261UL;
  for (size_t index = 0; index < value.length(); ++index) {
    hash ^= static_cast<uint8_t>(value[index]);
    hash *= 16777619UL;
  }
  return hash;
}

uint32_t queryUnsigned(const String& query, const char* name,
                       uint32_t fallback) {
  const String prefix = String(name) + "=";
  int start = 0;
  while (start <= static_cast<int>(query.length())) {
    int end = query.indexOf('&', start);
    if (end < 0) end = query.length();
    const String part = query.substring(start, end);
    if (part.startsWith(prefix)) {
      const String value = part.substring(prefix.length());
      if (value.isEmpty()) return fallback;
      for (size_t i = 0; i < value.length(); ++i)
        if (!isDigit(value[i])) return fallback;
      return static_cast<uint32_t>(strtoul(value.c_str(), nullptr, 10));
    }
    start = end + 1;
  }
  return fallback;
}

void put16(uint8_t* out, uint16_t value) {
  out[0] = value & 0xff; out[1] = value >> 8;
}

void put32(uint8_t* out, uint32_t value) {
  for (uint8_t index = 0; index < 4; ++index)
    out[index] = value >> (8 * index);
}

void appendBinary(String& destination, const uint8_t* data, size_t length) {
  destination.concat(reinterpret_cast<const char*>(data), length);
}

void ecgBlockResponse(const WebRequest& request, WebResponse& response) {
  constexpr uint16_t RESPONSE_MAGIC = 0xEC02;
  constexpr uint8_t RESPONSE_VERSION = 1;
  constexpr uint8_t RESPONSE_FLAG_GAP = 0x01;
  constexpr uint16_t RESPONSE_HEADER_SIZE = 24;
  constexpr size_t MAX_BLOCKS_PER_RESPONSE = 4;
  const uint32_t after = queryUnsigned(request.query, "after", 0);
  size_t maximum = queryUnsigned(request.query, "max", 4);
  if (maximum == 0) maximum = 1;
  if (maximum > MAX_BLOCKS_PER_RESPONSE) maximum = MAX_BLOCKS_PER_RESPONSE;

  ESPwayTelemetry::SampleBlock selected[MAX_BLOCKS_PER_RESPONSE];
  bool gap = false;
  uint32_t oldest = 0, newest = 0;
  size_t count = ecgBlocks.collectAfter(
    after, maximum, selected, gap, oldest, newest
  );
  if (!gap && count == 0 && oldest != 0 && after > newest) {
    bool ignoredGap = false;
    count = ecgBlocks.collectAfter(
      0, maximum, selected, ignoredGap, oldest, newest
    );
    gap = true;
  }

  uint8_t header[RESPONSE_HEADER_SIZE]{};
  put16(header, RESPONSE_MAGIC);
  header[2] = RESPONSE_VERSION;
  header[3] = gap ? RESPONSE_FLAG_GAP : 0;
  put16(header + 4, RESPONSE_HEADER_SIZE);
  put16(header + 6, count);
  put32(header + 8, oldest);
  put32(header + 12, newest);
  put32(header + 16, after);
  put32(header + 20, count ? selected[0].blockSequence : 0);

  response.contentType = "application/octet-stream";
  response.body = "";
  response.body.reserve(RESPONSE_HEADER_SIZE + count * 166);
  appendBinary(response.body, header, sizeof(header));
  uint8_t serialized[
    ESPwayTelemetry::SAMPLE_BLOCK_HEADER_SIZE +
    ESPwayTelemetry::SAMPLE_BLOCK_MAX_SAMPLES * 4
  ];
  for (size_t index = 0; index < count; ++index) {
    const uint16_t length = selected[index].serializedSize();
    uint8_t lengthBytes[2];
    put16(lengthBytes, length);
    appendBinary(response.body, lengthBytes, sizeof(lengthBytes));
    selected[index].serialize(serialized, sizeof(serialized));
    appendBinary(response.body, serialized, length);
  }
}

class PolarH10ESPwayApplication : public ESPwayApplication {
 public:
  const char* applicationId() const override { return "polar-h10-espway"; }
  const char* firmwareVersion() const override { return "0.1.0"; }

  const ESPwayNavigationItem* navigationItems(size_t& count) const override {
    static const ESPwayNavigationItem items[] = {{"Polar ECG", "/polar"}};
    count = 1;
    return items;
  }

  void begin(const ESPwayApplicationContext& context) override {
    mqtt_ = &context.mqtt;
    mqttService = mqtt_;
    mqtt_->subscribe("polar/ecg/mqtt_enabled/set", onMqttEcgEnabled, this);
    ecgBuilder.setSourceId(fnv1a(context.deviceId + ":polar-ecg"));
    Serial.println("ProgHard Link Polar application ready: " + context.deviceId);
    Serial.println(F("Send 'p' for Plotter mode, 'd' for diagnostic mode."));
    polar.setEcgCallback(onEcg);
    polar.setPlotterMode(false);
    polar.begin(BLE_DEBUG_LOGS);
    heapAfterBle = ESPwayPlatform::freeHeap();
    minimumHeap = heapAfterBle;
  }

  void loop() override {
    polar.loop();
    publishMqttState();
    const uint32_t freeHeap = ESPwayPlatform::freeHeap();
    if (freeHeap < minimumHeap) minimumHeap = freeHeap;
    if (!initialHeapLogged && millis() >= 8000) {
      initialHeapLogged = true;
      char heapLine[80];
      snprintf(heapLine, sizeof(heapLine),
               "Heap before ProgHard Link=%lu after BLE init=%lu",
               static_cast<unsigned long>(bootHeap),
               static_cast<unsigned long>(heapAfterBle));
      Serial.println(heapLine);
    }

    if (!plotterMode && millis() - lastHeapLogMs >= 30000) {
      lastHeapLogMs = millis();
      Serial.println(
        "Runtime heap=" + String(freeHeap) + " minimum=" +
        String(minimumHeap) + " largest=" +
        String(ESPwayPlatform::maxFreeBlock())
      );
    }

    if (!Serial.available()) return;
    const char command = static_cast<char>(Serial.read());
    if (command == 'p' || command == 'P') {
      plotterMode = true;
      polar.setPlotterMode(true);
    } else if (command == 'd' || command == 'D') {
      plotterMode = false;
      polar.setPlotterMode(false);
      Serial.println(F("Diagnostic mode ON"));
    }
  }

  bool handle(const WebRequest& request, WebResponse& response) override {
    if (request.path == "/polar") {
      response.contentType = "text/html; charset=utf-8";
      response.body = PolarH10Web::page();
      return true;
    }
    if (request.path == "/api/polar/ecg/blocks") {
      if (request.method != "GET") {
        response.status = 405;
        response.body = "{\"error\":\"method_not_allowed\"}";
      } else {
        ecgBlockResponse(request, response);
      }
      return true;
    }
    if (request.path != "/api/polar") return false;
    if (request.method != "GET") {
      response.status = 405;
      response.body = "{\"error\":\"method_not_allowed\"}";
      return true;
    }

    const bool available = polar.getAddress()[0] != '\0';
    const uint16_t heartRate = polar.getHeartRate();
    const uint16_t rr = polar.getLastRR();
    response.body.reserve(320);
    response.body = "{\"available\":" + boolean(available) +
      ",\"connected\":" + boolean(polar.isConnected()) +
      ",\"heartRate\":" + nullable(heartRate) + ",\"rrMs\":";
    response.body += rr ? "[" + String(rr) + "]" : "[]";
    response.body += ",\"ecgStreaming\":" + boolean(polar.isECGStreaming()) +
      ",\"ecgSampleRate\":" + String(polar.getSampleRate() ? polar.getSampleRate() : 130) +
      ",\"ecgSamplesReceived\":" + String(polar.ecgSamplesReceived()) +
      ",\"ecgDropped\":" + String(polar.droppedSamples()) +
      ",\"ecgBlocksProduced\":" + String(ecgBuilder.blocksProduced()) +
      ",\"ecgBlocksOverwritten\":" + String(ecgBlocks.overwritten()) +
      ",\"ecgIncompleteBlocksDiscarded\":" +
        String(ecgBuilder.incompleteBlocksDiscarded()) +
      ",\"mqttEcgEnabled\":" + boolean(mqttEcgEnabled) +
      ",\"mqttEcgBlocksPublished\":" + String(mqttEcgBlocksPublished) +
      ",\"mqttEcgPublishFailures\":" + String(mqttEcgPublishFailures) +
      ",\"address\":";
    response.body += available ? "\"" + String(polar.getAddress()) + "\"" : "null";
    response.body += "}";
    return true;
  }

 private:
  ESPwayMqttService* mqtt_ = nullptr;
  bool mqttWasConnected_ = false;
  String publishedPolarStatus_;
  bool publishedEcgStreaming_ = false;
  bool ecgStatusPublished_ = false;
  bool mqttEcgEnabledPublished_ = false;
  uint16_t publishedHeartRate_ = 0;
  uint32_t publishedRrSequence_ = 0;
  uint32_t lastHeartRatePublishMs_ = 0;

  void publishMqttState() {
    const bool mqttConnected = mqtt_ != nullptr && mqtt_->connected();
    if (!mqttConnected) {
      mqttWasConnected_ = false;
      return;
    }

    const char* polarStatus = polar.isConnected()
      ? "connected"
      : (polar.getAddress()[0] ? "disconnected" : "searching");
    if (!mqttWasConnected_ || publishedPolarStatus_ != polarStatus) {
      if (mqtt_->publish("polar/status", polarStatus, true)) {
        publishedPolarStatus_ = polarStatus;
      }
    }

    const bool ecgStreaming = polar.isECGStreaming();
    if (!mqttWasConnected_ || !ecgStatusPublished_ ||
        publishedEcgStreaming_ != ecgStreaming) {
      if (mqtt_->publish(
            "polar/ecg/status", ecgStreaming ? "streaming" : "stopped", true
          )) {
        publishedEcgStreaming_ = ecgStreaming;
        ecgStatusPublished_ = true;
      }
    }

    if (!mqttWasConnected_ || !mqttEcgEnabledPublished_) {
      mqttEcgEnabledPublished_ = mqtt_->publish(
        "polar/ecg/mqtt_enabled", mqttEcgEnabled ? "on" : "off", true
      );
    }

    const uint16_t heartRate = polar.getHeartRate();
    if (heartRate != 0 && (
          !mqttWasConnected_ || heartRate != publishedHeartRate_ ||
          millis() - lastHeartRatePublishMs_ >= 10000
        )) {
      char payload[8];
      snprintf(payload, sizeof(payload), "%u", heartRate);
      if (mqtt_->publish("polar/heart_rate", payload, true)) {
        publishedHeartRate_ = heartRate;
        lastHeartRatePublishMs_ = millis();
      }
    }

    const uint32_t rrSequence = polar.getRrSequence();
    if (rrSequence != publishedRrSequence_ && polar.getLastRR() != 0) {
      char payload[8];
      snprintf(payload, sizeof(payload), "%u", polar.getLastRR());
      if (mqtt_->publish("polar/rr", payload, false)) {
        publishedRrSequence_ = rrSequence;
      }
    }
    mqttWasConnected_ = true;
  }

  static void onMqttEcgEnabled(
    void* context,
    const char* relativeTopic,
    const uint8_t* payload,
    size_t length
  ) {
    if (strcmp(relativeTopic, "polar/ecg/mqtt_enabled/set") != 0) return;
    bool enabled;
    if ((length == 2 && memcmp(payload, "on", 2) == 0) ||
        (length == 1 && payload[0] == '1')) {
      enabled = true;
    } else if ((length == 3 && memcmp(payload, "off", 3) == 0) ||
               (length == 1 && payload[0] == '0')) {
      enabled = false;
    } else {
      return;
    }
    mqttEcgEnabled = enabled;
    PolarH10ESPwayApplication* self =
      static_cast<PolarH10ESPwayApplication*>(context);
    self->mqttEcgEnabledPublished_ = self->mqtt_->publish(
      "polar/ecg/mqtt_enabled", enabled ? "on" : "off", true
    );
  }

  static String boolean(bool value) { return value ? "true" : "false"; }
  static String nullable(uint16_t value) {
    return value ? String(value) : String("null");
  }
};

ESPwayFramework espway;
PolarH10ESPwayApplication application;
}

void setup() {
  Serial.begin(115200);
#if ARDUINO_USB_CDC_ON_BOOT
  Serial.setTxTimeoutMs(0);
#endif
  delay(500);
  bootHeap = ESPwayPlatform::freeHeap();
  espway.begin(application);
}

void loop() { espway.loop(); }
