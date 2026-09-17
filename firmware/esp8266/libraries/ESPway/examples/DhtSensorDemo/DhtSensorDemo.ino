#include <ESPway.h>

#include "DhtSensorApp.h"

ESPwayFramework espway;
DhtSensorApp application;

void setup() {
  Serial.begin(115200);
  delay(500);
  espway.begin(application);
}

void loop() {
  espway.loop();
}
