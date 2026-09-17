#include "ESPwayBaseApp.h"

#include <ArduinoJson.h>

namespace {

constexpr char APPLICATION_ID[] = "espway-base";
constexpr char FIRMWARE_VERSION[] = "0.2.3";

}  // namespace

const char* ESPwayBaseApp::applicationId() const {
  return APPLICATION_ID;
}

const char* ESPwayBaseApp::firmwareVersion() const {
  return FIRMWARE_VERSION;
}

void ESPwayBaseApp::begin(const ESPwayApplicationContext& context) {
  deviceId = &context.deviceId;
  pinMode(LED_BUILTIN, OUTPUT);
  applyLedState();
}

void ESPwayBaseApp::loop() {
}

bool ESPwayBaseApp::handle(
  const WebRequest& request,
  WebResponse& response
) {
  if (request.path == "/app") {
    if (request.method != "GET") {
      response.status = 405;
      response.body = "{\"error\":\"method_not_allowed\"}";
    } else {
      response.contentType = "text/html; charset=utf-8";
      response.body = page();
    }
    return true;
  }

  if (request.path != "/api/led") {
    return false;
  }

  if (request.method == "POST") {
    JsonDocument document;
    if (
      deserializeJson(document, request.body) ||
      !document["on"].is<bool>()
    ) {
      response.status = 400;
      response.body = "{\"error\":\"invalid_json\"}";
      return true;
    }

    ledOn = document["on"];
    applyLedState();
  } else if (request.method != "GET") {
    response.status = 405;
    response.body = "{\"error\":\"method_not_allowed\"}";
    return true;
  }

  response.body = String("{\"on\":") + (ledOn ? "true" : "false") + "}";
  return true;
}

const ESPwayNavigationItem* ESPwayBaseApp::navigationItems(size_t& count) const {
  static const ESPwayNavigationItem items[] = {
    {"Base app", "/app"},
  };
  count = 1;
  return items;
}

void ESPwayBaseApp::applyLedState() {
  const uint8_t activeLevel = LED_ACTIVE_LOW ? LOW : HIGH;
  const uint8_t inactiveLevel = LED_ACTIVE_LOW ? HIGH : LOW;
  digitalWrite(LED_BUILTIN, ledOn ? activeLevel : inactiveLevel);
}

String ESPwayBaseApp::page() const {
  const String currentDeviceId = deviceId == nullptr ? "unknown" : *deviceId;

  return R"HTML(
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>ProgHard Link Base</title>
  <style>
    body {
      margin: 0;
      color: #172033;
      background: #f3f6fb;
      font: 16px system-ui, sans-serif;
    }
    main {
      max-width: 620px;
      margin: 40px auto;
      padding: 28px;
      border-radius: 18px;
      background: #fff;
      box-shadow: 0 12px 38px #18243b1c;
    }
    button {
      margin: 4px;
      padding: 11px 24px;
      border: 0;
      border-radius: 9px;
      color: #fff;
      background: #1769e0;
      font-weight: 650;
      cursor: pointer;
    }
    dl {
      display: grid;
      grid-template-columns: max-content 1fr;
      gap: 8px 16px;
    }
    dt { font-weight: 650; }
    nav { margin-top: 28px; }
    a { color: #1769e0; }
  </style>
</head>
<body>
  <main>
    <h1>ProgHard Link Base</h1>
    <dl>
      <dt>Device</dt><dd>)HTML" + currentDeviceId + R"HTML(</dd>
      <dt>Application</dt><dd>)HTML" + String(APPLICATION_ID) + R"HTML(</dd>
      <dt>Firmware</dt><dd>)HTML" + String(FIRMWARE_VERSION) + R"HTML(</dd>
      <dt>Framework</dt><dd>)HTML" + String(ESPWAY_FRAMEWORK_VERSION) + R"HTML(</dd>
    </dl>
    <h2>LED intégrée</h2>
    <p>État : <strong id="state">…</strong></p>
    <p>
      <button onclick="setLed(true)">ON</button>
      <button onclick="setLed(false)">OFF</button>
    </p>
    <nav>
      <a href="/config">Configuration</a> ·
      <a href="/ota">OTA</a> ·
      <a href="/diagnostics">Diagnostics</a>
    </nav>
    <script>
      async function refresh() {
        const response = await fetch('/api/led');
        const state = await response.json();
        document.querySelector('#state').textContent = state.on ? 'ON' : 'OFF';
      }

      async function setLed(on) {
        await fetch('/api/led', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({on})
        });
        await refresh();
      }

      refresh();
    </script>
  </main>
</body>
</html>
)HTML";
}
