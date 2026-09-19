#include <ESPway.h>
#include <Wire.h>
#include <ESP_I2S.h>
#include <Audio.h>
#include <math.h>
#include "es8311.h"

namespace {
constexpr char kStream[] = "https://stream.rcs.revma.com/5gd04cwptg0uv";
constexpr uint8_t kExpander = 0x20;
constexpr uint8_t kKeyPower = 10;
constexpr uint8_t kKeyUp = 9;
constexpr uint8_t kKeyDown = 11;
Audio audio(false, 3, I2S_NUM_0);
es8311_handle_t codec = nullptr;
bool audioReady = false;
volatile bool playing = false;
volatile bool wantPlay = true;
volatile uint8_t volume = 7;
uint16_t priorKeys = 0xffff;
uint32_t lastKeyPoll = 0;
uint32_t lastConnectAttempt = 0;

bool expanderWrite(uint8_t reg, uint8_t lo, uint8_t hi) {
  Wire.beginTransmission(kExpander);
  Wire.write(reg);
  Wire.write(lo);
  Wire.write(hi);
  return Wire.endTransmission() == 0;
}

uint16_t expanderRead() {
  Wire.beginTransmission(kExpander);
  Wire.write(0x00);
  if (Wire.endTransmission(false) != 0 || Wire.requestFrom(kExpander, uint8_t(2)) != 2) return 0xffff;
  uint8_t lo = Wire.read();
  return lo | (uint16_t(Wire.read()) << 8);
}

bool initHardware() {
  Wire.begin(11, 10);
  Wire.setClock(400000);
  // Keep EXIO9/10/11 as inputs and EXIO8 as the amplifier output.
  if (!expanderWrite(0x06, 0xff, 0xfe) || !expanderWrite(0x02, 0x00, 0x01)) return false;
  codec = es8311_create(I2C_NUM_0, ES8311_ADDRRES_0);
  if (!codec) return false;
  const es8311_clock_config_t clocks = {false, false, true, 16000 * 256, 16000};
  if (es8311_init(codec, &clocks, ES8311_RESOLUTION_16, ES8311_RESOLUTION_16) != ESP_OK) return false;
  if (es8311_microphone_config(codec, false) != ESP_OK) return false;
  if (es8311_voice_volume_set(codec, 75, nullptr) != ESP_OK) return false;
  return true;
}

void testTone() {
  I2SClass tone;
  tone.setPins(13, 14, 16, -1, 12);
  if (!tone.begin(I2S_MODE_STD, 16000, I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_STEREO, I2S_STD_SLOT_BOTH)) {
    Serial.println("I2S tone init failed");
    return;
  }
  // Two 440 Hz notes, 800 ms each, with smooth edges and a 200 ms gap.
  constexpr int kRate = 16000;
  constexpr int kNote = 12800;
  constexpr int kGap = 3200;
  int16_t frames[128 * 2];
  size_t written = 0;
  for (int base = 0; base < 2 * kNote + kGap; base += 128) {
    for (int i = 0; i < 128; ++i) {
      const int n = base + i;
      const int within = n < kNote ? n : n >= kNote + kGap ? n - kNote - kGap : -1;
      int16_t sample = 0;
      if (within >= 0 && within < kNote) {
        const int edge = min(min(within, kNote - 1 - within), 320);
        const float gain = float(edge) / 320.0f;
        sample = int16_t(5500.0f * gain * sinf(2.0f * PI * 440.0f * within / kRate));
      }
      frames[2 * i] = sample;
      frames[2 * i + 1] = sample;
    }
    written += tone.write(reinterpret_cast<uint8_t*>(frames), sizeof(frames));
  }
  delay(200);
  tone.end();
  Serial.printf("Tone complete: %u I2S bytes\n", unsigned(written));
}

void commandPower() {
  wantPlay = !wantPlay;
}

void commandVolume(int delta) {
  int next = int(volume) + delta;
  volume = uint8_t(constrain(next, 0, 21));
}

void pollKeys() {
  if (millis() - lastKeyPoll < 40) return;
  lastKeyPoll = millis();
  uint16_t keys = expanderRead();
  uint16_t pressed = priorKeys & ~keys;
  priorKeys = keys;
  if (pressed & (1u << kKeyPower)) commandPower();
  if (pressed & (1u << kKeyUp)) commandVolume(1);
  if (pressed & (1u << kKeyDown)) commandVolume(-1);
}

void audioTask(void*) {
  bool active = false;
  uint8_t appliedVolume = volume;
  for (;;) {
    if (volume != appliedVolume) {
      appliedVolume = volume;
      audio.setVolume(appliedVolume);
    }
    if (!wantPlay && active) {
      audio.stopSong();
      active = false;
      playing = false;
    }
    if (wantPlay && WiFi.status() == WL_CONNECTED && !active &&
        (lastConnectAttempt == 0 || millis() - lastConnectAttempt >= 5000)) {
      lastConnectAttempt = millis();
      active = audio.connecttohost(kStream);
      playing = active;
      Serial.println(active ? "Stream connected" : "Stream connection failed");
    }
    if (active) audio.loop();
    vTaskDelay(pdMS_TO_TICKS(1));
  }
}

class RadioApp : public ESPwayApplication {
 public:
  const char* applicationId() const override { return "nostalgie-belgique"; }
  const char* firmwareVersion() const override { return "0.1.0"; }
  void begin(const ESPwayApplicationContext& context) override {
    Serial.println("Radio ready: " + context.deviceId);
  }
  void loop() override {
    if (!audioReady) return;
    pollKeys();
  }
  bool handle(const WebRequest& request, WebResponse& response) override {
    if (request.path == "/radio" && request.method == "GET") {
      response.contentType = "text/html; charset=utf-8";
      response.body = "<!doctype html><html lang='fr'><meta charset='utf-8'>"
        "<meta name='viewport' content='width=device-width,initial-scale=1'>"
        "<title>Nostalgie Belgique</title>"
        "<style>body{font:20px sans-serif;max-width:480px;margin:2em auto;text-align:center}"
        "button{font-size:24px;padding:20px;margin:10px;min-width:130px}</style>"
        "<p><a href='/'>ProgHard Link</a></p><h1>Nostalgie Belgique</h1><p>";
      response.body += playing ? "Playing" : "Stopped";
      response.body += " · Volume " + String(volume) + "</p>"
        "<form method=post action=/radio/power><button>ON / OFF</button></form>"
        "<form method=post action=/radio/up><button>VOL +</button></form>"
        "<form method=post action=/radio/down><button>VOL -</button></form></html>";
      return true;
    }
    if (request.path == "/radio/power" || request.path == "/radio/up" || request.path == "/radio/down") {
      if (request.method != "POST") { response.status = 405; response.body = "Method Not Allowed"; return true; }
      if (request.path == "/radio/power") commandPower();
      else if (request.path == "/radio/up") commandVolume(1);
      else commandVolume(-1);
      response.status = 303;
      response.contentType = "text/html";
      response.body = "<meta http-equiv=refresh content='0;url=/radio'>";
      return true;
    }
    return false;
  }
  const ESPwayNavigationItem* navigationItems(size_t& count) const override {
    static const ESPwayNavigationItem items[] = {{"Radio", "/radio"}};
    count = 1;
    return items;
  }
};
ESPwayFramework espway;
RadioApp app;
}

void setup() {
  Serial.begin(115200);
  delay(500);
  audioReady = initHardware();
  if (audioReady) {
    testTone();
    audioReady = audio.setPinout(13, 14, 16, 12);
    audio.setVolume(volume);
  }
  Serial.println(audioReady ? "Audio ready" : "Audio hardware failed");
  espway.begin(app);
  if (audioReady) xTaskCreatePinnedToCore(audioTask, "radio", 16384, nullptr, 2, nullptr, 0);
}

void loop() { espway.loop(); }
