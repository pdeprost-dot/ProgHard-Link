#include <ESPway.h>

#include "ClockDemoApp.h"
#include "WaveshareClockDisplay.h"

ESPwayFramework espway;
WaveshareClockDisplay display;
ClockDemoApp application(display);

void setup() {
  Serial.begin(115200);
  delay(500);
  espway.begin(application);
}

void loop() {
  espway.loop();
}
