#include <ESPway.h>

#include "ThermostatApp.h"

ESPwayFramework espway;
ThermostatApp application;

void setup() {
  Serial.begin(115200);
  delay(500);
  espway.begin(application);
}

void loop() {
  espway.loop();
}
