#include <ESPway.h>

#include "ESPwayBaseApp.h"

ESPwayFramework espway;
ESPwayBaseApp application;

void setup() {
  Serial.begin(115200);
  delay(500);

  espway.begin(application);
}

void loop() {
  espway.loop();
}
