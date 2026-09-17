#pragma once

#include <Arduino.h>
#include <time.h>

class ClockDisplay {
 public:
  virtual ~ClockDisplay() = default;
  virtual void begin() = 0;
  virtual void show(const tm* localTime, bool valid, bool ntpMode, bool synced) = 0;
};
