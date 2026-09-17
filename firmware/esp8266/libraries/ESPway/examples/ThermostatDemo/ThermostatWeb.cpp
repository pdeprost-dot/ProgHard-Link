#include "ThermostatWeb.h"

#include <ArduinoJson.h>

namespace {

const char THERMOSTAT_PAGE[] PROGMEM = R"HTML(
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width">
  <title>Thermostat Demo</title>
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
    dt { font-weight: 600; }
    dd { margin: 0; }
    .on { color: #b42318; }
    .off { color: #287a3d; }
  </style>
</head>
<body>
  <main class="card">
    <nav>
      <a href="/">ProgHard Link</a>
      <a href="/thermostat">Thermostat</a>
      <a href="/thermostat/config">Config. thermostat</a>
      <a href="/config">Config. ProgHard Link</a>
      <a href="/ota">OTA</a>
      <a href="/diagnostics">Diagnostics</a>
    </nav>
    <h1>Thermostat Demo</h1>
    <dl>
      <dt>Temperature</dt><dd id="temperature">--</dd>
      <dt>Humidity</dt><dd id="humidity">--</dd>
      <dt>Setpoint</dt><dd id="setpoint">--</dd>
      <dt>Heating</dt><dd id="heating">OFF</dd>
      <dt>Sensor</dt><dd id="sensor">Waiting</dd>
      <dt>MQTT</dt><dd id="mqtt">Disconnected</dd>
      <dt>Last measurement</dt><dd id="age">Never</dd>
    </dl>
    <p id="error"></p>
  </main>
  <script src="/thermostat/status.js"></script>
</body>
</html>
)HTML";

const char CONFIG_PAGE[] PROGMEM = R"HTML(
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width">
  <title>Thermostat configuration</title>
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
    label {
      display: block;
      margin: 12px 0;
    }
    input {
      box-sizing: border-box;
      width: 100%;
      padding: 9px;
    }
    input[type=checkbox] { width: auto; }
    button { padding: 10px 18px; }
    .topic {
      display: block;
      width: 100%;
      margin: 6px 0;
      padding: 8px;
      text-align: left;
    }
    .topic code {
      white-space: normal;
      word-break: break-all;
    }
  </style>
</head>
<body>
  <main class="card">
    <nav>
      <a href="/">ProgHard Link</a>
      <a href="/thermostat">Thermostat</a>
      <a href="/thermostat/config">Config. thermostat</a>
      <a href="/config">Config. ProgHard Link</a>
      <a href="/ota">OTA</a>
      <a href="/diagnostics">Diagnostics</a>
    </nav>
    <h1>Thermostat configuration</h1>
    <label>
      Publish interval (seconds)
      <input id="publishInterval" type="number" min="2" max="3600">
    </label>
    <label>
      Fallback setpoint (°C)
      <input
        id="fallbackSetpoint"
        type="number"
        min="5"
        max="35"
        step="0.1"
      >
    </label>
    <label>
      Hysteresis (°C)
      <input id="hysteresis" type="number" min="0.1" max="5" step="0.1">
    </label>
    <label>
      Measurement interval (seconds)
      <input id="measurementInterval" type="number" min="2" max="3600">
    </label>
    <button id="save">Save</button>
    <p id="message"></p>
    <h2>MQTT topics</h2>
    <p>Click a topic to copy it.</p>
    <div id="topics"></div>
  </main>
  <script src="/thermostat/config.js"></script>
</body>
</html>
)HTML";

const char STATUS_SCRIPT[] PROGMEM = R"JS(
const show = (id, value) => {
  document.getElementById(id).textContent = value;
};

async function refresh() {
  try {
    const response = await fetch('/api/thermostat/status');
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
    show('setpoint', status.setpoint.toFixed(1) + ' °C');
    show('heating', status.heating ? 'ON' : 'OFF');
    document.getElementById('heating').className = status.heating
      ? 'on'
      : 'off';
    show('sensor', status.sensorValid ? 'OK' : 'Error');
    show('mqtt', status.mqttConnected ? 'Connected' : 'Disconnected');
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
)JS";

const char CONFIG_SCRIPT[] PROGMEM = R"JS(
const el = id => document.getElementById(id);
const topicSuffixes = [
  'temperature',
  'humidity',
  'setpoint',
  'heating',
  'status',
  'setpoint/set'
];

function renderTopics() {
  const baseTopic = window.mqttBaseTopic;
  const buttons = topicSuffixes.map(suffix => {
    const topic = baseTopic + '/' + suffix;
    const button = document.createElement('button');
    const code = document.createElement('code');
    button.type = 'button';
    button.className = 'topic';
    code.textContent = topic;
    button.append(code);
    button.onclick = async () => {
      try {
        await navigator.clipboard.writeText(topic);
        el('message').textContent = 'Copied: ' + topic;
      } catch (error) {
        el('message').textContent = 'Copy unavailable; select the topic.';
      }
    };
    return button;
  });
  el('topics').replaceChildren(...buttons);
}

async function load() {
  const [configResponse, mqttResponse] = await Promise.all([
    fetch('/api/thermostat/config'),
    fetch('/api/espway/mqtt')
  ]);
  const config = await configResponse.json();
  const mqtt = await mqttResponse.json();
  window.mqttBaseTopic = mqtt.baseTopic;
  const directFields = ['fallbackSetpoint', 'hysteresis'];

  for (const key of directFields) {
    const property = el(key).type === 'checkbox' ? 'checked' : 'value';
    el(key)[property] = config[key];
  }
  el('publishInterval').value = config.publishIntervalMs / 1000;
  el('measurementInterval').value = config.measurementIntervalMs / 1000;
  renderTopics();
}

el('save').onclick = async () => {
  const config = {
    publishIntervalMs: Number(el('publishInterval').value) * 1000,
    fallbackSetpoint: Number.parseFloat(el('fallbackSetpoint').value),
    hysteresis: Number.parseFloat(el('hysteresis').value),
    measurementIntervalMs: Number(el('measurementInterval').value) * 1000
  };
  const response = await fetch('/api/thermostat/config', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(config)
  });
  el('message').textContent = response.ok ? 'Saved' : await response.text();
};

load().catch(error => el('message').textContent = error.message);
)JS";

}  // namespace

