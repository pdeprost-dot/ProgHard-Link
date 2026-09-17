# ProgHard Link MQTT V2

ProgHard Link provides one lightweight MQTT client shared by the framework and the
application. Applications do not create or manage PubSubClient themselves.
MQTT V2 uses plain TCP; MQTT TLS requires a separate resource validation.

## Configuration

Configure MQTT from the ProgHard Link configuration page or with
`POST /api/espway/mqtt`:

```json
{
  "enabled": true,
  "host": "broker.lan",
  "port": 1883,
  "username": "",
  "baseTopic": ""
}
```

An empty base topic selects `espway/<deviceId>`. Existing MQTT V1
configuration remains compatible. A password may be supplied on update but
is never returned by the status API.

## Arduino API

The application receives the service in its normal context:

```cpp
void begin(const ESPwayApplicationContext& context) override {
  mqtt = &context.mqtt;
  mqtt->publish("temperature", "21.6");
  mqtt->publish("relay/state", "ON", true);
}
```

A sketch that owns an `ESPwayFramework espway` can also use the equivalent
facade:

```cpp
espway.mqtt().publish("temperature", "21.6");
espway.mqtt().publish("relay/state", "ON", true);
```

Small typed payload helpers avoid application-side `String` objects:

```cpp
mqtt->publish("counter", uint32_t(42));
mqtt->publish("temperature", 21.6f, 1);
mqtt->publish("relay/state", true, true);
```

The last argument selects retained delivery. Retain state whose latest value
remains meaningful. Do not retain transient events.

## Commands and subscriptions

Topics are relative to the configured base topic. A callback receives the
relative topic, a borrowed payload pointer, and its exact length:

```cpp
static void onCommand(void* context, const char* topic,
                      const uint8_t* payload, size_t length) {
  // The payload is not required to be NUL terminated. Validate length first.
}

void begin(const ESPwayApplicationContext& context) override {
  context.mqtt.subscribe("relay/set", onCommand, this);
}
```

Exact command topics conventionally end in `/set`, for example
`espway/esp-a1b2c3/relay/set`. ProgHard Link stores at most four subscription
descriptors and restores them after every broker reconnect. The previous
payload-only callback signature remains supported for source compatibility.

## Topics and availability

The generic device topics are:

```text
<baseTopic>/status             online/offline, retained, with Last Will
<baseTopic>/system/uptime      seconds, retained, every 60 seconds
<baseTopic>/system/free_heap   bytes, retained, every 60 seconds
<baseTopic>/system/wifi_rssi   dBm, retained, every 60 seconds
<baseTopic>/system/ip          IPv4 text, retained, every 60 seconds
```

System metrics are also published immediately after connection. Applications
add their own feature topics below the same namespace. Polar, for example,
uses retained status, heart rate and ECG status, while each RR value is a
separate non-retained event.

## Bounds and resource rules

- Application payloads are limited to 512 bytes.
- Relative suffixes are limited to 96 characters and cannot contain MQTT
  wildcards.
- The 768-byte PubSubClient wire buffer accommodates a maximum payload plus
  the configured base topic, suffix, and MQTT framing.
- Publish payloads sequentially; avoid keeping multiple JSON documents alive.
- MQTT is for compact state, events and commands—not raw ECG samples or ECG
  blocks. ECG remains on SampleBlock V1 over HTTP polling.
- Current transport is MQTT over TCP. TLS is not implemented and requires a
  dedicated heap, certificate, handshake, and reconnect campaign.

See `examples/MqttDemo` for a minimal, non-destructive command round trip on
`demo/value/set` and the retained result on `demo/value`.

## Reference validation

MQTT V2 was validated on an ESP32-C3 against a private plain-TCP broker. The
test covered retained delivery, two identical
consecutive commands, Last Will `offline`, `online` after restart, restored
subscription handling, periodic system metrics, and a simulated unavailable
broker followed by recovery. The artificial retained `demo/value` was removed
from the broker after the test and PolarH10ProgHardLinkDemo was restored.

Relative to MQTT V1, the production Polar build changed from 1,618,912 to
1,620,134 bytes of application flash (+1,222 B), and from 57,644 to 58,044
bytes of globals (+400 B). The MQTT packet-buffer increase adds 512 B of heap,
so estimated permanent MQTT V2 growth is about 912 B. A five-minute concurrent
BLE/ECG/LAN/WAN/MQTT run measured 77,740 B mean free heap, 72,648 B minimum
free heap, a 59,380 B minimum largest block, 19% maximum fragmentation, and no
ECG drops or HTTP/SampleBlock continuity errors. These results remain within
all gates in `esp32-resource-budget.md`.
