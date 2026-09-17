#include "ClockDemoApp.h"

#include <sys/time.h>

namespace {

constexpr char APPLICATION_ID[] = "clock-demo";
constexpr char FIRMWARE_VERSION[] = "1.0.0";
constexpr time_t VALID_TIME = 1704067200;  // 2024-01-01 UTC

}  // namespace

ClockDemoApp::ClockDemoApp(ClockDisplay& targetDisplay) : display(targetDisplay) {
}

const char* ClockDemoApp::applicationId() const {
  return APPLICATION_ID;
}

const char* ClockDemoApp::firmwareVersion() const {
  return FIRMWARE_VERSION;
}

void ClockDemoApp::begin(const ESPwayApplicationContext&) {
  loadConfiguration();
  setenv("TZ", timezone.c_str(), 1);
  tzset();
  display.begin();
  if (ntpMode) startNtp();
}

void ClockDemoApp::loop() {
  const uint32_t nowMillis = millis();
  if (nowMillis - lastDisplayUpdate < 1000) return;
  lastDisplayUpdate = nowMillis;

  tm local {};
  const bool valid = currentLocalTime(local);
  if (ntpMode && valid) ntpSynced = true;
  display.show(valid ? &local : nullptr, valid, ntpMode, ntpSynced);
}

bool ClockDemoApp::handle(const WebRequest& request, WebResponse& response) {
  if (request.path != "/clock") return false;

  String message;
  if (request.method == "POST") {
    const String& form = request.body.isEmpty() ? request.query : request.body;
    if (!applyForm(form, message)) response.status = 400;
  } else if (request.method != "GET") {
    response.status = 405;
    response.body = "Method not allowed";
    response.contentType = "text/plain; charset=utf-8";
    return true;
  }

  response.contentType = "text/html; charset=utf-8";
  response.body = page(message);
  return true;
}

const ESPwayNavigationItem* ClockDemoApp::navigationItems(size_t& count) const {
  static const ESPwayNavigationItem items[] = {{"Clock demo", "/clock"}};
  count = 1;
  return items;
}

void ClockDemoApp::loadConfiguration() {
  if (!preferences.begin("clock-demo", true)) return;
  ntpMode = preferences.getBool("ntp", true);
  ntpServer = preferences.getString("server", DEFAULT_NTP_SERVER);
  timezone = preferences.getString("tz", DEFAULT_TIMEZONE);
  preferences.end();
}

void ClockDemoApp::saveConfiguration() {
  if (!preferences.begin("clock-demo", false)) return;
  preferences.putBool("ntp", ntpMode);
  preferences.putString("server", ntpServer);
  preferences.putString("tz", timezone);
  preferences.end();
}

void ClockDemoApp::startNtp() {
  ntpSynced = false;
  configTzTime(timezone.c_str(), ntpServer.c_str());
}

bool ClockDemoApp::applyManualTime(const String& date, const String& clockTime) {
  int year, month, day, hour, minute, second = 0;
  if (
    sscanf(date.c_str(), "%d-%d-%d", &year, &month, &day) != 3 ||
    (sscanf(clockTime.c_str(), "%d:%d:%d", &hour, &minute, &second) < 2) ||
    year < 2024 || month < 1 || month > 12 || day < 1 || day > 31 ||
    hour < 0 || hour > 23 || minute < 0 || minute > 59 ||
    second < 0 || second > 59
  ) {
    return false;
  }

  tm local {};
  local.tm_year = year - 1900;
  local.tm_mon = month - 1;
  local.tm_mday = day;
  local.tm_hour = hour;
  local.tm_min = minute;
  local.tm_sec = second;
  local.tm_isdst = -1;
  const time_t epoch = mktime(&local);
  if (epoch < VALID_TIME) return false;

  const timeval value {epoch, 0};
  settimeofday(&value, nullptr);
  return true;
}

bool ClockDemoApp::applyForm(const String& body, String& message) {
  const String action = formValue(body, "action");
  if (action == "ntp") {
    const String candidateServer = formValue(body, "server");
    const String candidateTimezone = formValue(body, "timezone");
    if (
      candidateServer.isEmpty() || candidateServer.length() > 96 ||
      candidateTimezone.isEmpty() || candidateTimezone.length() > 128
    ) {
      message = "Invalid NTP server or timezone.";
      return false;
    }
    ntpServer = candidateServer;
    timezone = candidateTimezone;
    ntpMode = true;
    setenv("TZ", timezone.c_str(), 1);
    tzset();
    saveConfiguration();
    startNtp();
    message = "NTP synchronization requested.";
    return true;
  }

  if (action == "manual") {
    setenv("TZ", timezone.c_str(), 1);
    tzset();
    if (!applyManualTime(formValue(body, "date"), formValue(body, "time"))) {
      message = "Invalid manual date or time.";
      return false;
    }
    ntpMode = false;
    ntpSynced = false;
    saveConfiguration();
    message = "Manual time applied.";
    return true;
  }

  message = "Unknown action.";
  return false;
}