String ThermostatWeb::page() {
  return FPSTR(THERMOSTAT_PAGE);
}

String ThermostatWeb::configPage() {
  return FPSTR(CONFIG_PAGE);
}

String ThermostatWeb::statusScript() {
  return FPSTR(STATUS_SCRIPT);
}

String ThermostatWeb::configScript() {
  return FPSTR(CONFIG_SCRIPT);
}

String ThermostatWeb::statusJson(
  const ThermostatSensor& sensor,
  const ThermostatControl& control,
  bool mqttConnected
) {
  JsonDocument document;
  if (sensor.hasReading()) {
    document["temperature"] = sensor.temperature();
    document["humidity"] = sensor.humidity();
    document["lastMeasurementMs"] = sensor.ageMs();
  } else {
    document["temperature"] = nullptr;
    document["humidity"] = nullptr;
    document["lastMeasurementMs"] = nullptr;
  }
  document["setpoint"] = control.setpoint();
  document["heating"] = control.heating();
  document["sensorValid"] = sensor.valid();
  document["mqttConnected"] = mqttConnected;

  String result;
  result.reserve(192);
  serializeJson(document, result);
  return result;
}

String ThermostatWeb::measurementJson(
  float value,
  const char* unit,
  bool valid
) {
  String result = "{\"value\":";
  result.reserve(48);
  result += valid ? String(value, 1) : "null";
  result += ",\"unit\":\"";
  result += unit;
  result += "\",\"valid\":";
  result += valid ? "true}" : "false}";
  return result;
}

String ThermostatWeb::numberJson(float value) {
  return "{\"value\":" + String(value, 1) + "}";
}

String ThermostatWeb::booleanJson(bool value) {
  return value ? "{\"value\":true}" : "{\"value\":false}";
}

String ThermostatWeb::configJson(const ThermostatConfig& config) {
  JsonDocument document;
  document["publishIntervalMs"] = config.publishIntervalMs;
  document["fallbackSetpoint"] = config.fallbackSetpoint;
  document["hysteresis"] = config.hysteresis;
  document["measurementIntervalMs"] = config.measurementIntervalMs;

  String result;
  result.reserve(320);
  serializeJson(document, result);
  return result;
}
