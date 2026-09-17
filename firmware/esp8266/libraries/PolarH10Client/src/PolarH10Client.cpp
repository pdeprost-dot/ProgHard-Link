#include "PolarH10Client.h"

#include <cstring>
#include <NimBLERemoteDescriptor.h>

namespace {
const NimBLEUUID HR_SERVICE("180d");
const NimBLEUUID HR_MEASUREMENT("2a37");
const NimBLEUUID PMD_SERVICE("fb005c80-02e7-f387-1cad-8acd2d8df0c8");
const NimBLEUUID PMD_CONTROL("fb005c81-02e7-f387-1cad-8acd2d8df0c8");
const NimBLEUUID PMD_DATA("fb005c82-02e7-f387-1cad-8acd2d8df0c8");

// REQUEST_MEASUREMENT_START, ECG, sample rate 130 Hz, resolution 14 bits.
const uint8_t ECG_START[] = {
  0x02, 0x00, 0x00, 0x01, 0x82, 0x00, 0x01, 0x01, 0x0e, 0x00
};
const uint8_t ECG_SETTINGS[] = {0x01, 0x00};
}

PolarH10Client* PolarH10Client::instance_ = nullptr;

void PolarH10Client::begin(bool debug) {
  instance_ = this;
  debug_ = debug;
  NimBLEDevice::init("ESPway Polar H10");
  NimBLEDevice::setMTU(232);
  NimBLEDevice::setSecurityAuth(true, false, true);
  state_ = State::Scanning;
  nextActionMs_ = 0;
  if (debug_) Serial.println(F("BLE init OK"));
}

void PolarH10Client::loop() {
  EcgSample sample;
  while (dequeueEcg(sample)) {
    if (ecgCallback_) ecgCallback_(sample, ecgContext_);
  }

  if (client_ && state_ == State::Streaming && !client_->isConnected()) {
    disconnectAndRetry(F("Polar disconnected"));
  }
  if (static_cast<int32_t>(millis() - nextActionMs_) < 0) return;

  if (state_ == State::Backoff) state_ = State::Scanning;
  if (state_ == State::Scanning) {
    if (!findPolar()) {
      nextActionMs_ = millis() + 1500;
      return;
    }
    state_ = State::Connecting;
  }
  if (state_ == State::Connecting && !connectPolar()) {
    disconnectAndRetry(F("Connection/setup failed"));
  }
}

void PolarH10Client::setEcgCallback(EcgCallback callback, void* context) {
  ecgCallback_ = callback;
  ecgContext_ = context;
}

void PolarH10Client::setPlotterMode(bool enabled) { plotterMode_ = enabled; }

bool PolarH10Client::isConnected() const {
  return client_ && client_->isConnected();
}

bool PolarH10Client::isECGStreaming() const { return ecgStreaming_; }
uint16_t PolarH10Client::getHeartRate() const { return heartRate_; }
uint16_t PolarH10Client::getLastRR() const { return lastRrMs_; }
uint32_t PolarH10Client::getRrSequence() const { return rrSequence_; }
uint16_t PolarH10Client::getSampleRate() const { return sampleRate_; }
const char* PolarH10Client::getAddress() const { return address_; }
uint32_t PolarH10Client::ecgSamplesReceived() const { return sequence_; }
uint32_t PolarH10Client::droppedSamples() const { return dropped_; }
uint32_t PolarH10Client::ecgSessionSequence() const {
  return ecgSessionSequence_;
}

bool PolarH10Client::findPolar() {
  NimBLEScan* scan = NimBLEDevice::getScan();
  if (!scanStarted_) {
    if (debug_) Serial.println(F("Scanning for Polar H10..."));
    scan->setActiveScan(true);
    scan->setInterval(45);
    scan->setWindow(30);
    scanStarted_ = scan->start(5000, false, true);
    if (!scanStarted_) nextActionMs_ = millis() + 1500;
    return false;
  }
  if (scan->isScanning()) return false;

  scanStarted_ = false;
  NimBLEScanResults results = scan->getResults();
  for (int index = 0; index < results.getCount(); ++index) {
    const NimBLEAdvertisedDevice* device = results.getDevice(index);
    const std::string name = device->getName();
    if (name.rfind("Polar H10", 0) != 0) continue;
    delete targetAddress_;
    targetAddress_ = new NimBLEAddress(device->getAddress());
    snprintf(address_, sizeof(address_), "%s", targetAddress_->toString().c_str());
    if (debug_) {
      Serial.print(F("Polar H10 found: "));
      Serial.println(address_);
    }
    scan->clearResults();
    return true;
  }
  scan->clearResults();
  return false;
}

