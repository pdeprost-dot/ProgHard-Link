#include "ESPwayEnrollment.h"

#include <ArduinoJson.h>
#include <ctype.h>
#include <time.h>

#if defined(ESP8266)
#include <ESP8266HTTPClient.h>
#include <WiFiClientSecureBearSSL.h>
#else
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#endif

namespace {

const char ISRG_ROOT_X1[] PROGMEM = R"CERT(-----BEGIN CERTIFICATE-----
MIIFazCCA1OgAwIBAgIRAIIQz7DSQONZRGPgu2OCiwAwDQYJKoZIhvcNAQELBQAw
TzELMAkGA1UEBhMCVVMxKTAnBgNVBAoTIEludGVybmV0IFNlY3VyaXR5IFJlc2Vh
cmNoIEdyb3VwMRUwEwYDVQQDEwxJU1JHIFJvb3QgWDEwHhcNMTUwNjA0MTEwNDM4
WhcNMzUwNjA0MTEwNDM4WjBPMQswCQYDVQQGEwJVUzEpMCcGA1UEChMgSW50ZXJu
ZXQgU2VjdXJpdHkgUmVzZWFyY2ggR3JvdXAxFTATBgNVBAMTDElTUkcgUm9vdCBY
MTCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoCggIBAK3oJHP0FDfzm54rVygc
h77ct984kIxuPOZXoHj3dcKi/vVqbvYATyjb3miGbESTtrFj/RQSa78f0uoxmyF+
0TM8ukj13Xnfs7j/EvEhmkvBioZxaUpmZmyPfjxwv60pIgbz5MDmgK7iS4+3mX6U
A5/TR5d8mUgjU+g4rk8Kb4Mu0UlXjIB0ttov0DiNewNwIRt18jA8+o+u3dpjq+sW
T8KOEUt+zwvo/7V3LvSye0rgTBIlDHCNAymg4VMk7BPZ7hm/ELNKjD+Jo2FR3qyH
B5T0Y3HsLuJvW5iB4YlcNHlsdu87kGJ55tukmi8mxdAQ4Q7e2RCOFvu396j3x+UC
B5iPNgiV5+I3lg02dZ77DnKxHZu8A/lJBdiB3QW0KtZB6awBdpUKD9jf1b0SHzUv
KBds0pjBqAlkd25HN7rOrFleaJ1/ctaJxQZBKT5ZPt0m9STJEadao0xAH0ahmbWn
OlFuhjuefXKnEgV4We0+UXgVCwOPjdAvBbI+e0ocS3MFEvzG6uBQE3xDk3SzynTn
jh8BCNAw1FtxNrQHusEwMFxIt4I7mKZ9YIqioymCzLq9gwQbooMDQaHWBfEbwrbw
qHyGO0aoSCqI3Haadr8faqU9GY/rOPNk3sgrDQoo//fb4hVC1CLQJ13hef4Y53CI
rU7m2Ys6xt0nUW7/vGT1M0NPAgMBAAGjQjBAMA4GA1UdDwEB/wQEAwIBBjAPBgNV
HRMBAf8EBTADAQH/MB0GA1UdDgQWBBR5tFnme7bl5AFzgAiIyBpY9umbbjANBgkq
hkiG9w0BAQsFAAOCAgEAVR9YqbyyqFDQDLHYGmkgJykIrGF1XIpu+ILlaS/V9lZL
ubhzEFnTIZd+50xx+7LSYK05qAvqFyFWhfFQDlnrzuBZ6brJFe+GnY+EgPbk6ZGQ
3BebYhtF8GaV0nxvwuo77x/Py9auJ/GpsMiu/X1+mvoiBOv/2X/qkSsisRcOj/KK
NFtY2PwByVS5uCbMiogziUwthDyC3+6WVwW6LLv3xLfHTjuCvjHIInNzktHCgKQ5
ORAzI4JMPJ+GslWYHb4phowim57iaztXOoJwTdwJx4nLCgdNbOhdjsnvzqvHu7Ur
TkXWStAmzOVyyghqpZXjFaH3pO3JLF+l+/+sKAIuvtd7u+Nxe5AW0wdeRlN8NwdC
jNPElpzVmbUq4JUagEiuTDkHzsxHpFKVK7q4+63SM1N95R1NbdWhscdCb+ZAJzVc
oyi3B43njTOQ5yOf+1CceWxG1bQVs5ZufpsMljq4Ui0/1lvh+wjChP4kqKOJ2qxq
4RgqsahDYVvTH9w7jXbyLeiNdd8XM2w9U/t7y0Ff/9yi0GE44Za4rF2LN9d11TPA
mRGunUHBcnWEvgJBQl9nJEiU0Zsnvgc/ubhPgXRR4Xq37Z0j4r7g1SgEEzwxA57d
emyPxgcYxn/eR44/KJ4EBs+lVDR3veyJm+kXQ99b21/+jh5Xos1AnX5iItreGCc=
-----END CERTIFICATE-----
)CERT";

