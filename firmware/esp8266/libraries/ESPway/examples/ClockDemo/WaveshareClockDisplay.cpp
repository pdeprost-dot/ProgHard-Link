#include "WaveshareClockDisplay.h"

namespace {

constexpr int LCD_DC = 15;
constexpr int LCD_CS = 14;
constexpr int LCD_SCK = 1;
constexpr int LCD_MOSI = 2;
constexpr int LCD_RST = 22;
constexpr int LCD_BACKLIGHT = 23;
constexpr uint8_t LANDSCAPE_ROTATION = 1;

constexpr uint16_t BACKGROUND = 0x0862;
constexpr uint16_t ACCENT = 0x2E9F;
constexpr uint16_t TEXT = RGB565_WHITE;
constexpr uint16_t MUTED = 0x9CF3;

}  // namespace

WaveshareClockDisplay::WaveshareClockDisplay()
  : bus(LCD_DC, LCD_CS, LCD_SCK, LCD_MOSI),
    graphics(&bus, LCD_RST, 0, false, 172, 320, 34, 0, 34, 0) {
}

void WaveshareClockDisplay::begin() {
  pinMode(LCD_BACKLIGHT, OUTPUT);
  digitalWrite(LCD_BACKLIGHT, LOW);
  ready = graphics.begin();
  if (!ready) {
    Serial.println(F("ClockDemo: LCD initialization failed"));
    return;
  }
  initializeController();
  graphics.setRotation(LANDSCAPE_ROTATION);
  graphics.fillScreen(BACKGROUND);
  graphics.setTextWrap(false);
  graphics.setTextColor(ACCENT, BACKGROUND);
  graphics.setTextSize(2);
  graphics.setCursor(12, 8);
  graphics.print(F("PROGHARD LINK CLOCK"));
  digitalWrite(LCD_BACKLIGHT, HIGH);
}

void WaveshareClockDisplay::show(
  const tm* localTime,
  bool valid,
  bool ntpMode,
  bool synced
) {
  if (!ready) return;

  char timeText[9] = "--:--:--";
  char dateText[11] = "--/--/----";
  if (valid && localTime != nullptr) {
    strftime(timeText, sizeof(timeText), "%H:%M:%S", localTime);
    strftime(dateText, sizeof(dateText), "%d/%m/%Y", localTime);
  }

  if (lastTime != timeText) {
    graphics.setTextColor(TEXT, BACKGROUND);
    graphics.setTextSize(6);
    graphics.setCursor(15, 43);
    graphics.print(timeText);
    lastTime = timeText;
  }

  if (lastDate != dateText) {
    graphics.setTextColor(MUTED, BACKGROUND);
    graphics.setTextSize(3);
    graphics.setCursor(67, 105);
    graphics.print(dateText);
    lastDate = dateText;
  }

  const char* status = ntpMode ? (synced ? "NTP SYNC" : "NTP WAIT") : "MANUAL";
  if (lastStatus != status) {
    const uint16_t statusColor = ntpMode && synced ? RGB565_GREEN : RGB565_YELLOW;
    graphics.fillRoundRect(110, 140, 100, 25, 6, statusColor);
    graphics.setTextColor(RGB565_BLACK, statusColor);
    graphics.setTextSize(2);
    graphics.setCursor(ntpMode ? 116 : 122, 145);
    graphics.print(status);
    lastStatus = status;
  }
}

void WaveshareClockDisplay::initializeController() {
  // Official Waveshare JD9853 initialization sequence for this exact board.
  static const uint8_t operations[] = {
    BEGIN_WRITE, WRITE_COMMAND_8, 0x11, END_WRITE, DELAY, 120,
    BEGIN_WRITE,
    WRITE_C8_D16, 0xDF, 0x98, 0x53,
    WRITE_C8_D8, 0xB2, 0x23,
    WRITE_COMMAND_8, 0xB7, WRITE_BYTES, 4, 0x00, 0x47, 0x00, 0x6F,
    WRITE_COMMAND_8, 0xBB, WRITE_BYTES, 6, 0x1C, 0x1A, 0x55, 0x73, 0x63, 0xF0,
    WRITE_C8_D16, 0xC0, 0x44, 0xA4,
    WRITE_C8_D8, 0xC1, 0x16,
    WRITE_COMMAND_8, 0xC3, WRITE_BYTES, 8, 0x7D, 0x07, 0x14, 0x06, 0xCF, 0x71, 0x72, 0x77,
    WRITE_COMMAND_8, 0xC4, WRITE_BYTES, 12, 0x00, 0x00, 0xA0, 0x79, 0x0B, 0x0A, 0x16, 0x79, 0x0B, 0x0A, 0x16, 0x82,
    WRITE_COMMAND_8, 0xC8, WRITE_BYTES, 32,
    0x3F, 0x32, 0x29, 0x29, 0x27, 0x2B, 0x27, 0x28, 0x28, 0x26, 0x25, 0x17, 0x12, 0x0D, 0x04, 0x00,
    0x3F, 0x32, 0x29, 0x29, 0x27, 0x2B, 0x27, 0x28, 0x28, 0x26, 0x25, 0x17, 0x12, 0x0D, 0x04, 0x00,
    WRITE_COMMAND_8, 0xD0, WRITE_BYTES, 5, 0x04, 0x06, 0x6B, 0x0F, 0x00,
    WRITE_C8_D16, 0xD7, 0x00, 0x30,
    WRITE_C8_D8, 0xE6, 0x14,
    WRITE_C8_D8, 0xDE, 0x01,
    WRITE_COMMAND_8, 0xB7, WRITE_BYTES, 5, 0x03, 0x13, 0xEF, 0x35, 0x35,
    WRITE_COMMAND_8, 0xC1, WRITE_BYTES, 3, 0x14, 0x15, 0xC0,
    WRITE_C8_D16, 0xC2, 0x06, 0x3A,
    WRITE_C8_D16, 0xC4, 0x72, 0x12,
    WRITE_C8_D8, 0xBE, 0x00,
    WRITE_C8_D8, 0xDE, 0x02,
    WRITE_COMMAND_8, 0xE5, WRITE_BYTES, 3, 0x00, 0x02, 0x00,
    WRITE_COMMAND_8, 0xE5, WRITE_BYTES, 3, 0x01, 0x02, 0x00,
    WRITE_C8_D8, 0xDE, 0x00,
    WRITE_C8_D8, 0x35, 0x00,
    WRITE_C8_D8, 0x3A, 0x05,
    WRITE_COMMAND_8, 0x2A, WRITE_BYTES, 4, 0x00, 0x22, 0x00, 0xCD,
    WRITE_COMMAND_8, 0x2B, WRITE_BYTES, 4, 0x00, 0x00, 0x01, 0x3F,
    WRITE_C8_D8, 0xDE, 0x02,
    WRITE_COMMAND_8, 0xE5, WRITE_BYTES, 3, 0x00, 0x02, 0x00,
    WRITE_C8_D8, 0xDE, 0x00,
    WRITE_C8_D8, 0x36, 0x00,
    WRITE_COMMAND_8, 0x21,
    END_WRITE, DELAY, 10,
    BEGIN_WRITE, WRITE_COMMAND_8, 0x29, END_WRITE,
  };
  bus.batchOperation(operations, sizeof(operations));
}