bool PolarH10Client::connectPolar() {
  if (!targetAddress_) return false;
  if (!client_) client_ = NimBLEDevice::createClient();
  if (debug_) Serial.println(F("Connecting..."));
  if (!client_->connect(*targetAddress_)) return false;
  if (debug_) Serial.println(F("Connected"));
  if (!client_->secureConnection()) {
    Serial.println(F("BLE encryption failed; trying unencrypted PMD"));
  } else if (debug_) {
    Serial.println(F("BLE encryption OK"));
  }
  if (debug_) {
    Serial.print(F("Negotiated MTU="));
    Serial.println(client_->getMTU());
  }
  if (!configureServices()) return false;
  state_ = State::Streaming;
  return true;
}

bool PolarH10Client::configureServices() {
  // Configure PMD before enabling HR notifications. Some H10/NimBLE
  // combinations can otherwise starve the following synchronous GATT query.
  NimBLERemoteService* pmdService = client_->getService(PMD_SERVICE);
  NimBLERemoteCharacteristic* control =
    pmdService ? pmdService->getCharacteristic(PMD_CONTROL) : nullptr;
  NimBLERemoteCharacteristic* data =
    pmdService ? pmdService->getCharacteristic(PMD_DATA) : nullptr;
  if (!control || !data) {
    Serial.println(F("PMD Service unavailable; continuing with HR"));
  } else {
    if (debug_) {
      Serial.print(F("PMD control properties: read="));
      Serial.print(control->canRead());
      Serial.print(F(" write="));
      Serial.print(control->canWrite());
      Serial.print(F(" indicate="));
      Serial.println(control->canIndicate());
      const NimBLEAttValue capabilities = control->readValue();
      Serial.print(F("PMD capabilities:"));
      for (size_t index = 0; index < capabilities.size(); ++index) {
        Serial.printf(" %02X", capabilities[index]);
      }
      Serial.println();
    }
    if (!control->subscribe(false, onPmdControl)) {
      Serial.println(F("PMD control indication subscription failed"));
    } else if (!data->subscribe(true, onPmdData)) {
      Serial.println(F("PMD data notification subscription failed"));
    } else {
      if (debug_) Serial.println(F("PMD Service OK"));
      if (debug_) {
        NimBLERemoteDescriptor* controlCccd = control->getDescriptor(NimBLEUUID("2902"));
        NimBLERemoteDescriptor* dataCccd = data->getDescriptor(NimBLEUUID("2902"));
        const NimBLEAttValue controlValue = controlCccd ? controlCccd->readValue() : NimBLEAttValue();
        const NimBLEAttValue dataValue = dataCccd ? dataCccd->readValue() : NimBLEAttValue();
        Serial.printf("PMD CCCD control=%02X data=%02X\n",
                      controlValue.size() ? controlValue[0] : 0xff,
                      dataValue.size() ? dataValue[0] : 0xff);
      }
      // Allow both CCCD writes to settle before issuing the control command.
      delay(500);
      if (control->writeValue(ECG_SETTINGS, sizeof(ECG_SETTINGS), true)) {
        Serial.println(F("ECG settings requested"));
        delay(1000);
      } else {
        Serial.println(F("ECG settings request failed"));
      }
      if (!control->writeValue(ECG_START, sizeof(ECG_START), false)) {
        Serial.println(F("ECG start command failed; continuing with HR"));
      } else if (debug_) {
        Serial.println(F("ECG start requested @ 130 Hz"));
      }
      delay(250);
    }
  }

  NimBLERemoteService* hrService = client_->getService(HR_SERVICE);
  NimBLERemoteCharacteristic* hr =
    hrService ? hrService->getCharacteristic(HR_MEASUREMENT) : nullptr;
  if (!hr || !hr->subscribe(true, onHeartRate, false)) {
    Serial.println(F("Heart Rate Service unavailable"));
    return false;
  }
  if (debug_) Serial.println(F("Heart Rate Service OK"));
  return true;
}

void PolarH10Client::disconnectAndRetry(const __FlashStringHelper* reason) {
  if (debug_) Serial.println(reason);
  if (client_ && client_->isConnected()) client_->disconnect();
  ecgStreaming_ = false;
  sampleRate_ = 0;
  state_ = State::Backoff;
  nextActionMs_ = millis() + 3000;
}

