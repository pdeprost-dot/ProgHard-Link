#include "ESPwayFramework.h"
#include "ESPwayOtaWebCrypto.h"

#include <ArduinoJson.h>
#include <base64.h>
#include <ctype.h>
#include <libb64/cdecode.h>
#include <memory>
#include <new>

namespace {

constexpr uint16_t TUNNEL_PORT = 80;
constexpr char TUNNEL_PROTOCOL_V2[] = "espway-tunnel/2";

const char WIFI_CONFIG_UI[] PROGMEM = R"ESPWAY(
<p id="wifi-summary" class="muted">Loading Wi-Fi status...</p>
<section id="wifi-profiles"></section>
<script>
const escapeHtml = value => String(value).replace(
  /[&<>"']/g,
  character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;',
    '"': '&quot;', "'": '&#39;'
  })[character]
);

async function loadWifi() {
  const response = await fetch('/api/espway/wifi');
  const status = await response.json();
  document.querySelector('#wifi-summary').textContent =
    `Active profile: ${status.activeProfile || '-'} | ` +
    `Last known good: ${status.lastKnownGoodProfile || '-'} | ` +
    `IP: ${status.ip} | RSSI: ${status.rssi} dBm | ` +
    `STA: ${status.connected ? 'connected' : 'offline'} | ` +
    `AP: ${status.apActive ? 'active' : 'off'} | ` +
    `Test: ${status.testInProgress ? 'running' : 'idle'}`;

  document.querySelector('#wifi-profiles').innerHTML = status.profiles
    .map(profile => `
      <fieldset>
        <legend>Wi-Fi ${profile.id}</legend>
        <label>
          <input id="enabled-${profile.id}" type="checkbox"
            style="width:auto" ${profile.enabled ? 'checked' : ''}>
          Enabled
        </label>
        <label>SSID
          <input id="ssid-${profile.id}" maxlength="32"
            value="${escapeHtml(profile.ssid)}">
        </label>
        <label>New password
          <input id="password-${profile.id}" type="password" maxlength="64"
            placeholder="Unchanged when empty">
        </label>
        <p class="muted">
          Configured: ${profile.configured ? 'yes' : 'no'} |
          State: ${profile.active ? 'active' : '-'}
        </p>
        <button type="button" onclick="saveProfile(${profile.id})">Save</button>
        <button type="button" onclick="testProfile(${profile.id})">
          Test and switch
        </button>
        <button type="button" onclick="deleteProfile(${profile.id})">Delete</button>
      </fieldset>`)
    .join('');
}

async function callProfile(id, suffix, body) {
  const response = await fetch(`/api/espway/wifi/profile/${id}${suffix}`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'request_failed');
  return result;
}

async function saveProfile(id) {
  try {
    await callProfile(id, '', {
      enabled: document.querySelector(`#enabled-${id}`).checked,
      ssid: document.querySelector(`#ssid-${id}`).value,
      password: document.querySelector(`#password-${id}`).value
    });
    await loadWifi();
    alert('Profile saved');
  } catch (error) {
    alert(error.message);
  }
}

async function testProfile(id) {
  if (!confirm(`Test Wi-Fi ${id}? The current connection may close.`)) return;
  try {
    await callProfile(id, '/test', {});
    alert('Test accepted. Reconnect using the new IP if it changes.');
  } catch (error) {
    alert(error.message);
  }
}

async function deleteProfile(id) {
  if (!confirm(`Delete Wi-Fi ${id}?`)) return;
  try {
    await callProfile(id, '', {delete: true});
    await loadWifi();
  } catch (error) {
    alert(error.message);
  }
}

loadWifi();
</script>
<hr><h2>General settings</h2>
)ESPWAY";

const char MQTT_CONFIG_UI[] PROGMEM = R"ESPWAY(
<hr><h2>MQTT</h2>
<p id="mqtt-summary" class="muted">Loading MQTT status...</p>
<label><input id="mqtt-enabled" type="checkbox" style="width:auto"> Enabled</label>
<label>Broker<input id="mqtt-host" maxlength="128"></label>
<label>Port<input id="mqtt-port" type="number" min="1" max="65535"></label>
<label>Username<input id="mqtt-username" maxlength="64"></label>
<label>New password<input id="mqtt-password" type="password" maxlength="64"
  placeholder="Unchanged when empty"></label>
<label>Base topic<input id="mqtt-base-topic" maxlength="128"></label>
<button type="button" onclick="saveMqtt()">Save MQTT</button>
<script>
async function loadMqtt() {
  const response = await fetch('/api/espway/mqtt');
  const mqtt = await response.json();
  document.querySelector('#mqtt-enabled').checked = mqtt.enabled;
  document.querySelector('#mqtt-host').value = mqtt.host;
  document.querySelector('#mqtt-port').value = mqtt.port;
  document.querySelector('#mqtt-username').value = mqtt.username;
  document.querySelector('#mqtt-base-topic').value = mqtt.baseTopic;
  document.querySelector('#mqtt-summary').textContent =
    `${mqtt.connected ? 'Connected' : 'Disconnected'} | ` +
    `Password configured: ${mqtt.passwordConfigured ? 'yes' : 'no'}`;
}
async function saveMqtt() {
  const body = {
    enabled: document.querySelector('#mqtt-enabled').checked,
    host: document.querySelector('#mqtt-host').value,
    port: Number(document.querySelector('#mqtt-port').value),
    username: document.querySelector('#mqtt-username').value,
    baseTopic: document.querySelector('#mqtt-base-topic').value
  };
  const password = document.querySelector('#mqtt-password').value;
  if (password) body.password = password;
  const response = await fetch('/api/espway/mqtt', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body)
  });
  if (!response.ok) return alert(await response.text());
  document.querySelector('#mqtt-password').value = '';
  await loadMqtt();
}
loadMqtt();
</script>
)ESPWAY";

const char NETWORK_CONFIG_UI[] PROGMEM = R"ESPWAY(
<h2>Wi-Fi networks</h2>
<p class="muted">Keep a backup network so the device can reconnect if the main network is unavailable.</p>
<p id="wifi-summary" class="muted">Loading network status...</p>
<section id="wifi-profiles"></section>
<script src="/espway/wifi-config.js"></script>
<hr><h2>MQTT</h2><p id="mqtt-summary" class="muted">Loading...</p>
<label><input id="mqtt-enabled" type="checkbox" style="width:auto"> Enabled</label>
<label>Broker<input id="mqtt-host" maxlength="128"></label>
<label>Port<input id="mqtt-port" type="number" min="1" max="65535"></label>
<label>Username<input id="mqtt-username" maxlength="64"></label>
<label>New password<input id="mqtt-password" type="password" maxlength="64"
placeholder="Unchanged when empty"></label>
<label>Base topic<input id="mqtt-base-topic" maxlength="128"></label>
<button type="button" onclick="saveMqtt()">Save MQTT</button>
<script src="/espway/mqtt-config.js"></script><hr><h2>General settings</h2>
)ESPWAY";