bool clockReady() {
  if (time(nullptr) > 1700000000) return true;
  configTime(0, 0, "pool.ntp.org", "time.cloudflare.com");
  const uint32_t started = millis();
  while (time(nullptr) <= 1700000000 && millis() - started < 10000) delay(100);
  return time(nullptr) > 1700000000;
}

}  // namespace

bool ESPwayEnrollment::validInstanceUrl(const String& value) {
  if (!value.startsWith("https://") || value.length() > 200) return false;
  const String host = value.substring(8);
  if (host.isEmpty() || host.indexOf('/') >= 0 || host.indexOf('@') >= 0 ||
      host.indexOf('#') >= 0 || host.indexOf('?') >= 0) return false;
  for (size_t index = 0; index < host.length(); ++index) {
    const char character = host[index];
    if (!(isalnum(character) || character == '.' || character == '-' ||
          character == ':')) return false;
  }
  return true;
}

ESPwayEnrollmentResult ESPwayEnrollment::create(
  const ESPwayEnrollmentRequest& request
) {
  ESPwayEnrollmentResult result;
  if (!validInstanceUrl(request.instanceUrl)) {
    result.error = F("invalid_instance_url");
    return result;
  }
  if (!clockReady()) {
    result.error = F("clock_unavailable");
    return result;
  }

  JsonDocument document;
  document["deviceId"] = request.deviceId;
  document["deviceName"] = request.deviceName;
  document["hardware"] = request.hardware;
  document["application"] = request.application;
  document["applicationVersion"] = request.applicationVersion;
  document["frameworkVersion"] = request.frameworkVersion;
  document["credential"] = request.credential;
  String body;
  serializeJson(document, body);

  String url = request.instanceUrl;
  while (url.endsWith("/")) url.remove(url.length() - 1);
  url += F("/api/enrollments");

#if defined(ESP8266)
  BearSSL::WiFiClientSecure client;
  BearSSL::X509List trustAnchor(ISRG_ROOT_X1);
  client.setTrustAnchors(&trustAnchor);
  client.setBufferSizes(4096, 1024);
#else
  WiFiClientSecure client;
  client.setCACert(ISRG_ROOT_X1);
#endif
  HTTPClient http;
  http.setTimeout(15000);
  if (!http.begin(client, url)) {
    result.error = F("connection_failed");
    return result;
  }
  http.addHeader(F("Content-Type"), F("application/json"));
  result.status = http.POST(body);
  const String response = http.getString();
  http.end();

  JsonDocument responseDocument;
  if (deserializeJson(responseDocument, response)) {
    result.error = result.status < 0
      ? HTTPClient::errorToString(result.status)
      : String(F("invalid_server_response"));
    return result;
  }
  if (result.status != 201) {
    result.error = responseDocument["error"] | "enrollment_rejected";
    return result;
  }
  result.claimUrl = responseDocument["claimUrl"] | "";
  result.baseDomain = responseDocument["baseDomain"] | "";
  const int claimPath = result.claimUrl.indexOf("/enroll/", 8);
  result.ok = claimPath > 8 &&
    validInstanceUrl(result.claimUrl.substring(0, claimPath)) &&
    result.baseDomain.length() > 0;
  if (!result.ok) result.error = F("invalid_server_response");
  return result;
}
