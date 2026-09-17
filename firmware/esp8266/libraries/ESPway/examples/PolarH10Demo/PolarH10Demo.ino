#include "PolarH10Client.h"

// Set true for one raw ECG value per line, suitable for Arduino Serial Plotter.
constexpr bool START_IN_PLOTTER_MODE = false;
constexpr bool BLE_DEBUG_LOGS = true;

PolarH10Client polar;
bool plotterMode = START_IN_PLOTTER_MODE;
uint32_t diagnosticDivider = 0;
uint32_t lastStatusMs = 0;

void onEcg(const PolarH10Client::EcgSample& sample, void*) {
  if (plotterMode) {
    Serial.println(sample.microvolts);
  } else if ((diagnosticDivider++ % 13) == 0) {
    Serial.print(F("ECG="));
    Serial.print(sample.microvolts);
    Serial.print(F(" uV sample="));
    Serial.print(sample.sequence);
    Serial.print(F(" polar_ns="));
    Serial.println(static_cast<unsigned long long>(sample.polarTimestampNs));
  }
}

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println();
  Serial.println(F("=== ProgHard Link PolarH10Demo ==="));
  Serial.println(F("ESP32 detected"));
  Serial.println(F("Send 'p' for Plotter mode, 'd' for diagnostic mode."));
  polar.setEcgCallback(onEcg);
  polar.setPlotterMode(plotterMode);
  polar.begin(BLE_DEBUG_LOGS);
}

void loop() {
  polar.loop();
  if (!plotterMode && polar.isECGStreaming() &&
      millis() - lastStatusMs >= 10000) {
    lastStatusMs = millis();
    Serial.print(F("ECG buffer dropped="));
    Serial.println(polar.droppedSamples());
  }
  if (Serial.available()) {
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
  delay(1);
}
