# QuadPzemWattmeter

Example for four PZEM-004T v3 meters sharing one 9600-baud Modbus link.

This example targets ESP8266/NodeMCU because it uses that core's
SoftwareSerial implementation and D-pin wiring convention. It compiles with
ESP8266 core 3.1.2. The implementation has not yet been validated with four
physical meters; compilation is not a claim of hardware validation.

## Wiring

- Wemos GPIO12 / D6 (RX) receives PZEM TX;
- Wemos GPIO14 / D5 (TX) drives PZEM RX;
- all four interfaces share a common ground;
- meters must already have Modbus addresses 1, 2, 3 and 4.

Check the voltage levels of the exact PZEM interface board before connecting it
to the 3.3 V ESP8266. Use suitable isolation or level conversion when required.
Mains wiring must remain isolated from the low-voltage side and be performed by
a qualified person.

## Interfaces

- dashboard: `GET /wattmeter`;
- all readings: `GET /api/wattmeter/status`;
- configuration: `GET|POST /api/wattmeter/config`;
- immediate cycle: `POST /api/wattmeter/read`.

The read interval is persisted in LittleFS and must be between 15,000 and
900,000 ms. MQTT broker settings and the base topic are configured on the
standard ESPway configuration page. The example's configurable topic is added
below that base topic and publishes one retained JSON document per meter on
`<baseTopic>/<configuredTopic>/1` through `/4`.
