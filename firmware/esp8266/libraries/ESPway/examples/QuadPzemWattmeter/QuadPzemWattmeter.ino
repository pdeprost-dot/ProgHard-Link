#include <ESPway.h>

#include "QuadPzemApp.h"

ESPwayFramework espway;
QuadPzemApp application;

void setup() {
  Serial.begin(115200);
  delay(500);
  espway.begin(application);
}

void loop() {
  espway.loop();
}
