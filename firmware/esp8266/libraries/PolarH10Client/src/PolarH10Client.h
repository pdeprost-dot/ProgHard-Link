#pragma once

#if !defined(ESP32)
#error "PolarH10Client requires an ESP32 with Bluetooth LE support"
#endif

#include <Arduino.h>
#include <NimBLEDevice.h>

class PolarH10Client {
 public:
  struct EcgSample {
    int32_t microvolts;
    uint32_t sequence;
    uint64_t polarTimestampNs;
  };

  using EcgCallback = void (*)(const EcgSample& sample, void* context);

  void begin(bool debug = true);
  void loop();
  void setEcgCallback(EcgCallback callback, void* context = nullptr);
  void setPlotterMode(bool enabled);

  bool isConnected() const;
  bool isECGStreaming() const;
  uint16_t getHeartRate() const;
  uint16_t getLastRR() const;
  uint32_t getRrSequence() const;
  uint16_t getSampleRate() const;
  const char* getAddress() const;
  uint32_t ecgSamplesReceived() const;
  uint32_t droppedSamples() const;
  uint32_t ecgSessionSequence() const;

 private:
  enum class State : uint8_t { Scanning, Connecting, Streaming, Backoff };
  static constexpr size_t ECG_BUFFER_SIZE = 512;

  static void onHeartRate(NimBLERemoteCharacteristic*, uint8_t*, size_t, bool);
  static void onPmdControl(NimBLERemoteCharacteristic*, uint8_t*, size_t, bool);
  static void onPmdData(NimBLERemoteCharacteristic*, uint8_t*, size_t, bool);
  static int32_t signed24(const uint8_t* bytes);

  bool findPolar();
  bool connectPolar();
  bool configureServices();
  void disconnectAndRetry(const __FlashStringHelper* reason);
  void parseHeartRate(const uint8_t* data, size_t length);
  void parsePmdControl(const uint8_t* data, size_t length);
  void parsePmdData(const uint8_t* data, size_t length);
  void enqueueEcg(const EcgSample& sample);
  bool dequeueEcg(EcgSample& sample);

  static PolarH10Client* instance_;
  NimBLEClient* client_ = nullptr;
  NimBLEAddress* targetAddress_ = nullptr;
  State state_ = State::Scanning;
  uint32_t nextActionMs_ = 0;
  uint16_t heartRate_ = 0;
  uint16_t lastRrMs_ = 0;
  uint32_t rrSequence_ = 0;
  uint16_t sampleRate_ = 0;
  bool ecgStreaming_ = false;
  bool debug_ = true;
  bool plotterMode_ = false;
  bool scanStarted_ = false;
  char address_[24] = "";
  EcgCallback ecgCallback_ = nullptr;
  void* ecgContext_ = nullptr;
  EcgSample ecgBuffer_[ECG_BUFFER_SIZE] = {};
  volatile size_t ecgHead_ = 0;
  volatile size_t ecgTail_ = 0;
  volatile uint32_t dropped_ = 0;
  uint32_t sequence_ = 0;
  uint32_t ecgSessionSequence_ = 0;
  portMUX_TYPE bufferMux_ = portMUX_INITIALIZER_UNLOCKED;
};
