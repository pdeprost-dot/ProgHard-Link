#include <ESPway.h>
#include "LedDemo.h"

ESPwayFramework espway;
LedDemo application;

void setup() {
  Serial.begin(115200);
  delay(500);

  espway.begin(application);
}

void loop() {
  espway.loop();
}
