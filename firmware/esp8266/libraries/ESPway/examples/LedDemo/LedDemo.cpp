#include "LedDemo.h"

#include <ArduinoJson.h>

const char* LedDemo::applicationId() const {
  return "led-demo";
}

const char* LedDemo::firmwareVersion() const {
  return "0.1.3";
}

void LedDemo::begin(const ESPwayApplicationContext& context) {
  (void)context;
  pinMode(LED_BUILTIN, OUTPUT);
  apply();
}

void LedDemo::loop() {
}

void LedDemo::apply() {
  digitalWrite(LED_BUILTIN, on ? LOW : HIGH);
}

bool LedDemo::handle(const WebRequest& request, WebResponse& response) {
  if (request.path == "/") {
    response.contentType = "text/html";
    response.body = R"HTML(
<!doctype html>
<html>
<head>
  <meta name="viewport" content="width=device-width">
  <title>ProgHard Link LED</title>
</head>
<body>
  <h1>ProgHard Link</h1>
  <p>
    LED
    <button onclick="setLed(true)">ON</button>
    <button onclick="setLed(false)">OFF</button>
  </p>
  <pre id="status"></pre>
  <p>
    <a href="/config">Configuration</a> |
    <a href="/ota">OTA</a> |
    <a href="/diagnostics">Diagnostics</a>
  </p>
  <script>
    async function refresh() {
      const data = await fetch('/api/status').then(
        response => response.json()
      );
      document.querySelector('#status').textContent = JSON.stringify(
        data,
        null,
        2
      );
    }

    async function setLed(on) {
      await fetch('/api/led', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({on})
      });
      refresh();
    }

    refresh();
  </script>
</body>
</html>
)HTML";
    return true;
  }

  if (request.path != "/api/led") {
    return false;
  }

  if (request.method == "POST") {
    JsonDocument document;
    if (deserializeJson(document, request.body) || !document["on"].is<bool>()) {
      response.status = 400;
      response.body = "{\"error\":\"expected boolean on\"}";
      return true;
    }

    on = document["on"];
    apply();
  }

  response.body = String("{\"on\":") + (on ? "true" : "false") + "}";
  return true;
}