String ClockDemoApp::page(const String& message) const {
  tm local {};
  const bool valid = currentLocalTime(local);
  char current[32] = "Not set";
  char dateValue[11] = "";
  char timeValue[9] = "";
  if (valid) {
    strftime(current, sizeof(current), "%d/%m/%Y %H:%M:%S", &local);
    strftime(dateValue, sizeof(dateValue), "%Y-%m-%d", &local);
    strftime(timeValue, sizeof(timeValue), "%H:%M:%S", &local);
  }

  String html;
  html.reserve(4800);
  html += R"HTML(<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ProgHard Link Clock Demo</title><style>
body{margin:0;background:#eef3f9;color:#152033;font:16px system-ui,sans-serif}
main{max-width:680px;margin:32px auto;padding:26px;background:#fff;border-radius:18px;box-shadow:0 10px 32px #13233a1a}
h1{margin-top:0}.summary{display:grid;grid-template-columns:max-content 1fr;gap:8px 18px;padding:16px;background:#f5f8fc;border-radius:12px}
dt{font-weight:700}dd{margin:0}fieldset{margin:22px 0;padding:18px;border:1px solid #ccd6e4;border-radius:12px}
label{display:block;margin:12px 0 5px;font-weight:650}input{box-sizing:border-box;width:100%;padding:10px;border:1px solid #9aa9bd;border-radius:7px}
button{margin-top:14px;padding:10px 18px;border:0;border-radius:8px;background:#1769e0;color:#fff;font-weight:700;cursor:pointer}
.message{padding:11px;border-radius:8px;background:#e9f4ff}.warning{font-size:.92rem;color:#5b4450}a{color:#1769e0}
</style></head><body><main><h1>ProgHard Link Clock Demo</h1>)HTML";
  if (!message.isEmpty()) html += "<p class=\"message\">" + htmlEscape(message) + "</p>";
  html += "<dl class=\"summary\"><dt>Current time</dt><dd>" + String(current) +
    "</dd><dt>Mode</dt><dd>" + String(ntpMode ? "Automatic NTP" : "Manual") +
    "</dd><dt>NTP status</dt><dd>" + String(ntpMode ? (ntpSynced ? "Synchronized" : "Waiting") : "Not used") +
    "</dd></dl>";
  html += R"HTML(<form method="post"><fieldset><legend>Automatic NTP</legend>
<label for="server">NTP server</label><input id="server" name="server" required maxlength="96" value=")HTML";
  html += htmlEscape(ntpServer);
  html += R"HTML("><label for="timezone">POSIX timezone</label><input id="timezone" name="timezone" required maxlength="128" value=")HTML";
  html += htmlEscape(timezone);
  html += R"HTML("><button name="action" value="ntp">Use NTP / Sync now</button></fieldset></form>
<form method="post"><fieldset><legend>Manual time</legend><label for="date">Date</label><input id="date" type="date" name="date" required value=")HTML";
  html += String(dateValue);
  html += R"HTML("><label for="time">Time</label><input id="time" type="time" step="1" name="time" required value=")HTML";
  html += String(timeValue);
  html += R"HTML("><button name="action" value="manual">Apply manual time</button></fieldset></form>
<p class="warning"><strong>No battery-backed RTC:</strong> after a full power loss, use NTP again or set the time manually.</p>
<p><a href="/">Device home</a> · <a href="/config">Configuration</a> · <a href="/ota">OTA</a></p>
</main></body></html>)HTML";
  return html;
}

String ClockDemoApp::formValue(const String& body, const String& key) {
  const String prefix = key + "=";
  int start = 0;
  while (start <= static_cast<int>(body.length())) {
    int end = body.indexOf('&', start);
    if (end < 0) end = body.length();
    const String item = body.substring(start, end);
    if (item.startsWith(prefix)) return urlDecode(item.substring(prefix.length()));
    start = end + 1;
  }
  return "";
}

String ClockDemoApp::urlDecode(const String& value) {
  String decoded;
  decoded.reserve(value.length());
  for (size_t index = 0; index < value.length(); ++index) {
    const char current = value[index];
    if (current == '+') {
      decoded += ' ';
    } else if (current == '%' && index + 2 < value.length()) {
      char encoded[3] = {value[index + 1], value[index + 2], 0};
      char* end = nullptr;
      const long byte = strtol(encoded, &end, 16);
      if (end == encoded + 2) {
        decoded += static_cast<char>(byte);
        index += 2;
      } else {
        decoded += current;
      }
    } else {
      decoded += current;
    }
  }
  return decoded;
}

String ClockDemoApp::htmlEscape(const String& value) {
  String escaped;
  escaped.reserve(value.length() + 16);
  for (size_t index = 0; index < value.length(); ++index) {
    const char current = value[index];
    switch (current) {
      case '&': escaped += "&amp;"; break;
      case '<': escaped += "&lt;"; break;
      case '>': escaped += "&gt;"; break;
      case '\"': escaped += "&quot;"; break;
      case '\'': escaped += "&#39;"; break;
      default: escaped += current;
    }
  }
  return escaped;
}

bool ClockDemoApp::currentLocalTime(tm& value) {
  const time_t now = time(nullptr);
  if (now < VALID_TIME) return false;
  localtime_r(&now, &value);
  return true;
}