void PolarH10Client::onHeartRate(NimBLERemoteCharacteristic*, uint8_t* data,
                                 size_t length, bool) {
  if (instance_) instance_->parseHeartRate(data, length);
}

void PolarH10Client::onPmdControl(NimBLERemoteCharacteristic*, uint8_t* data,
                                  size_t length, bool) {
  if (instance_) instance_->parsePmdControl(data, length);
}

void PolarH10Client::onPmdData(NimBLERemoteCharacteristic*, uint8_t* data,
                               size_t length, bool) {
  if (instance_) instance_->parsePmdData(data, length);
}

void PolarH10Client::parseHeartRate(const uint8_t* data, size_t length) {
  if (!data || length < 2) return;
  const uint8_t flags = data[0];
  size_t offset = 1;
  if (flags & 0x01) {
    if (length < 3) return;
    heartRate_ = static_cast<uint16_t>(data[1] | (data[2] << 8));
    offset = 3;
  } else {
    heartRate_ = data[1];
    offset = 2;
  }
  if (flags & 0x08) offset += 2;  // Energy Expended.
  if (!plotterMode_) {
    Serial.print(F("HR="));
    Serial.print(heartRate_);
    Serial.println(F(" BPM"));
  }
  if (!(flags & 0x10)) return;
  while (offset + 1 < length) {
    const uint16_t rr1024 = data[offset] | (data[offset + 1] << 8);
    lastRrMs_ = static_cast<uint16_t>((static_cast<uint32_t>(rr1024) * 1000 + 512) / 1024);
    ++rrSequence_;
    if (!plotterMode_) {
      Serial.print(F("RR="));
      Serial.print(lastRrMs_);
      Serial.println(F(" ms"));
    }
    offset += 2;
  }
}

void PolarH10Client::parsePmdControl(const uint8_t* data, size_t length) {
  if (!data || length < 4 || data[0] != 0xf0) return;
  if (data[1] == 0x01 && data[2] == 0x00 && data[3] == 0x00) {
    Serial.println(F("ECG settings received"));
  } else if (data[1] == 0x02 && data[2] == 0x00 && data[3] == 0x00) {
    ecgStreaming_ = true;
    sampleRate_ = 130;
    ++ecgSessionSequence_;
    Serial.println(F("ECG stream started @ 130 Hz"));
  } else {
    Serial.print(F("PMD response error="));
    Serial.println(length > 3 ? data[3] : 0xff, HEX);
  }
}

void PolarH10Client::parsePmdData(const uint8_t* data, size_t length) {
  if (!data || length < 13 || data[0] != 0x00) return;
  uint64_t timestamp = 0;
  for (uint8_t index = 0; index < 8; ++index) {
    timestamp |= static_cast<uint64_t>(data[index + 1]) << (8 * index);
  }
  const uint8_t frameType = data[9];
  if (frameType != 0x00) {
    if (debug_) {
      Serial.print(F("Unsupported ECG PMD frame type 0x"));
      Serial.println(frameType, HEX);
    }
    return;
  }
  const size_t count = (length - 10) / 3;
  if (count == 0) return;
  const uint64_t periodNs = 1000000000ULL / 130;
  for (size_t index = 0; index < count; ++index) {
    EcgSample sample;
    sample.microvolts = signed24(data + 10 + index * 3);
    sample.sequence = sequence_++;
    sample.polarTimestampNs = timestamp - (count - 1 - index) * periodNs;
    enqueueEcg(sample);
  }
}

int32_t PolarH10Client::signed24(const uint8_t* bytes) {
  int32_t value = bytes[0] | (bytes[1] << 8) | (bytes[2] << 16);
  if (value & 0x00800000) value |= 0xff000000;
  return value;
}

void PolarH10Client::enqueueEcg(const EcgSample& sample) {
  portENTER_CRITICAL(&bufferMux_);
  const size_t next = (ecgHead_ + 1) % ECG_BUFFER_SIZE;
  if (next == ecgTail_) {
    ++dropped_;
  } else {
    ecgBuffer_[ecgHead_] = sample;
    ecgHead_ = next;
  }
  portEXIT_CRITICAL(&bufferMux_);
}

bool PolarH10Client::dequeueEcg(EcgSample& sample) {
  bool available = false;
  portENTER_CRITICAL(&bufferMux_);
  if (ecgTail_ != ecgHead_) {
    sample = ecgBuffer_[ecgTail_];
    ecgTail_ = (ecgTail_ + 1) % ECG_BUFFER_SIZE;
    available = true;
  }
  portEXIT_CRITICAL(&bufferMux_);
  return available;
}