const char WIFI_CONFIG_SCRIPT[] PROGMEM = R"JS(
const q=s=>document.querySelector(s), esc=v=>String(v).replace(/[&<>"']/g,c=>
({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
async function loadWifi(){const s=await fetch('/api/espway/wifi').then(r=>r.json());
q('#wifi-summary').textContent=`${s.connected?'Connected':'Not connected'}${s.activeProfile?' to network '+s.activeProfile:''} | IP: ${s.ip}${s.apActive?' | Recovery access point active':''}`;
q('#wifi-profiles').innerHTML=s.profiles.map(p=>{const role=p.active?'Current network':(p.id===s.lastKnownGoodProfile?'Last working network':'Backup network');return `<fieldset><legend>${role} <span class="muted">(slot ${p.id})</span></legend>
<label><input id="we-${p.id}" type="checkbox" style="width:auto" ${p.enabled?'checked':''}> Use this network</label>
<label>SSID<input id="ws-${p.id}" maxlength="32" value="${esc(p.ssid)}"></label>
<label>New password<input id="wp-${p.id}" type="password" maxlength="64" placeholder="Leave empty to keep the current password"></label>
<p class="muted">Save stores these settings without changing the current connection. Test &amp; activate verifies this network before switching; the device returns to its last working network if the test fails.</p>
<button onclick="saveWifi(${p.id})" type="button">Save settings</button>
<button onclick="testWifi(${p.id})" type="button">Test &amp; activate</button>
<button onclick="deleteWifi(${p.id},${p.active})" type="button">Delete network</button></fieldset>`}).join('')}
async function wifiCall(id,suffix,body){const r=await fetch(`/api/espway/wifi/profile/${id}${suffix}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const t=await r.text();if(!r.ok){let m=t;try{m=JSON.parse(t).error||t}catch(e){}throw Error(m||'The device rejected the request')}return t}
async function busy(run){document.querySelectorAll('#wifi-profiles button').forEach(b=>b.disabled=true);try{await run()}finally{document.querySelectorAll('#wifi-profiles button').forEach(b=>b.disabled=false)}}
async function saveWifi(id){await busy(async()=>{try{await wifiCall(id,'',{enabled:q(`#we-${id}`).checked,ssid:q(`#ws-${id}`).value,password:q(`#wp-${id}`).value});await loadWifi();alert('Network settings saved. The current connection was not changed.')}catch(e){alert('Could not save: '+e.message)}})}
async function testWifi(id){if(!confirm(`Test and activate network ${id}? This page may disconnect while the device changes network.`))return;await busy(async()=>{try{await wifiCall(id,'/test',{});alert('Test started. If it succeeds, reconnect using the device new address. If it fails, the device returns to its last working network.')}catch(e){alert('Could not start the test: '+e.message)}})}
async function deleteWifi(id,active){const warning=active?'This is the current network. Deleting it will disconnect the device and start recovery.':'Delete this saved network?';if(!confirm(warning))return;await busy(async()=>{try{await wifiCall(id,'',{delete:true});await loadWifi()}catch(e){alert('Could not delete: '+e.message)}})}loadWifi();
)JS";

const char MQTT_CONFIG_SCRIPT[] PROGMEM = R"JS(
const mq=s=>document.querySelector(s);async function loadMqtt(){const m=await fetch('/api/espway/mqtt').then(r=>r.json());mq('#mqtt-enabled').checked=m.enabled;mq('#mqtt-host').value=m.host;mq('#mqtt-port').value=m.port;mq('#mqtt-username').value=m.username;mq('#mqtt-base-topic').value=m.baseTopic;mq('#mqtt-summary').textContent=`${m.connected?'Connected':'Disconnected'} | Password configured: ${m.passwordConfigured?'yes':'no'}`}
async function saveMqtt(){const b={enabled:mq('#mqtt-enabled').checked,host:mq('#mqtt-host').value,port:Number(mq('#mqtt-port').value),username:mq('#mqtt-username').value,baseTopic:mq('#mqtt-base-topic').value},p=mq('#mqtt-password').value;if(p)b.password=p;const r=await fetch('/api/espway/mqtt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});if(!r.ok)return alert(await r.text());mq('#mqtt-password').value='';await loadMqtt()}loadMqtt();
)JS";


String htmlHead(const String& title) {
  return "<!doctype html><html><head><meta charset='utf-8'>"
         "<meta name='viewport' content='width=device-width'>"
         "<title>" + title + "</title>"
         "<style>"
         "body{font:16px system-ui;background:#f4f7fb;margin:0;color:#17202a}"
         ".card{max-width:620px;margin:30px auto;background:#fff;padding:24px;border-radius:14px}"
         "label{display:block;margin:12px 0}"
         "input,select{box-sizing:border-box;width:100%;padding:9px}"
         "button{padding:10px 18px;margin:6px}"
         "nav{margin-bottom:20px;padding-bottom:12px;border-bottom:1px solid #dce3eb}"
         "nav a{margin-right:12px}"
         ".muted{color:#5d6d7e}"
         "</style></head><body><main class='card'>";
}

String htmlEnd() {
  return "</main></body></html>";
}

String randomCredential() {
  uint8_t bytes[32];
  if (!ESPwayPlatform::randomBytes(bytes, sizeof(bytes))) return "";
  static constexpr char HEX_DIGITS[] = "0123456789abcdef";
  String value;
  value.reserve(64);
  for (uint8_t byte : bytes) {
    value += HEX_DIGITS[byte >> 4];
    value += HEX_DIGITS[byte & 0x0f];
  }
  return value;
}


}  // namespace

void ESPwayFramework::begin(ESPwayApplication& app) {
  application = &app;

  deviceId = ESPwayPlatform::deviceId();
  deviceId.toLowerCase();
  ESPwayPlatform::setHostname(deviceId);

  Serial.println();
  Serial.println("=== ProgHard Link boot ===");
  Serial.println("Firmware " + String(application->firmwareVersion()));
  Serial.println("Device ID: " + deviceId);
  Serial.println("Free heap: " + String(ESPwayPlatform::freeHeap()));
#if ESPWAY_OTA_AUTH_SELF_TEST
  Serial.println(
    ESPwayOtaAuthorization::selfTest()
      ? F("OTA authorization cross-implementation self-test: PASS")
      : F("OTA authorization cross-implementation self-test: FAIL")
  );
#endif

  const bool fileSystemReady = store.begin();
  Serial.println(
    fileSystemReady ? F("Filesystem ready") : F("Filesystem initialization failed")
  );
  const bool loaded = store.load(config);
  const bool configurationChanged = normalizeConfiguration();
  const bool credentialGenerated = config.deviceToken.isEmpty();
  if (credentialGenerated) config.deviceToken = randomCredential();
  if ((loaded && configurationChanged) || credentialGenerated) {
    store.save(config);
    if (loaded && configurationChanged) {
      Serial.println("Configuration migrated to version " +
                     String(ESPWAY_CONFIG_VERSION));
    }
  }
  const bool hasWifiConfig =
    config.wifiProfiles[0].configured() ||
    config.wifiProfiles[1].configured();

  mqttService.begin(config, store, deviceId);
  wifiManager.begin(config, store, deviceId);
  provisioning = !hasWifiConfig;
  if (hasWifiConfig) {
    const ESPwayApplicationContext applicationContext {deviceId, mqttService};
    application->begin(applicationContext);
    applicationStarted = true;
  } else {
    Serial.println(F("Application startup deferred until provisioning"));
  }

  registerRoutes();
  web.begin();
  Serial.println(F("Local HTTP server ready on port 80"));
}

void ESPwayFramework::loop() {
  if (applicationStarted) application->loop();
  web.handleClient();
  wifiManager.loop();
  startPendingOtaStream();

  const bool wifiConnected = wifiManager.connected();
  const bool networkReady = wifiManager.isNetworkReady();
  mqttService.loop(networkReady);
  if (wifiConnected && !wifiWasConnected) {
    Serial.println(F("WiFi connected"));
    Serial.println("IP: " + WiFi.localIP().toString());
    logHeap("Heap before WS tunnel");
    Serial.println(F("STA connected; awaiting stability"));
  } else if (!wifiConnected && wifiWasConnected) {
    Serial.println(F("WiFi lost"));
    stopTunnel(F("WiFi lost"), false);
    nextTunnelAttemptAt = millis();
  }
  if (networkReady && !wifiWasNetworkReady) {
    nextTunnelAttemptAt = millis();
    Serial.println(F("WiFi network ready"));
  } else if (
    !networkReady && wifiWasNetworkReady && wifiConnected
  ) {
    Serial.println(F("WiFi network no longer ready"));
    stopTunnel(F("WiFi transition"), false);
    nextTunnelAttemptAt = millis();
  }
  wifiWasConnected = wifiConnected;
  wifiWasNetworkReady = networkReady;

  provisioning = wifiManager.apActive();
  if (wifiManager.apActive() && !dnsActive) {
    dns.start(53, "*", WiFi.softAPIP());
    dnsActive = true;
  } else if (!wifiManager.apActive() && dnsActive) {
    dns.stop();
    dnsActive = false;
  }
  if (dnsActive) {
    dns.processNextRequest();
  }

  if (restartAt != 0 && static_cast<long>(millis() - restartAt) >= 0) {
    ESP.restart();
  }

  if (remoteOtaState != RemoteOtaState::Idle) {
    handleRemoteOta();
    return;
  }

  if (!networkReady) {
    tunnelConnected = false;
  } else {
    if (!config.remoteEnabled) {
      if (tunnelStarted) {
        stopTunnel(F("remote disabled"), false);
      }
    } else if (
      !tunnelConnected &&
      !tunnelStarted &&
      tunnelRetryDue()
    ) {
      connectTunnel();
    }
    if (
      tunnelStarted && !tunnelConnected &&
      millis() - tunnelAttemptStartedAt >= TUNNEL_ATTEMPT_TIMEOUT_MS
    ) {
      Serial.println(F("Tunnel attempt timed out"));
      stopTunnel(F("attempt timeout"), true);
    }
  }

  if (tunnelStarted) {
    tunnel.loop();
  }
}

void ESPwayFramework::registerRoutes() {
  ESPwayPlatform::collectOtaHeaders(web);
  web.onNotFound([this]() {
    dispatchLocal();
  });

  web.on("/setup/save", HTTP_POST, [this]() {
    saveConfigurationFromRequest();
    web.send(
      200,
      "text/html",
      htmlHead("Saved") +
        "<h1>Saved</h1><p>Restarting...</p>" + htmlEnd()
    );
    delay(300);
    ESP.restart();
  });

  web.on("/config/save", HTTP_POST, [this]() {
    saveConfigurationFromRequest();
    web.send(
      200,
      "text/html",
      htmlHead("Saved") +
        "<h1>Configuration saved</h1><p>Restarting...</p>" + htmlEnd()
    );
    delay(300);
    ESP.restart();
  });

  web.on("/restart", HTTP_POST, [this]() {
    web.send(200, "text/plain", "restarting");
    delay(200);
    ESP.restart();
  });

  web.on("/reset-wifi", HTTP_POST, [this]() {
    wifiManager.clearProfiles();
    web.send(200, "text/plain", "restarting");
    delay(200);
    ESP.restart();
  });

  web.on("/factory-reset", HTTP_POST, [this]() {
    store.clear();
    web.send(200, "text/plain", "restarting");
    delay(200);
    ESP.restart();
  });

  web.on("/ota/upload", HTTP_POST, [this]() {
    if (!localOtaSucceeded) {
      web.send(400, "application/json", "{\"error\":\"ota_failed\"}");
      return;
    }
    web.send(200, "text/plain", "Update Success! Rebooting...");
    restartAt = millis() + 500;
    localOtaSucceeded = false;
  }, [this]() {
    HTTPUpload& upload = web.upload();
    if (upload.status == UPLOAD_FILE_START) {
      localOtaSucceeded = streamOta.begin(
        otaAuthorization, config.deviceToken, deviceId,
        static_cast<size_t>(web.header("X-ESPway-OTA-Size").toInt()),
        web.header("X-ESPway-OTA-SHA256"),
        web.header("X-ESPway-OTA-Proof")
      );
    } else if (upload.status == UPLOAD_FILE_WRITE && localOtaSucceeded) {
      localOtaSucceeded = streamOta.write(upload.buf, upload.currentSize);
    } else if (upload.status == UPLOAD_FILE_END) {
      localOtaSucceeded = localOtaSucceeded && streamOta.finish();
      if (localOtaSucceeded) logOtaMetrics(F("LAN"));
    } else if (upload.status == UPLOAD_FILE_ABORTED) {
      streamOta.abort();
      localOtaSucceeded = false;
    }
  });
}

void ESPwayFramework::saveConfigurationFromRequest() {
  config.deviceName = web.arg("deviceName");
  config.remoteEnabled = web.hasArg("remoteEnabled");
  if (web.hasArg("remoteDomain")) {
    config.remoteDomain = web.arg("remoteDomain");
  } else if (web.hasArg("remoteHost")) {
    config.remoteDomain = web.arg("remoteHost");
  }

  const long requestedPort = web.arg("remotePort").toInt();
  if (requestedPort > 0 && requestedPort <= 65535) {
    config.remotePort = static_cast<uint16_t>(requestedPort);
  }

  const String wifiSsid = web.arg("wifiSsid");
  const String wifiPassword = web.arg("wifiPassword");
  const String instanceUrl = web.arg("instanceUrl");

  if (wifiSsid.length() > 0) {
    config.wifiProfiles[0].ssid = wifiSsid;
    config.wifiProfiles[0].enabled = true;
  }
  if (wifiPassword.length() > 0) {
    config.wifiProfiles[0].password = wifiPassword;
  }
  if (instanceUrl.length() > 0) config.instanceUrl = instanceUrl;

  normalizeConfiguration();
  store.save(config);
}

void ESPwayFramework::dispatchLocal() {
  String query;
  for (uint8_t index = 0; index < web.args(); ++index) {
    if (web.argName(index) == "plain") continue;
    if (!query.isEmpty()) query += '&';
    query += web.argName(index) + "=" + web.arg(index);
  }
  const WebRequest request {
    web.method() == HTTP_POST ? "POST" : "GET",
    web.uri(),
    web.arg("plain"),
    query
  };
  const WebResponse response = route(request);
  web.send(response.status, response.contentType, response.body);
}

WebResponse ESPwayFramework::route(const WebRequest& request) {
  WebResponse response;

  if (
    provisioning && request.method == "GET" &&
    request.path != "/" && !request.path.startsWith("/api/")
  ) {
    response.contentType = "text/html";
    response.body = setupPage();
    return response;
  }

  if (applicationStarted && application->handle(request, response)) {
    return response;
  }

  if (request.path == "/") {
    response.contentType = "text/html";
    response.body = provisioning ? setupPage() : page();
  } else if (request.path == "/api/status") {
    response.body = statusJson();
  } else if (request.path == "/api/ota/challenge") {
    if (request.method != "GET") {
      response.status = 405;
      response.body = "{\"error\":\"method_not_allowed\"}";
    } else {
      String nonce;
      if (!otaAuthorization.issueChallenge(nonce)) {
        response.status = 503;
        response.body = "{\"error\":\"challenge_unavailable\"}";
      } else {
        response.body = "{\"protocol\":\"ESPWAY-OTA-AUTH-1\",\"nonce\":\"" +
          nonce + "\",\"expiresIn\":60}";
      }
    }
  } else if (request.path == "/espway/wifi-config.js") {
    response.contentType = "application/javascript";
    response.body = FPSTR(WIFI_CONFIG_SCRIPT);
  } else if (request.path == "/espway/mqtt-config.js") {
    response.contentType = "application/javascript";
    response.body = FPSTR(MQTT_CONFIG_SCRIPT);
  } else if (request.path == "/api/espway/wifi") {
    if (request.method == "GET") {
      response.body = wifiStatusJson();
    } else {
      response.status = 405;
      response.body = "{\"error\":\"method_not_allowed\"}";
    }
  } else if (request.path == "/api/espway/mqtt") {
    if (request.method == "GET") {
      response.body = mqttStatusJson();
    } else if (request.method == "POST") {
      response = updateMqttConfiguration(request.body);
    } else {
      response.status = 405;
      response.body = "{\"error\":\"method_not_allowed\"}";
    }
  } else if (request.path == "/api/espway/enrollment") {
    if (request.method == "POST") {
      response = createEnrollment();
    } else {
      response.status = 405;
      response.body = "{\"error\":\"method_not_allowed\"}";
    }
  } else if (
    request.path == "/api/espway/wifi/profile/1" ||
    request.path == "/api/espway/wifi/profile/2"
  ) {
    const uint8_t profileId = request.path.endsWith("/1") ? 1 : 2;
    if (request.method == "POST") {
      response = updateWifiProfile(profileId, request.body);
    } else {
      response.status = 405;
      response.body = "{\"error\":\"method_not_allowed\"}";
    }
  } else if (
    request.path == "/api/espway/wifi/profile/1/test" ||
    request.path == "/api/espway/wifi/profile/2/test"
  ) {
    const uint8_t profileId = request.path.indexOf("/1/") >= 0 ? 1 : 2;
    if (request.method == "POST") {
      response = testWifiProfile(profileId);
    } else {
      response.status = 405;
      response.body = "{\"error\":\"method_not_allowed\"}";
    }
  } else if (request.path == "/api/ota/remote" && request.method == "POST") {
    response = scheduleRemoteOta(request.body);
  } else if (request.path == "/config") {
    response.contentType = "text/html";
    response.body = configPage();
  } else if (request.path == "/ota") {
    response.contentType = "text/html";
    response.body = otaPage();
  } else if (request.path == "/diagnostics") {
    response.contentType = "text/html";
    response.body = diagnosticsPage();
  } else {
    response.status = 404;
    response.contentType = "text/plain";
    response.body = "not found";
  }

  return response;
}

WebResponse ESPwayFramework::createEnrollment() {
  WebResponse response;
  if (!wifiManager.connected()) {
    response.status = 409;
    response.body = "{\"error\":\"wifi_not_connected\"}";
    return response;
  }
  if (config.deviceToken.length() != 64) {
    response.status = 503;
    response.body = "{\"error\":\"credential_unavailable\"}";
    return response;
  }
  stopTunnel(F("Enrollment request"), false);
  delay(1);
  const ESPwayEnrollmentResult result = ESPwayEnrollment::create({
    config.instanceUrl,
    deviceId,
    config.deviceName,
    ESPwayPlatform::hardwareId(),
    application->applicationId(),
    application->firmwareVersion(),
    ESPWAY_FRAMEWORK_VERSION,
    config.deviceToken,
  });
  nextTunnelAttemptAt = millis();
  if (!result.ok) {
    response.status = result.status > 0 ? result.status : 502;
    response.body = "{\"error\":\"" + jsonEscape(result.error) + "\"}";
    return response;
  }
  config.remoteDomain = result.baseDomain;
  normalizeConfiguration();
  store.save(config);
  response.status = 201;
  response.body = "{\"claimUrl\":\"" + jsonEscape(result.claimUrl) + "\"}";
  return response;
}

WebResponse ESPwayFramework::scheduleRemoteOta(const String& body) {
  WebResponse response;
  if (!remoteRequestActive || !hmacSession.authenticated()) {
    response.status = 403;
    response.body = "{\"error\":\"authenticated_tunnel_required\"}";
    return response;
  }

  if (remoteOtaState != RemoteOtaState::Idle) {
    response.status = 409;
    response.body = "{\"error\":\"remote_ota_already_pending\"}";
    return response;
  }

  String error;
  if (!ESPwayHttpOta::parseCommand(body, remoteHttpOtaCommand, error)) {
    response.status = 400;
    response.body = "{\"error\":\"" + error + "\"}";
    return response;
  }

  remoteOtaState = RemoteOtaState::Accepted;
  response.status = 202;
  response.body =
    "{\"status\":\"accepted\",\"tunnelDisconnect\":true}";
  return response;
}

void ESPwayFramework::handleRemoteOta() {
  if (remoteOtaState == RemoteOtaState::Accepted) {
    Serial.println(F("Remote OTA accepted"));
    Serial.println("OTA target version: " + remoteHttpOtaCommand.firmwareVersion);
    logHeap("Heap before WS close");

    // Prevent the normal loop from reconnecting until the OTA has finished.
    tunnelStarted = false;
    remoteOtaState = RemoteOtaState::WaitingForTunnel;
    if (tunnel.isConnected()) {
      tunnel.disconnect();
    }
    remoteOtaTunnelClosedAt = millis();
    return;
  }

  if (remoteOtaState == RemoteOtaState::WaitingForTunnel) {
    if (tunnel.isConnected()) {
      tunnel.loop();
      return;
    }

    if (millis() - remoteOtaTunnelClosedAt < TRANSPORT_RELEASE_GRACE_MS) {
      return;
    }

    tunnelConnected = false;
    Serial.println(F("WS resources released"));
    logHeap("Heap before HTTP OTA");
    mqttService.loop(false);
    remoteOtaState = RemoteOtaState::Downloading;
    String error;
    if (ESPwayHttpOta::download(remoteHttpOtaCommand, error)) {
      Serial.println(F("Remote HTTP OTA verified and installed"));
      remoteHttpOtaCommand = ESPwayHttpOtaCommand();
      restartAt = millis() + 1000;
    } else {
      failRemoteOta(error);
    }
    return;
  }

}

WebResponse ESPwayFramework::updateWifiProfile(
  uint8_t profileId,
  const String& body
) {
  WebResponse response;
  JsonDocument document;
  if (deserializeJson(document, body)) {
    response.status = 400;
    response.body = "{\"error\":\"invalid_json\"}";
    return response;
  }

  const bool clear = document["delete"] | false;
  const bool enabled = document["enabled"] | false;
  const String ssid = document["ssid"] | "";
  const String password = document["password"] | "";
  String error;
  if (!wifiManager.saveProfile(
        profileId,
        enabled,
        ssid,
        password,
        clear,
        error
      )) {
    response.status = error == "cannot_clear_only_active_profile" ? 409 : 400;
    response.body = "{\"error\":\"" + error + "\"}";
    return response;
  }

  response.body = "{\"status\":\"saved\",\"profileId\":" +
                  String(profileId) + "}";
  return response;
}

WebResponse ESPwayFramework::testWifiProfile(uint8_t profileId) {
  WebResponse response;
  String error;
  if (!wifiManager.scheduleTest(profileId, error)) {
    response.status = error == "test_already_in_progress" ? 409 : 400;
    response.body = "{\"error\":\"" + error + "\"}";
    return response;
  }
  response.status = 202;
  response.body =
    "{\"status\":\"accepted\",\"targetProfile\":" +
    String(profileId) + ",\"connectionWillClose\":true}";
  return response;
}

String ESPwayFramework::wifiStatusJson() const {
  String result;
  result.reserve(480);
  result = "{\"connected\":" + boolJson(wifiManager.connected());
  result += ",\"activeProfile\":" + String(wifiManager.activeProfile());
  result += ",\"lastKnownGoodProfile\":" +
            String(wifiManager.lastKnownGoodProfile());
  result += ",\"ip\":\"" + WiFi.localIP().toString() + "\"";
  result += ",\"rssi\":" + String(wifiManager.connected() ? WiFi.RSSI() : 0);
  result += ",\"apActive\":" + boolJson(wifiManager.apActive());
  result += ",\"testInProgress\":" +
            boolJson(wifiManager.testInProgress());
  result += ",\"profiles\":[";
  for (uint8_t index = 0; index < 2; ++index) {
    if (index != 0) {
      result += ',';
    }
    const ESPwayWiFiProfile& profile = config.wifiProfiles[index];
    const uint8_t profileId = index + 1;
    result += "{\"id\":" + String(profileId);
    result += ",\"enabled\":" + boolJson(profile.enabled);
    result += ",\"ssid\":\"" + jsonEscape(profile.ssid) + "\"";
    result += ",\"configured\":" + boolJson(profile.configured());
    result += ",\"active\":" +
              boolJson(wifiManager.activeProfile() == profileId) + "}";
  }
  result += "]}";
  return result;
}

WebResponse ESPwayFramework::updateMqttConfiguration(const String& body) {
  WebResponse response;
  JsonDocument document;
  if (deserializeJson(document, body)) {
    response.status = 400;
    response.body = "{\"error\":\"invalid_json\"}";
    return response;
  }

  ESPwayMqttConfig updated = config.mqtt;
  if (document["enabled"].is<bool>()) {
    updated.enabled = document["enabled"];
  }
  if (document["host"].is<const char*>()) {
    updated.host = document["host"].as<String>();
  }
  if (document["port"].is<uint16_t>()) {
    updated.port = document["port"];
  }
  if (document["username"].is<const char*>()) {
    updated.username = document["username"].as<String>();
  }
  if (document["baseTopic"].is<const char*>()) {
    updated.baseTopic = document["baseTopic"].as<String>();
  }
  if (document["password"].is<const char*>()) {
    const String password = document["password"].as<String>();
    if (!password.isEmpty()) updated.password = password;
  }
  if (document["clearPassword"] | false) {
    updated.password = "";
  }
  updated.host.trim();
  updated.username.trim();
  updated.baseTopic.trim();
  if ((updated.enabled && updated.host.isEmpty()) || updated.port == 0 ||
      updated.host.length() > 128 ||
      updated.username.length() > 64 || updated.password.length() > 64 ||
      updated.baseTopic.length() > 128 || updated.baseTopic.indexOf('#') >= 0 ||
      updated.baseTopic.indexOf('+') >= 0 || updated.baseTopic.startsWith("/")) {
    response.status = 400;
    response.body = "{\"error\":\"invalid_mqtt_configuration\"}";
    return response;
  }
  const ESPwayMqttConfig previous = config.mqtt;
  config.mqtt = updated;
  if (!store.save(config)) {
    config.mqtt = previous;
    response.status = 500;
    response.body = "{\"error\":\"save_failed\"}";
    return response;
  }
  mqttService.configurationChanged();
  response.body = mqttStatusJson();
  return response;
}

String ESPwayFramework::mqttStatusJson() {
  return "{\"enabled\":" + boolJson(config.mqtt.enabled) +
    ",\"host\":\"" + jsonEscape(config.mqtt.host) +
    "\",\"port\":" + String(config.mqtt.port) +
    ",\"username\":\"" + jsonEscape(config.mqtt.username) +
    "\",\"passwordConfigured\":" + boolJson(!config.mqtt.password.isEmpty()) +
    ",\"baseTopic\":\"" + jsonEscape(mqttService.baseTopic()) +
    "\",\"connected\":" + boolJson(mqttService.connected()) + "}";
}

void ESPwayFramework::failRemoteOta(const String& reason) {
  Serial.println("Remote OTA failed: " + reason);
  Serial.println("Heap after OTA failure: " + String(ESPwayPlatform::freeHeap()));
  remoteHttpOtaCommand = ESPwayHttpOtaCommand();
  remoteOtaState = RemoteOtaState::Idle;
  tunnelStarted = false;
}


void ESPwayFramework::logHeap(const String& label) const {
  Serial.println(
    label + ": free=" + String(ESPwayPlatform::freeHeap()) +
    ", maxBlock=" + String(ESPwayPlatform::maxFreeBlock()) +
    ", fragmentation=" + String(ESPwayPlatform::heapFragmentation()) + "%"
  );
}


String ESPwayFramework::statusJson() const {
  return "{\"deviceName\":\"" + jsonEscape(config.deviceName) +
    "\",\"deviceId\":\"" + deviceId +
    "\",\"wifi\":{\"connected\":" + boolJson(WiFi.status() == WL_CONNECTED) +
    ",\"ip\":\"" + WiFi.localIP().toString() +
    "\"},\"remote\":{\"connected\":" + boolJson(tunnelConnected) +
    ",\"transport\":\"" +
    String("ws-hmac") +
    "\",\"tunnelProtocol\":\"" +
    String(TUNNEL_PROTOCOL_V2) +
    "\"" +
    "},\"firmwareVersion\":\"" +
    jsonEscape(application->firmwareVersion()) + "\"}";
}

void ESPwayFramework::connectTunnel() {
  heapBeforeTunnel = ESPwayPlatform::freeHeap();
  maxBlockBeforeTunnel = ESPwayPlatform::maxFreeBlock();
  fragmentationBeforeTunnel = ESPwayPlatform::heapFragmentation();
  tunnelStarted = true;
  tunnelAttemptStartedAt = millis();
  tunnel.onEvent([this](WStype_t type, uint8_t* payload, size_t length) {
    onTunnel(type, payload, length);
  });
  tunnel.setReconnectInterval(TUNNEL_RETRY_MS);

  const String hostname =
    tunnelHostname();
  Serial.println("Connecting authenticated WS tunnel v2:");
  Serial.println(hostname + ":" + String(TUNNEL_PORT));
  logHeap("Heap before WS handshake");
  tunnel.begin(hostname.c_str(), TUNNEL_PORT, "/tunnel");
}

void ESPwayFramework::stopTunnel(
  const __FlashStringHelper* reason,
  bool scheduleRetry
) {
  Serial.print(F("Stopping tunnel: "));
  Serial.println(reason);
  tunnel.disconnect();
  tunnelStarted = false;
  tunnelConnected = false;
  clearTunnelSession();
  if (scheduleRetry) {
    scheduleTunnelRetry();
  }
}

void ESPwayFramework::scheduleTunnelRetry() {
  nextTunnelAttemptAt = millis() + TUNNEL_RETRY_MS;
  Serial.printf_P(
    PSTR("Tunnel retry scheduled in %lu ms\n"),
    TUNNEL_RETRY_MS
  );
}

bool ESPwayFramework::tunnelRetryDue() const {
  return static_cast<long>(millis() - nextTunnelAttemptAt) >= 0;
}

void ESPwayFramework::onTunnel(WStype_t type, uint8_t* payload, size_t length) {
  if (type == WStype_DISCONNECTED) {
    if (streamOta.active()) streamOta.abort();
    for (RemoteStream& stream : streams) {
      if (stream.ota) {
        stream.used = false;
        stream.ota = false;
        stream.otaStarting = false;
        stream.otaSha256 = "";
        stream.otaProof = "";
      }
    }
    if (tunnelConnected) {
      Serial.println("Tunnel disconnected");
      if (remoteOtaState == RemoteOtaState::Idle) {
        Serial.println("Tunnel reconnecting...");
      }
    }
    tunnelConnected = false;
    tunnelStarted = false;
    clearTunnelSession();
    if (
      remoteOtaState == RemoteOtaState::Idle &&
      config.remoteEnabled && wifiManager.isNetworkReady()
    ) {
      scheduleTunnelRetry();
    }
    return;
  }

  if (type == WStype_CONNECTED) {
    Serial.println("WS transport connected; awaiting challenge");
    logHeap("Heap after WS handshake");
    return;
  }

  if (type == WStype_ERROR) {
    Serial.println("Authenticated WS connection failed");
    stopTunnel(
      F("WebSocket error"),
      remoteOtaState == RemoteOtaState::Idle &&
        config.remoteEnabled && wifiManager.isNetworkReady()
    );
    return;
  }

  if (type != WStype_TEXT) {
    return;
  }

  JsonDocument document;
  if (deserializeJson(document, payload, length)) {
    Serial.printf_P(
      PSTR("Tunnel JSON parse failed: length=%u heap=%u\n"),
      static_cast<unsigned int>(length),
      ESPwayPlatform::freeHeap()
    );
    tunnel.disconnect();
    return;
  }

  const String messageType = document["type"] | "";
  const String streamId = document["streamId"] | "";

  if (messageType == "challenge") {
    if (String(document["tunnelProtocol"] | "") != TUNNEL_PROTOCOL_V2) {
      Serial.println(F("Unexpected tunnel protocol in challenge"));
      tunnel.disconnect();
      return;
    }
    sendAuthentication(
      document["authProtocol"] | "",
      document["serverNonce"] | ""
    );
    return;
  }

  if (!hmacSession.verifyFrame(payload, length, document)) {
    Serial.println("Invalid signed tunnel frame; closing session");
    tunnel.disconnect();
    return;
  }

  if (messageType == "hello-ack") {
    if (
      String(document["tunnelProtocol"] | "") != TUNNEL_PROTOCOL_V2 ||
      !hmacSession.acceptHelloAck(document["authProtocol"] | "")
    ) {
      tunnel.disconnect();
      return;
    }
    sendHello();
    return;
  }

  if (messageType == "hello-verified") {
    if (String(document["tunnelProtocol"] | "") != TUNNEL_PROTOCOL_V2) {
      tunnel.disconnect();
      return;
    }
    tunnelConnected = true;
    heapAfterTunnel = ESPwayPlatform::freeHeap();
    maxBlockAfterTunnel = ESPwayPlatform::maxFreeBlock();
    fragmentationAfterTunnel = ESPwayPlatform::heapFragmentation();
    Serial.println("WS tunnel v2 metadata verified");
    logHeap("Heap after WS signed hello");
    return;
  }

  if (!hmacSession.authenticated()) {
    return;
  }

  if (messageType == "cancel") {
    RemoteStream* stream = findStream(streamId);
    if (stream != nullptr) {
      if (stream->ota) streamOta.abort();
      stream->used = false;
      stream->ota = false;
      stream->otaStarting = false;
      stream->otaSha256 = "";
      stream->otaProof = "";
    }
    return;
  }

  if (messageType == "open") {
    openRemoteStream(document, streamId);
    return;
  }

  RemoteStream* stream = findStream(streamId);
  if (stream == nullptr) {
    return;
  }

  if (messageType == "data") {
    if (stream->ota) {
      const String encoded = document["data"] | "";
      constexpr size_t MAX_ENCODED_OTA_CHUNK =
        ((ESPwayStreamOta::DATA_CHUNK_SIZE + 2) / 3) * 4;
      if (encoded.length() > MAX_ENCODED_OTA_CHUNK) {
        Serial.println(F("OTA stream rejected: encoded chunk too large"));
        return failOtaStream(*stream, "ota_chunk_too_large");
      }
      const int decodedLength = base64_decode_chars(
        encoded.c_str(), encoded.length(),
        reinterpret_cast<char*>(otaChunkBuffer)
      );
      if (decodedLength <= 0 ||
          static_cast<size_t>(decodedLength) > sizeof(otaChunkBuffer) ||
          !streamOta.write(
            otaChunkBuffer, static_cast<size_t>(decodedLength))) {
        Serial.println(F("OTA stream rejected: chunk write failed"));
        return failOtaStream(*stream, "ota_write");
      }
      sendFrame("{\"type\":\"ack\",\"streamId\":\"" + stream->id +
        "\",\"received\":" + String(streamOta.bytesWritten()) + "}");
      return;
    }
    if (stream->sensitive) {
      Serial.println(F("Plain data rejected for sensitive stream"));
      tunnel.disconnect();
      return;
    }
    const String encoded = document["data"] | "";
    const size_t capacity = base64_decode_expected_len(encoded.length()) + 1;
    std::unique_ptr<char[]> decoded(new char[capacity]);
    const int decodedLength = base64_decode_chars(
      encoded.c_str(),
      encoded.length(),
      decoded.get()
    );
    if (decodedLength > 0) {
      stream->body.concat(decoded.get(), decodedLength);
    }
  } else if (messageType == "close") {
    closeRemoteStream(*stream);
  }
}

void ESPwayFramework::sendHello() {
  const String message =
    "{\"type\":\"hello\",\"tunnelProtocol\":\"" +
    String(TUNNEL_PROTOCOL_V2) +
    "\",\"deviceId\":\"" + deviceId +
    "\",\"deviceName\":\"" + jsonEscape(config.deviceName) +
    "\",\"hardware\":\"" + String(ESPwayPlatform::hardwareId()) +
    "\",\"application\":\"" +
    jsonEscape(application->applicationId()) +
    "\",\"applicationVersion\":\"" +
    jsonEscape(application->firmwareVersion()) +
    "\",\"frameworkVersion\":\"" ESPWAY_FRAMEWORK_VERSION "\""
    ",\"otaMaxBytes\":" + String(ESPwayPlatform::otaMaxBytes()) +
    ",\"capabilities\":[\"aead-selective\",\"" +
    String(ESPwayPlatform::SENSITIVE_CIPHER_CAPABILITY) +
    "\",\"http-ota\",\"mqtt\"]}";
  sendFrame(message);
}

void ESPwayFramework::sendAuthentication(
  const String& authProtocol,
  const String& serverNonce
) {
  String deviceNonce;
  String mac;
  if (!hmacSession.beginAuthentication(
        deviceId,
        config.deviceToken,
        authProtocol,
        serverNonce,
        deviceNonce,
        mac
      )) {
    tunnel.disconnect();
    return;
  }
  const String message =
    "{\"type\":\"auth\",\"authProtocol\":\"" +
    String(ESPwayHmacSession::authenticationProtocol()) +
    "\",\"deviceId\":\"" + deviceId +
    "\",\"deviceNonce\":\"" + deviceNonce +
    "\",\"authMac\":\"" + mac + "\"}";
  tunnel.sendTXT(message.c_str(), message.length());
}

void ESPwayFramework::clearTunnelSession() {
  hmacSession.reset();
}

void ESPwayFramework::openRemoteStream(
  const JsonDocument& document,
  const String& streamId
) {
  const String method = document["method"] | "GET";
  const String path = document["path"] | "/";
  const bool sensitive = ESPwayAeadSession::isSensitiveRequest(method, path);
  const bool protectedPayload = document["sensitive"] | false;
  const bool hasAeadEnvelope = !document["aead"].isNull();
  if (sensitive != protectedPayload || sensitive != hasAeadEnvelope) {
    Serial.println(F("Sensitive tunnel policy mismatch"));
    tunnel.disconnect();
    return;
  }
  String protectedBody;
  if (sensitive && !ESPwayAeadSession::decrypt(
        hmacSession.receiveEncryptionKey(),
        hmacSession.receiveNoncePrefix(),
        hmacSession.lastReceivedSequence(),
        streamId,
        "open",
        method,
        path,
        document["aead"].as<JsonObjectConst>(),
        protectedBody
      )) {
    Serial.println(F("Sensitive tunnel payload rejected"));
    tunnel.disconnect();
    return;
  }
  for (RemoteStream& stream : streams) {
    if (!stream.used) {
      stream.used = true;
      stream.id = streamId;
      stream.method = method;
      stream.path = path;
      stream.sensitive = sensitive;
      stream.ota = method == "POST" && path == "/ota/upload";
      if (stream.ota) {
        stream.otaStarting = true;
        stream.otaSize = document["otaSize"] | 0;
        stream.otaSha256 = document["otaSha256"] | "";
        stream.otaProof = document["otaProof"] | "";
      }
      stream.body = sensitive ? protectedBody : "";
      return;
    }
  }

  sendFrame(
    "{\"type\":\"error\",\"streamId\":\"" + streamId +
    "\",\"code\":\"stream_limit\"}"
  );
}

void ESPwayFramework::closeRemoteStream(RemoteStream& stream) {
  if (stream.ota) {
    if (!streamOta.finish()) return failOtaStream(stream, "ota_validation");
    logOtaMetrics(F("remote"));
    sendFrame("{\"type\":\"open\",\"streamId\":\"" + stream.id +
      "\",\"status\":200,\"headers\":{\"content-type\":\"text/plain\"}}");
    sendFrame("{\"type\":\"data\",\"streamId\":\"" + stream.id +
      "\",\"data\":\"VXBkYXRlIFN1Y2Nlc3MhIFJlYm9vdGluZy4uLg==\"}");
    sendFrame("{\"type\":\"close\",\"streamId\":\"" + stream.id + "\"}");
    stream.used = false;
    stream.ota = false;
    stream.otaStarting = false;
    stream.otaSha256 = "";
    stream.otaProof = "";
    restartAt = millis() + 700;
    return;
  }
  String requestPath = stream.path;
  String requestQuery;
  const int queryOffset = requestPath.indexOf('?');
  if (queryOffset >= 0) {
    requestQuery = requestPath.substring(queryOffset + 1);
    requestPath.remove(queryOffset);
  }
  const WebRequest request {
    stream.method, requestPath, stream.body, requestQuery
  };
  remoteRequestActive = true;
  const WebResponse response = route(request);
  remoteRequestActive = false;

  sendFrame(
    "{\"type\":\"open\",\"streamId\":\"" + stream.id +
    "\",\"status\":" + String(response.status) +
    ",\"headers\":{\"content-type\":\"" + response.contentType + "\"}}"
  );

  for (size_t offset = 0;
       offset < response.body.length();
       offset += DATA_CHUNK_SIZE) {
    const String part = response.body.substring(
      offset,
      min(offset + DATA_CHUNK_SIZE, response.body.length())
    );
    sendFrame(
      "{\"type\":\"data\",\"streamId\":\"" + stream.id +
      "\",\"data\":\"" + base64::encode(part) + "\"}"
    );
    yield();
  }

  sendFrame("{\"type\":\"close\",\"streamId\":\"" + stream.id + "\"}");
  stream.used = false;
  stream.sensitive = false;
}

void ESPwayFramework::startPendingOtaStream() {
  for (RemoteStream& stream : streams) {
    if (!stream.used || !stream.ota || !stream.otaStarting) continue;
    stream.otaStarting = false;
    if (!streamOta.begin(
          otaAuthorization, config.deviceToken, deviceId,
          stream.otaSize, stream.otaSha256, stream.otaProof)) {
      return failOtaStream(stream, "ota_authorization");
    }
    stream.otaSha256 = "";
    stream.otaProof = "";
    sendFrame(
      "{\"type\":\"ack\",\"streamId\":\"" + stream.id +
      "\",\"received\":0}"
    );
    return;
  }
}

void ESPwayFramework::failOtaStream(RemoteStream& stream, const char* error) {
  streamOta.abort();
  sendFrame("{\"type\":\"open\",\"streamId\":\"" + stream.id +
    "\",\"status\":400,\"headers\":{\"content-type\":\"application/json\"}}");
  const String body = "{\"error\":\"" + String(error) + "\"}";
  sendFrame("{\"type\":\"data\",\"streamId\":\"" + stream.id +
    "\",\"data\":\"" + base64::encode(body) + "\"}");
  sendFrame("{\"type\":\"close\",\"streamId\":\"" + stream.id + "\"}");
  stream.used = false;
  stream.ota = false;
  stream.otaStarting = false;
  stream.otaSha256 = "";
  stream.otaProof = "";
}

void ESPwayFramework::logOtaMetrics(const __FlashStringHelper* path) const {
  Serial.print(F("OTA V2 "));
  Serial.print(path);
  Serial.print(F(" complete: durationMs="));
  Serial.print(streamOta.durationMs());
  Serial.print(F(" minHeap="));
  Serial.print(streamOta.minimumHeap());
  Serial.print(F(" minBlock="));
  Serial.print(streamOta.minimumBlock());
  Serial.print(F(" maxFragmentation="));
  Serial.println(streamOta.maximumFragmentation());
}

ESPwayFramework::RemoteStream* ESPwayFramework::findStream(const String& id) {
  for (RemoteStream& stream : streams) {
    if (stream.used && stream.id == id) {
      return &stream;
    }
  }
  return nullptr;
}

void ESPwayFramework::sendFrame(String message) {
  if (!hmacSession.signFrame(message)) {
    tunnel.disconnect();
    return;
  }
  tunnel.sendTXT(message.c_str(), message.length());
}

String ESPwayFramework::page() const {
  return htmlHead("ProgHard Link Device") +
    navigation() +
    "<h1>ProgHard Link Device</h1>"
    "<p>Device: " + config.deviceName + "</p>"
    "<p>Device ID: " + deviceId + "</p>"
    "<section><h2>ProgHard Link</h2><p>Instance: " + config.instanceUrl +
    "</p><button id='register-device' type='button'>Register this device in ProgHard Link</button>"
    "<p id='enrollment-status' class='muted'></p></section>"
    "<pre id='status'></pre>"
    "<p><a href='/config'>Configuration</a> | "
    "<a href='/ota'>OTA</a> | "
    "<a href='/diagnostics'>Diagnostics</a></p>"
    "<script>"
    "document.getElementById('register-device').onclick=async()=>{"
      "const b=document.getElementById('register-device'),s=document.getElementById('enrollment-status');"
      "b.disabled=true;s.textContent='Creating a secure registration...';"
      "try{const r=await fetch('/api/espway/enrollment',{method:'POST'});const j=await r.json();"
      "if(!r.ok)throw Error(j.error||'registration_failed');location.href=j.claimUrl}"
      "catch(e){s.textContent='Registration failed: '+e.message;b.disabled=false}};"
    "async function refresh(){"
      "const data=await fetch('/api/status').then(r=>r.json());"
      "if(data.remote&&data.remote.connected){"
        "const b=document.getElementById('register-device');"
        "b.textContent='Registered with ProgHard Link';b.disabled=true;"
        "document.getElementById('enrollment-status').textContent='This device is registered and connected.';"
      "}"
      "document.getElementById('status').textContent=JSON.stringify(data,null,2);"
    "}"
    "refresh();"
    "</script>" + htmlEnd();
}

String ESPwayFramework::navigation() const {
  static constexpr size_t MAX_APPLICATION_LINKS = 4;
  String result = "<nav><a href='/'>Device</a>";
  result.reserve(256);

  size_t count = 0;
  const ESPwayNavigationItem* items = application->navigationItems(count);
  count = min(count, MAX_APPLICATION_LINKS);
  for (size_t index = 0; items != nullptr && index < count; index++) {
    const char* label = items[index].label;
    const char* path = items[index].path;
    if (label == nullptr || path == nullptr || path[0] != '/') {
      continue;
    }

    bool safePath = true;
    for (size_t position = 0; path[position] != '\0'; position++) {
      const char character = path[position];
      if (
        !isalnum(static_cast<unsigned char>(character)) &&
        character != '/' && character != '-' &&
        character != '_' && character != '.'
      ) {
        safePath = false;
        break;
      }
    }
    if (!safePath) {
      continue;
    }

    String safeLabel = label;
    safeLabel.replace("&", "&amp;");
    safeLabel.replace("<", "&lt;");
    safeLabel.replace(">", "&gt;");
    safeLabel.replace("'", "&#39;");
    result += "<a href='" + String(path) + "'>" + safeLabel + "</a>";
  }

  result += "<a href='/config'>Configuration</a>"
            "<a href='/ota'>Advanced OTA</a>"
            "<a href='/diagnostics'>Diagnostics</a>";
  if (config.remoteEnabled) {
    result += "<a href='" + config.instanceUrl +
      "' target='_blank' rel='noopener'>Device Manager</a>";
  }
  result += "</nav>";
  return result;
}

String ESPwayFramework::setupPage() const {
  String options;
  const int networkCount = WiFi.scanNetworks();
  for (int index = 0; index < networkCount; index++) {
    options += "<option value='" + WiFi.SSID(index) + "'>";
  }
  WiFi.scanDelete();

  return htmlHead("ProgHard Link Setup") +
    "<h1>ProgHard Link Setup</h1>"
    "<p>Connect this device to Wi-Fi, then finish registration from its LAN page.</p>"
    "<form method='post' action='/setup/save'>"
    "<label>Device name<input name='deviceName' value='ProgHard Link Device'></label>"
    "<label>Wi-Fi name (SSID)<input name='wifiSsid' list='wifi-networks' maxlength='32' required></label>"
    "<datalist id='wifi-networks'>" + options + "</datalist>"
    "<label>Password<input name='wifiPassword' type='password' required></label>"
    "<label><input style='width:auto' type='checkbox' name='remoteEnabled' checked>"
    " Remote access</label>"
    "<label>ProgHard Link instance<input name='instanceUrl' type='url' required value='" +
      config.instanceUrl + "' placeholder='https://link.example.org'></label>"
    "<button>Save &amp; Restart</button></form>" + htmlEnd();
}

String ESPwayFramework::configPage() const {
  return htmlHead("Configuration") +
    navigation() +
    "<h1>Configuration</h1>" +
    String(FPSTR(NETWORK_CONFIG_UI)) +
    "<form method='post' action='/config/save'>"
    "<label>Device name<input name='deviceName' value='" +
      config.deviceName + "'></label>"
    "<label>Device ID<input value='" + deviceId + "' readonly></label>"
    "<label><input style='width:auto' type='checkbox' name='remoteEnabled'" +
      String(config.remoteEnabled ? " checked" : "") + "> Remote access</label>"
    "<label>ProgHard Link instance<input name='instanceUrl' type='url' required value='" +
      config.instanceUrl + "'></label>"
    "<p class='muted'>Device service domain: " + config.remoteDomain + "</p>"
    "<button>Save &amp; Restart</button></form>"
    "<form method='post' action='/restart'><button>Restart</button></form>"
    "<form method='post' action='/reset-wifi' "
    "onsubmit='return confirm(\"Reset Wi-Fi?\")'><button>Reset Wi-Fi</button></form>"
    "<form method='post' action='/factory-reset' "
    "onsubmit='return confirm(\"Factory reset?\")'><button>Factory Reset</button></form>" +
    htmlEnd();
}

String ESPwayFramework::otaPage() const {
  return htmlHead("Advanced local OTA") +
    navigation() +
    "<h1>Advanced local OTA</h1>"
    "<p>For published firmware, use the Device Manager. This page is for a trusted local .bin file.</p>"
    "<p class='muted'>Authentication requires the device token created during registration. The token cannot be displayed or recovered; replace it in Configuration if it is lost.</p>"
    "<p>Current firmware: " + String(application->firmwareVersion()) + "</p>"
    "<form id='ota-form'>"
    "<label>Device token<input id='ota-token' type='password' autocomplete='off' required></label>"
    "<label>Firmware<input id='ota-file' type='file' name='update' accept='.bin' required></label>"
    "<button id='ota-submit'>Verify &amp; install</button></form>"
    "<pre id='ota-status'></pre><script>" +
    FPSTR(ESPWAY_OTA_WEB_CRYPTO) + R"ESPWAY_JS(
const otaForm=document.querySelector('#ota-form');
const otaStatus=document.querySelector('#ota-status');
otaForm.addEventListener('submit',async event=>{
  event.preventDefault();
  const button=document.querySelector('#ota-submit');
  const file=document.querySelector('#ota-file').files[0];
  const token=document.querySelector('#ota-token').value;
  if(!file||!token)return;
  button.disabled=true;
  try{
    otaStatus.textContent='1/4 Checking firmware integrity...';
    const firmware=new Uint8Array(await file.arrayBuffer());
    const digest=ESPwayOtaCrypto.hex(ESPwayOtaCrypto.sha256(firmware));
    otaStatus.textContent='2/4 Authenticating this update...';
    const challengeResponse=await fetch('/api/ota/challenge',{cache:'no-store'});
    if(!challengeResponse.ok)throw Error(await challengeResponse.text());
    const challenge=await challengeResponse.json();
    const status=await fetch('/api/status',{cache:'no-store'}).then(r=>r.json());
    const proof=ESPwayOtaCrypto.hex(ESPwayOtaCrypto.otaProof(
      token,status.deviceId,challenge.nonce,file.size,digest));
    const body=new FormData();body.append('update',file,file.name);
    otaStatus.textContent='3/4 Uploading firmware. Keep this page open...';
    const response=await fetch('/ota/upload',{method:'POST',headers:{
      'X-ESPway-OTA-Size':String(file.size),'X-ESPway-OTA-SHA256':digest,
      'X-ESPway-OTA-Proof':proof},body});
    const responseText=await response.text();
    if(!response.ok)throw Error(responseText);
    otaStatus.textContent='4/4 Update accepted. The device is restarting...';
    document.querySelector('#ota-token').value='';
    let online=false;
    for(let attempt=0;attempt<24&&!online;attempt++){
      await new Promise(resolve=>setTimeout(resolve,2500));
      try{online=(await fetch('/api/status',{cache:'no-store'})).ok}catch(ignore){}
    }
    otaStatus.textContent=online?'Update complete. The device is back online.':'Update sent. The device has not reconnected yet; reload this page in a moment.';
  }catch(error){otaStatus.textContent='OTA failed: '+error.message}
  finally{button.disabled=false}
});
)ESPWAY_JS" + String("</script>") + htmlEnd();
}

String ESPwayFramework::diagnosticsPage() const {
  return htmlHead("Diagnostics") +
    navigation() +
    "<h1>Diagnostics</h1>"
    "<p>Device: " + deviceId + "</p>"
    "<p>Free heap: " + String(ESPwayPlatform::freeHeap()) + " bytes</p>"
    "<p>Max free block: " + String(ESPwayPlatform::maxFreeBlock()) + " bytes</p>"
    "<p>Heap fragmentation: " + String(ESPwayPlatform::heapFragmentation()) + "%</p>"
    "<p>Before tunnel: free=" + String(heapBeforeTunnel) +
      ", maxBlock=" + String(maxBlockBeforeTunnel) +
      ", fragmentation=" + String(fragmentationBeforeTunnel) + "%</p>"
    "<p>After tunnel auth: free=" + String(heapAfterTunnel) +
      ", maxBlock=" + String(maxBlockAfterTunnel) +
      ", fragmentation=" + String(fragmentationAfterTunnel) + "%</p>"
    "<p>Uptime: " + String(millis() / 1000) + " s</p>"
    "<p>Reset: " + ESPwayPlatform::resetReason() + "</p>"
    "<p>WiFi IP: " + WiFi.localIP().toString() + "</p>"
    "<p>WiFi RSSI: " + String(WiFi.RSSI()) + " dBm</p>"
    "<p>Remote connected: " + String(tunnelConnected ? "yes" : "no") +
    "</p>"
    "<p>Transport: " +
      String("ws-hmac") + "</p>"
    "<p>Tunnel protocol: " +
      String(TUNNEL_PROTOCOL_V2) +
      "</p>" + htmlEnd();
}

bool ESPwayFramework::normalizeConfiguration() {
  const String previousDomain = config.remoteDomain;
  const String previousInstanceUrl = config.instanceUrl;
  const uint16_t previousVersion = config.configVersion;
  const uint8_t previousLastKnownGood =
    config.lastKnownGoodWifiProfile;
  bool wifiChanged = false;

  for (ESPwayWiFiProfile& profile : config.wifiProfiles) {
    if (profile.ssid.length() == 0 && profile.enabled) {
      profile.enabled = false;
      wifiChanged = true;
    }
  }
  if (
    !ESPwayWiFiManager::validProfileId(config.lastKnownGoodWifiProfile) ||
    !config.wifiProfiles[config.lastKnownGoodWifiProfile - 1].configured()
  ) {
    config.lastKnownGoodWifiProfile =
      config.wifiProfiles[0].configured() ? 1 :
      config.wifiProfiles[1].configured() ? 2 : 0;
  }

  config.remoteDomain.trim();
  config.remoteDomain.toLowerCase();

  if (config.remoteDomain.startsWith("https://")) {
    config.remoteDomain.remove(0, 8);
  } else if (config.remoteDomain.startsWith("http://")) {
    config.remoteDomain.remove(0, 7);
  }

  while (config.remoteDomain.endsWith("/")) {
    config.remoteDomain.remove(config.remoteDomain.length() - 1);
  }

  const String ownHostnamePrefix = deviceId + ".";
  if (config.remoteDomain.startsWith(ownHostnamePrefix)) {
    config.remoteDomain.remove(0, ownHostnamePrefix.length());
  }

  if (config.remoteDomain.length() == 0) {
    config.remoteDomain = ESPWAY_DEFAULT_DOMAIN;
  }

  config.instanceUrl.trim();
  while (config.instanceUrl.endsWith("/")) {
    config.instanceUrl.remove(config.instanceUrl.length() - 1);
  }
  if (!ESPwayEnrollment::validInstanceUrl(config.instanceUrl)) {
    config.instanceUrl = ESPWAY_DEFAULT_INSTANCE_URL;
  }

  config.configVersion = ESPWAY_CONFIG_VERSION;
  return previousVersion != config.configVersion ||
         previousDomain != config.remoteDomain ||
         previousInstanceUrl != config.instanceUrl ||
         previousLastKnownGood != config.lastKnownGoodWifiProfile ||
         wifiChanged;
}

String ESPwayFramework::remoteHostname() const {
  return deviceId + "." + config.remoteDomain;
}

String ESPwayFramework::tunnelHostname() const {
  return "tunnel." + config.remoteDomain;
}

String ESPwayFramework::remoteUrl() const {
  const String scheme = config.remotePort == 443 ? "https://" : "http://";
  const String port =
    config.remotePort == 443 ? "" : ":" + String(config.remotePort);
  return scheme + remoteHostname() + port + "/";
}

String ESPwayFramework::jsonEscape(const String& value) const {
  String escaped;
  for (const char character : value) {
    if (character == '"' || character == '\\') {
      escaped += '\\';
    }
    if (static_cast<uint8_t>(character) >= 32) {
      escaped += character;
    }
  }
  return escaped;
}

String ESPwayFramework::boolJson(bool value) const {
  return value ? "true" : "false";
}
