#pragma once

#include <Arduino_GFX_Library.h>

#include "ClockDisplay.h"

class WaveshareClockDisplay : public ClockDisplay {
 public:
  WaveshareClockDisplay();
  void begin() override;
  void show(const tm* localTime, bool valid, bool ntpMode, bool synced) override;

 private:
  Arduino_HWSPI bus;
  Arduino_ST7789 graphics;
  bool ready = false;
  String lastTime;
  String lastDate;
  String lastStatus;

  void initializeController();
};
