#include "QuadPzemApp.h"

#include <ArduinoJson.h>

namespace {

const char PAGE[] PROGMEM = R"HTML(<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Quadruple wattmetre</title><style>
body{margin:0;background:#f3f6fa;color:#18212b;font:16px system-ui}.card{max-width:980px;margin:24px auto;padding:22px;background:white;border-radius:14px;box-shadow:0 3px 18px #0001}nav a{margin-right:12px}table{width:100%;border-collapse:collapse;margin:20px 0}th,td{padding:9px;border-bottom:1px solid #ddd;text-align:right}th:first-child,td:first-child{text-align:left}.bad{color:#b42318}.ok{color:#287a3d}label{display:block;margin:12px 0}input{box-sizing:border-box;width:100%;max-width:420px;padding:8px}button{padding:9px 16px}@media(max-width:700px){.card{margin:0;border-radius:0;overflow:auto}}
</style></head><body><main class="card"><nav><a href="/">ProgHard Link</a><a href="/wattmeter">Wattmetre</a><a href="/config">Config. ProgHard Link/MQTT</a><a href="/diagnostics">Diagnostics</a></nav>
<h1>Quadruple wattmetre PZEM-004T v3</h1><p>Bus: RX GPIO12 (D6), TX GPIO14 (D5) - adresses Modbus 1 a 4.</p>
<table><thead><tr><th>Adresse</th><th>Etat</th><th>V</th><th>A</th><th>W</th><th>Wh</th><th>Hz</th><th>FP</th></tr></thead><tbody id="meters"></tbody></table>
<p>Total: <strong id="total">--</strong> W - MQTT: <span id="mqtt">--</span> - derniere lecture: <span id="age">--</span></p>
<h2>Parametres</h2><label>Frequence de lecture (secondes, 15 a 900)<br><input id="interval" type="number" min="15" max="900" step="1"></label>
<label>Topic MQTT (sous le baseTopic ProgHard Link)<br><input id="topic" maxlength="96"></label><p>Topics complets: <code id="fullTopic"></code></p>
<button id="save">Enregistrer</button> <button id="read">Lire maintenant</button><p id="message"></p>
</main><script>
const el=id=>document.getElementById(id); const value=(v,d=1)=>v===null?'--':Number(v).toFixed(d);
async function refresh(){try{const r=await fetch('/api/wattmeter/status');if(!r.ok)throw Error('HTTP '+r.status);const s=await r.json();el('meters').innerHTML=s.meters.map(m=>`<tr><td>${m.address}</td><td class="${m.valid?'ok':'bad'}">${m.valid?'OK':'Erreur'}</td><td>${value(m.voltage)}</td><td>${value(m.current,3)}</td><td>${value(m.power)}</td><td>${m.energyWh===null?'--':m.energyWh}</td><td>${value(m.frequency)}</td><td>${value(m.powerFactor,2)}</td></tr>`).join('');el('total').textContent=value(s.totalPower);el('mqtt').textContent=s.mqttConnected?'connecte':'deconnecte';el('age').textContent=s.lastCycleMs===null?'jamais':Math.floor(s.lastCycleMs/1000)+' s';}catch(e){el('message').textContent=e.message}}
async function loadConfig(){const [cr,mr]=await Promise.all([fetch('/api/wattmeter/config'),fetch('/api/espway/mqtt')]);const c=await cr.json(),m=await mr.json();el('interval').value=c.readIntervalMs/1000;el('topic').value=c.mqttTopic;el('fullTopic').textContent=m.baseTopic+'/'+c.mqttTopic+'/{1,2,3,4}'}
el('save').onclick=async()=>{const r=await fetch('/api/wattmeter/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({readIntervalMs:Number(el('interval').value)*1000,mqttTopic:el('topic').value.trim()})});el('message').textContent=r.ok?'Parametres enregistres':await r.text();if(r.ok)loadConfig()};
el('read').onclick=async()=>{el('message').textContent='Lecture en cours...';const r=await fetch('/api/wattmeter/read',{method:'POST'});el('message').textContent=r.ok?'Lecture terminee':await r.text();refresh()};loadConfig().catch(e=>el('message').textContent=e.message);refresh();setInterval(refresh,3000);
</script></body></html>)HTML";

void addNullable(JsonObject object, const char* key, float value, bool valid) {
  if (valid && isfinite(value)) object[key] = value;
  else object[key] = nullptr;
}

}  // namespace

const char* QuadPzemApp::applicationId() const { return "quad-pzem-wattmeter"; }
const char* QuadPzemApp::firmwareVersion() const { return "0.1.0"; }

void QuadPzemApp::begin(const ESPwayApplicationContext& context) {
  mqtt = &context.mqtt;
  configStore.begin();
  if (!configStore.load(config)) {
    config = QuadPzemConfig{};
    configStore.save(config);
  }
  meter.begin();
  Serial.println(F("Quad PZEM wattmeter initialized (Modbus addresses 1-4)"));
}

void QuadPzemApp::loop() {
  if (firstCycle || millis() - lastCycleAt >= config.readIntervalMs) {
    measureAndPublish();
  }
}

bool QuadPzemApp::handle(const WebRequest& request, WebResponse& response) {
  if (request.path == "/wattmeter") {
    response.contentType = "text/html";
    response.body = page();
    return true;
  }
  if (request.path == "/api/wattmeter/status") {
    if (request.method != "GET") { response.status = 405; response.body = "{\"error\":\"method_not_allowed\"}"; }
    else response.body = statusJson();
    return true;
  }
  if (request.path == "/api/wattmeter/read") {
    if (request.method != "POST") { response.status = 405; response.body = "{\"error\":\"method_not_allowed\"}"; }
    else { measureAndPublish(); response.body = statusJson(); }
    return true;
  }
  if (request.path != "/api/wattmeter/config") return false;
  if (request.method == "GET") { response.body = configJson(); return true; }
  if (request.method != "POST") { response.status = 405; response.body = "{\"error\":\"method_not_allowed\"}"; return true; }
  String error;
  if (!updateConfiguration(request.body, error)) { response.status = 400; response.body = "{\"error\":\"" + error + "\"}"; }
  else response.body = configJson();
  return true;
}

const ESPwayNavigationItem* QuadPzemApp::navigationItems(size_t& count) const {
  static const ESPwayNavigationItem items[] = {{"Quad wattmetre", "/wattmeter"}};
  count = 1;
  return items;
}

void QuadPzemApp::measureAndPublish() {
  firstCycle = false;
  meter.readAll();
  lastCycleAt = millis();
  if (mqtt != nullptr && mqtt->connected()) {
    for (uint8_t index = 0; index < QuadPzemMeter::METER_COUNT; ++index) {
      const PzemReading& reading = meter.reading(index);
      JsonDocument document;
      document["address"] = index + 1;
      document["valid"] = reading.valid;
      if (reading.valid) {
        document["voltage"] = reading.voltage;
        document["current"] = reading.current;
        document["power"] = reading.power;
        document["energyWh"] = reading.energyWh;
        document["frequency"] = reading.frequency;
        document["powerFactor"] = reading.powerFactor;
        document["alarm"] = reading.alarm;
      }
      String payload;
      serializeJson(document, payload);
      const String topic = config.mqttTopic + "/" + String(index + 1);
      mqtt->publish(topic.c_str(), payload.c_str(), true);
    }
  }
}

bool QuadPzemApp::updateConfiguration(const String& body, String& error) {
  JsonDocument document;
  if (deserializeJson(document, body)) { error = "invalid_json"; return false; }
  QuadPzemConfig updated = config;
  if (document["readIntervalMs"].is<uint32_t>()) updated.readIntervalMs = document["readIntervalMs"];
  if (document["mqttTopic"].is<const char*>()) updated.mqttTopic = document["mqttTopic"].as<String>();
  if (!QuadPzemConfigStore::validate(updated)) { error = "interval_or_topic_invalid"; return false; }
  if (!configStore.save(updated)) { error = "cannot_save"; return false; }
  config = updated;
  return true;
}

String QuadPzemApp::statusJson() const {
  JsonDocument document;
  JsonArray meters = document["meters"].to<JsonArray>();
  float totalPower = 0;
  bool hasPower = false;
  for (uint8_t index = 0; index < QuadPzemMeter::METER_COUNT; ++index) {
    const PzemReading& reading = meter.reading(index);
    JsonObject item = meters.add<JsonObject>();
    item["address"] = index + 1;
    item["valid"] = reading.valid;
    addNullable(item, "voltage", reading.voltage, reading.valid);
    addNullable(item, "current", reading.current, reading.valid);
    addNullable(item, "power", reading.power, reading.valid);
    if (reading.valid) item["energyWh"] = reading.energyWh; else item["energyWh"] = nullptr;
    addNullable(item, "frequency", reading.frequency, reading.valid);
    addNullable(item, "powerFactor", reading.powerFactor, reading.valid);
    item["alarm"] = reading.valid ? reading.alarm : false;
    if (reading.updatedAt == 0) item["ageMs"] = nullptr;
    else item["ageMs"] = millis() - reading.updatedAt;
    item["errors"] = reading.errors;
    if (reading.valid) { totalPower += reading.power; hasPower = true; }
  }
  if (hasPower) document["totalPower"] = totalPower; else document["totalPower"] = nullptr;
  if (firstCycle) document["lastCycleMs"] = nullptr;
  else document["lastCycleMs"] = millis() - lastCycleAt;
  document["readIntervalMs"] = config.readIntervalMs;
  document["mqttTopic"] = config.mqttTopic;
  document["mqttConnected"] = mqtt != nullptr && mqtt->connected();
  String result;
  result.reserve(1024);
  serializeJson(document, result);
  return result;
}

String QuadPzemApp::configJson() const {
  JsonDocument document;
  document["readIntervalMs"] = config.readIntervalMs;
  document["mqttTopic"] = config.mqttTopic;
  document["minimumIntervalMs"] = QuadPzemConfig::MIN_INTERVAL_MS;
  document["maximumIntervalMs"] = QuadPzemConfig::MAX_INTERVAL_MS;
  String result;
  serializeJson(document, result);
  return result;
}

String QuadPzemApp::page() const { return FPSTR(PAGE); }
