#include "DhtSensorApp.h"

#include <ArduinoJson.h>

namespace {

const char DHT_PAGE[] PROGMEM = R"HTML(
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width">
  <title>DHT Sensor Demo</title>
  <style>
    body {
      margin: 0;
      color: #17202a;
      background: #f4f7fb;
      font: 16px system-ui;
    }
    .card {
      max-width: 620px;
      margin: 30px auto;
      padding: 24px;
      border-radius: 14px;
      background: #fff;
    }
    nav a { margin-right: 12px; }
    dl {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }
    dd { margin: 0; }
  </style>
</head>
<body>
  <main class="card">
    <nav>
      <a href="/">ProgHard Link</a>
      <a href="/dht">DHT sensor</a>
      <a href="/config">Configuration</a>
      <a href="/ota">OTA</a>
      <a href="/diagnostics">Diagnostics</a>
    </nav>
    <h1>DHT Sensor Demo</h1>
    <dl>
      <dt>Temperature</dt><dd id="temperature">--</dd>
      <dt>Humidity</dt><dd id="humidity">--</dd>
      <dt>Sensor</dt><dd id="sensor">Waiting</dd>
      <dt>Last measurement</dt><dd id="age">Never</dd>
    </dl>
    <p id="error"></p>
  </main>
  <script>
    const show = (id, value) => {
      document.getElementById(id).textContent = value;
    };

    async function refresh() {
      try {
        const response = await fetch('/api/dht/status');
        if (!response.ok) {
          throw new Error('HTTP ' + response.status);
        }
        const status = await response.json();
        show(
          'temperature',
          status.temperature === null
            ? '--'
            : status.temperature.toFixed(1) + ' °C'
        );
        show(
          'humidity',
          status.humidity === null
            ? '--'
            : status.humidity.toFixed(1) + ' %'
        );
        show('sensor', status.sensorValid ? 'OK' : 'Error');
        show(
          'age',
          status.lastMeasurementMs === null
            ? 'Never'
            : Math.floor(status.lastMeasurementMs / 1000) + ' s'
        );
        show('error', '');
      } catch (error) {
        show('error', error.message);
      }
    }

    refresh();
    setInterval(refresh, 5000);
  </script>
</body>
</html>
)HTML";

}  // namespace

const char* DhtSensorApp::applicationId() const {
  return "dht-sensor-demo";
}

const char* DhtSensorApp::firmwareVersion() const {
  return "0.1.0";
}

void DhtSensorApp::begin(const ESPwayApplicationContext& context) {
  (void)context;
  sensor.begin();
}

void DhtSensorApp::loop() {
  const uint32_t now = millis();
  if (firstAttempt || now - lastAttemptAt >= MEASUREMENT_INTERVAL_MS) {
    readSensor();
  }
}

bool DhtSensorApp::handle(
  const WebRequest& request,
  WebResponse& response
) {
  if (request.path == "/dht") {
    response.contentType = "text/html";
    response.body = page();
    return true;
  }

  if (request.path == "/api/dht/status") {
    response.body = statusJson();
    return true;
  }

  return false;
}

const ESPwayNavigationItem* DhtSensorApp::navigationItems(size_t& count) const {
  static const ESPwayNavigationItem items[] = {
    {"DHT sensor", "/dht"}
  };
  count = sizeof(items) / sizeof(items[0]);
  return items;
}

void DhtSensorApp::readSensor() {
  firstAttempt = false;
  lastAttemptAt = millis();
  const float nextHumidity = sensor.readHumidity();
  const float nextTemperature = sensor.readTemperature();
  sensorValid = isfinite(nextTemperature) && isfinite(nextHumidity);

  if (!sensorValid) {
    Serial.println("DHT22 reading failed; last valid values retained");
    return;
  }

  temperature = nextTemperature;
  humidity = nextHumidity;
  lastValidAt = lastAttemptAt;
  hasValidMeasurement = true;
}

String DhtSensorApp::page() const {
  return FPSTR(DHT_PAGE);
}

String DhtSensorApp::statusJson() const {
  JsonDocument document;
  if (hasValidMeasurement) {
    document["temperature"] = temperature;
    document["humidity"] = humidity;
    document["lastMeasurementMs"] = millis() - lastValidAt;
  } else {
    document["temperature"] = nullptr;
    document["humidity"] = nullptr;
    document["lastMeasurementMs"] = nullptr;
  }
  document["sensorValid"] = sensorValid;

  String result;
  result.reserve(128);
  serializeJson(document, result);
  return result;
}
