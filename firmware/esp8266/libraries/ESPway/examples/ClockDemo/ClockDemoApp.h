#pragma once

#include <ESPway.h>
#include <Preferences.h>

#include "ClockDisplay.h"

class ClockDemoApp : public ESPwayApplication {
 public:
  explicit ClockDemoApp(ClockDisplay& display);

  const char* applicationId() const override;
  const char* firmwareVersion() const override;
  void begin(const ESPwayApplicationContext& context) override;
  void loop() override;
  bool handle(const WebRequest& request, WebResponse& response) override;
  const ESPwayNavigationItem* navigationItems(size_t& count) const override;

 private:
  static constexpr const char* DEFAULT_NTP_SERVER = "pool.ntp.org";
  static constexpr const char* DEFAULT_TIMEZONE =
    "CET-1CEST,M3.5.0/2,M10.5.0/3";

  ClockDisplay& display;
  Preferences preferences;
  bool ntpMode = true;
  bool ntpSynced = false;
  String ntpServer = DEFAULT_NTP_SERVER;
  String timezone = DEFAULT_TIMEZONE;
  uint32_t lastDisplayUpdate = 0;

  void loadConfiguration();
  void saveConfiguration();
  void startNtp();
  bool applyManualTime(const String& date, const String& clockTime);
  bool applyForm(const String& body, String& message);
  String page(const String& message = "") const;
  static String formValue(const String& body, const String& key);
  static String urlDecode(const String& value);
  static String htmlEscape(const String& value);
  static bool currentLocalTime(tm& value);
};
