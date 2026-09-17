# ESPway MQTT

MQTT is a generic ESPway service available to every application through
`ESPwayApplicationContext::mqtt`. It uses PubSubClient and is disabled by
default. Existing configuration files without an `mqtt` object continue to
load with MQTT disabled.

The ESPway configuration UI and `GET`/`POST /api/espway/mqtt` manage:

- `enabled`;
- broker `host` and `port` (default `1883`);
- optional `username` and `password`;
- optional `baseTopic`.

Passwords are accepted by the update endpoint but are never returned by the
status endpoint. If no base topic is configured, ESPway uses
`espway/<deviceId>`. Topic suffixes passed by applications are appended to
that base.

```cpp
class SensorApp : public ESPwayApplication {
  ESPwayMqttService* mqtt = nullptr;

  void begin(const ESPwayApplicationContext& context) override {
    mqtt = &context.mqtt;
    mqtt->subscribe("command/set", onCommand, this);
  }

  void loop() override {
    if (mqtt->connected()) {
      mqtt->publish("temperature", "21.5", true);
    }
  }
};
```

The MQTT V2 callback receives the relative topic and a borrowed, non-NUL
terminated payload:

```cpp
static void onCommand(void* context, const char* relativeTopic,
                      const uint8_t* payload, size_t length) {
  if (strcmp(relativeTopic, "command/set") != 0) return;
  // Validate length before reading payload.
}
```

Text, typed scalar and binary publish overloads are available. Binary payloads
use `publish(suffix, bytes, length, retained)` and are limited to 512 bytes;
the MQTT wire buffer is 768 bytes. `MqttDemo` is the canonical command/publish
example. Application state topics must not reuse the reserved generic
`<baseTopic>/status` availability topic.

ESPway waits for a stable Wi-Fi connection and retries broker connections at
five-second intervals without a blocking retry loop. The MQTT client ID is
`espway-<deviceId>`. Each connection sets a retained Last Will of `offline`
on `<baseTopic>/status`, then publishes retained `online` after connecting.
Subscriptions are restored after reconnecting.

MQTT currently uses a plain TCP connection. Applications should rate-limit
their own telemetry. The Polar ECG example demonstrates controlled binary
batching at approximately four non-retained QoS-0 messages per second.
