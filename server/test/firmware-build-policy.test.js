import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const firmwareRoot = new URL(
  "../../firmware/esp8266/libraries/ESPway/src/",
  import.meta.url,
);

const source = (name) => readFile(new URL(name, firmwareRoot), "utf8");

test("firmware exposes only tunnel v2", async () => {
  const framework = await source("ESPwayFramework.cpp");
  assert.doesNotMatch(framework, /ESPWAY_LEGACY_WSS|beginSslWithCA|espway-tunnel\/1|legacy-wss/);
  await assert.rejects(source("ESPwayBuild.h"));
});

test("firmware v2 uses the dedicated HTTP tunnel endpoint", async () => {
  const framework = await source("ESPwayFramework.cpp");
  assert.match(framework, /constexpr uint16_t TUNNEL_PORT = 80/);
  assert.match(framework, /return "tunnel\." \+ config\.remoteDomain/);
  assert.match(framework, /tunnel\.begin\(hostname\.c_str\(\), TUNNEL_PORT, "\/tunnel"\)/);
});

test("firmware v2 sends the required signed hello and exact capabilities", async () => {
  const framework = await source("ESPwayFramework.cpp");
  const platform = await source("ESPwayPlatform.cpp");
  const hello = framework.slice(
    framework.indexOf("void ESPwayFramework::sendHello()"),
    framework.indexOf("void ESPwayFramework::sendAuthentication"),
  );
  assert.match(hello, /tunnelProtocol/);
  assert.match(hello, /applicationVersion/);
  assert.match(hello, /ESPwayPlatform::hardwareId\(\)/);
  assert.doesNotMatch(hello, /"hardware":"esp8266"/);
  assert.match(hello, /aead-selective.*http-ota.*mqtt/s);
  assert.match(hello, /sendFrame\(message\)/);
  assert.doesNotMatch(hello.slice(hello.indexOf("#else")), /deviceToken/);
  assert.match(platform, /CONFIG_IDF_TARGET_ESP32C3[\s\S]*return "esp32-c3"/);
  assert.match(platform, /defined\(ESP8266\)[\s\S]*return "esp8266"/);
  assert.match(platform, /return "esp32"/);
});

test("first boot starts recovery Wi-Fi before application workloads", async () => {
  const framework = await source("ESPwayFramework.cpp");
  const begin = framework.slice(
    framework.indexOf("void ESPwayFramework::begin"),
    framework.indexOf("void ESPwayFramework::loop"),
  );
  assert.ok(begin.indexOf("wifiManager.begin") < begin.indexOf("application->begin"));
  assert.match(begin, /if \(hasWifiConfig\)[\s\S]*application->begin/);
  assert.match(begin, /Application startup deferred until provisioning/);
  assert.doesNotMatch(begin, /scanNetworks\(true\)/);
  const loop = framework.slice(
    framework.indexOf("void ESPwayFramework::loop"),
    framework.indexOf("void ESPwayFramework::registerRoutes"),
  );
  assert.match(loop, /if \(applicationStarted\) application->loop\(\)/);
});

test("enrollment uses the configured instance and keeps the machine credential out of the UI", async () => {
  const framework = await source("ESPwayFramework.cpp");
  const enrollment = await source("ESPwayEnrollment.cpp");
  const config = await source("ESPwayConfig.h");
  assert.match(framework, /config\.instanceUrl/);
  assert.match(framework, /Register this device in ProgHard Link/);
  assert.doesNotMatch(framework, /name='deviceToken'/);
  assert.match(enrollment, /request\.instanceUrl/);
  assert.match(enrollment, /client\.setTrustAnchors|client\.setCACert/);
  assert.doesNotMatch(enrollment, /setInsecure/);
  assert.match(config, /String instanceUrl/);
  assert.match(config, /ESPWAY_DEFAULT_DOMAIN = "link\.proghard\.com"/);
  assert.match(config, /https:\/\/admin\.link\.proghard\.com/);
  assert.doesNotMatch(config, /(?:admin\.)?espway\.proghard\.com/);
});

test("provisioning uses public branding and captive HTTP fallbacks", async () => {
  const framework = await source("ESPwayFramework.cpp");
  const config = await source("ESPwayConfig.h");
  assert.match(framework, /ProgHard Link Setup/);
  assert.match(framework, /ProgHard Link Device/);
  assert.doesNotMatch(framework, /ESPway Setup|ESPway Demo/);
  assert.match(
    framework,
    /provisioning && request\.method == "GET"[\s\S]*response\.body = setupPage\(\)/,
  );
  assert.match(config, /String deviceName = "ProgHard Link Device"/);
});

test("connected devices replace the enrollment action with registered state", async () => {
  const framework = await source("ESPwayFramework.cpp");
  assert.match(framework, /data\.remote&&data\.remote\.connected/);
  assert.match(framework, /Registered with ProgHard Link/);
  assert.match(framework, /This device is registered and connected/);
});

test("firmware v2 sends no metadata before authenticated framing", async () => {
  const framework = await source("ESPwayFramework.cpp");
  const authentication = framework.slice(
    framework.indexOf("void ESPwayFramework::sendAuthentication"),
    framework.indexOf("void ESPwayFramework::clearTunnelSession"),
  );
  assert.match(authentication, /deviceId/);
  assert.match(authentication, /deviceNonce/);
  assert.match(authentication, /authMac/);
  assert.doesNotMatch(authentication, /deviceName|hardware|applicationVersion|capabilities/);
});

test("firmware waits for signed hello verification before marking v2 connected", async () => {
  const framework = await source("ESPwayFramework.cpp");
  const helloAck = framework.slice(
    framework.indexOf('if (messageType == "hello-ack")'),
    framework.indexOf("if (!hmacSession.authenticated())"),
  );
  assert.match(helloAck, /sendHello\(\)/);
  assert.match(helloAck, /hello-verified/);
  assert.ok(
    helloAck.indexOf("hello-verified") < helloAck.indexOf("tunnelConnected = true"),
  );
});

test("firmware retains authenticated HTTP OTA", async () => {
  const otaHeader = await source("ESPwayHttpOta.h");
  const ota = await source("ESPwayHttpOta.cpp");
  assert.doesNotMatch(otaHeader, /ESPWAY_LEGACY_WSS|EXPERIMENTAL/);
  assert.match(ota, /url\.startsWith\("http:\/\/"\)/);
  assert.match(ota, /constantTimeEqual/);
});

test("firmware rejects missing or unexpected AEAD envelopes", async () => {
  const framework = await source("ESPwayFramework.cpp");
  assert.match(
    framework,
    /sensitive != protectedPayload \|\| sensitive != hasAeadEnvelope/,
  );
});

test("diagnostics identify the active transport without secrets", async () => {
  const framework = await source("ESPwayFramework.cpp");
  const diagnostics = framework.slice(
    framework.indexOf("String ESPwayFramework::diagnosticsPage()"),
    framework.indexOf("bool ESPwayFramework::normalizeConfiguration"),
  );
  assert.match(diagnostics, /ws-hmac/);
  assert.match(diagnostics, /TUNNEL_PROTOCOL_V2/);
  assert.doesNotMatch(diagnostics, /deviceToken|mqtt.*password|authMac|Nonce/i);
});
