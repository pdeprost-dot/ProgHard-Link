# ESP32-C3 resource budget

Reference measurement for `PolarH10ProgHardLinkDemo` on the 4 MB ESP32-C3
(using a laboratory ESP32). The measured workload includes Polar H10 BLE/PMD ECG at
130 Hz, the SampleBlock V1 ring, LAN HTTP, browser polling through tunnel v2,
HTTPS WAN, and the existing plain-TCP MQTT service. Advanced ECG processing
and raw ECG over MQTT are deliberately out of scope.

## Build and partition

Measured from commit `5c37f1d` with Arduino CLI, board profile `ESP32C3 Dev
Module`, option `PartitionScheme=min_spiffs`, and the locally installed
Arduino-ESP32 core 3.3.6.

| Resource | Used | Capacity | Remaining |
| --- | ---: | ---: | ---: |
| Application flash | 1,618,912 B (82.34%) | 1,966,080 B | 347,168 B (17.66%) |
| Static/global RAM | 57,644 B (17.59%) | 327,680 B | 270,036 B |
| SPIFFS | - | 131,072 B | - |

The actual `min_spiffs.csv` layout has two OTA application slots of
`0x1e0000` bytes, a `0x20000` SPIFFS partition, and a `0x10000` coredump
partition. OTA remains available. The 270,036 B reported by the linker is not
runtime heap: the measured free heap before ESPway/BLE initialization is
about 215,116 B.

## Static and transient memory inventory

The ELF symbol table and source constants identify these main consumers:

| Consumer | Storage or bound | Notes |
| --- | ---: | --- |
| Polar client object | 8,288 B static | Includes permanent BLE/PMD client state; NimBLE controller/host allocations also consume runtime heap. |
| ECG ring object | 2,704 B static | 16 in-memory `SampleBlock` objects plus indices/counters and alignment. |
| ESPway framework object | 2,648 B static | Includes HTTP server, DNS, WebSocket, configuration, MQTT and permanent service state. |
| ECG builder | about 200 B static | One block under construction and sequence/session counters. |
| MQTT packet buffer | 256 B heap allocation | PubSubClient `setBufferSize(256)`; maximum four subscription descriptors. |
| ECG HTTP response | up to about 680 B heap body | Four serialized 166 B framed blocks plus the 24 B response header. |
| ECG HTTP temporaries | about 820 B stack | Four native blocks, one 164 B serialization buffer, and the response header. |
| Tunnel response chunk | 768 B maximum chunk | Base64/WebSocket framing adds transient strings and library buffers. |
| Stream OTA buffer | 512 B static | Permanent chunk buffer; OTA has additional transient update/TLS costs when used. |
| HMAC session | at least 136 B key material | Four 32 B keys plus nonce prefixes and counters; signed input is bounded to 4,096 B. |
| Configuration/JSON | dynamic, request-dependent | Arduino `String` and ArduinoJson allocations are transient and visible in runtime minima/fragmentation. |
| Wi-Fi, TCP/IP, NimBLE, WebSocket | dynamic | Library-owned allocations dominate the difference between boot heap and steady-state heap. |

The ring calculation is:

```text
16 blocks x 164 bytes native SampleBlock = 2,624 bytes
+ indices, counters and alignment       =    80 bytes
ring object measured in ELF             = 2,704 bytes
```

## Runtime reference

The system ran for 606 seconds. A sample was taken approximately every ten
seconds while LAN diagnostics and Polar APIs were read and up to four ECG
blocks were fetched over HTTPS WAN. The WAN browser oscilloscope and normal
MQTT publications were active. There were 56 valid samples.

| Metric | Result |
| --- | ---: |
| Free heap at first sample | 76,116 B |
| Mean free heap | 75,200 B |
| Minimum free heap | 64,828 B |
| Maximum sampled free heap | 76,152 B |
| Minimum largest free block | 51,188 B |
| Mean largest free block | 55,211 B |
| Maximum fragmentation | 27% |
| Mean fragmentation | 26.1% |

Across this run, Polar, MQTT and WAN availability failures were all zero.
The ECG rate stayed at 130 Hz and `ecgDropped` stayed unchanged at 803. That
counter was inherited from an earlier controlled reconnection and did not
increase during the reference run. No panic, watchdog, or unexpected reset
was observed. Task stack high-water marks are not exposed by the current
firmware, so they were not measured; no profiling instrumentation was added.

## Load scenarios

| Scenario | Free heap | Minimum heap | Largest block | Fragmentation | Remarks |
| --- | ---: | ---: | ---: | ---: | --- |
| A - connected, WAN plot paused | 76,406 B mean | 74,600 B | 55,284 B | 27% max | BLE/PMD, Wi-Fi, tunnel and MQTT remain connected. |
| B - WAN browser polling | 76,794 B mean | 74,608 B | 55,284 B | 25% max | Live 130 Hz browser trace. |
| C - LAN + WAN polling | 75,200 B mean | 64,828 B | 51,188 B | 27% max | 606 s reference run; includes short-lived simultaneous request allocations. |
| D - normal MQTT active | 79,820 B snapshot | - | 69,620 B | 12% | Existing retained status/HR and non-retained RR publications. |
| E - tunnel/ESP reconnect | 79,496 B before, 79,980 B after | - | 63,476 B before, 65,524 B after | 20% before, 17% after | Controlled restart; Wi-Fi, tunnel, Polar and MQTT all recovered. |
| F - MQTT reconnect | 79,820 B before, 81,604 B disabled, 79,124 B reconnected | - | 69,620 B before, 63,476 B after | 12-22% | Reversible disable/enable through the existing API; reconnection succeeded. |

Scenario snapshots are not directly comparable with the ten-minute minima:
network allocations are asynchronous. The conservative budget therefore uses
the lowest value observed under concurrent load, not the highest snapshot.

## MQTT headroom

The measured steady-state cost of reconnecting the current MQTT service is
approximately 2.5 KiB when comparing the disabled and reconnected snapshots.
The present packet buffer is 256 B. Adding topics mostly costs flash for code
and payload construction plus small transient heap allocations; retained
delivery and Last Will do not create a retained-message store on the client.

Reserve **no more than 8 KiB of additional steady-state heap** for the next
plain-TCP MQTT increment without a new load test. This is enough for a modest
increase in topics, small commands/callbacks, and JSON payloads up to 512 B if
payloads are built one at a time and temporary `String` duplication is
avoided. Increasing PubSubClient from 256 B to 512 B should cost roughly its
256 B delta plus allocator overhead, but must still be verified in the full
workload.

Four subscriptions is the current hard limit. Raising it adds descriptor and
topic storage costs and should be done only for concrete commands. Moderate
publication rates should remain application-rate-limited. Raw ECG must not be
published over MQTT.

MQTT TLS is not covered by this budget. TLS can require tens of kilobytes of
transient heap and contiguous buffers. It must have a dedicated handshake,
reconnect, certificate, and concurrent BLE/WAN test before adoption; the
current 51 KiB minimum largest block must not be assumed sufficient.

## Safety budget

The following gates apply to future production builds under the complete
workload:

| Gate | Required value | Rationale |
| --- | ---: | --- |
| Normal free heap target | > 70 KiB | Current mean is 73.4 KiB and normal scenario minima are about 72.9 KiB; falling below 70 KiB indicates a material steady-state regression. |
| Absolute measured minimum heap | > 52 KiB | Leaves about 12.6 KiB below the 64.8 KiB measured concurrent-load minimum for short asynchronous allocation peaks. |
| Largest free block target | > 40 KiB | Leaves about 11 KiB below the measured 51.2 KiB minimum for contiguous network/JSON buffers. |
| Maximum fragmentation | < 35% | Current maximum is 27%; eight percentage points allow normal allocator variation while detecting degradation. |
| Free application flash | > 256 KiB | Current reserve is 339 KiB; this permits at most about 89 KiB further growth before the release gate and retains OTA slot compatibility. |
| New plain MQTT steady heap | <= 8 KiB | Preserves most of the measured transient reserve; remeasure after every material MQTT increment. |

A candidate that breaches any gate requires optimization or a new justified
budget before release. Heap minima must be measured with BLE, WAN browser,
LAN requests, MQTT, and reconnect paths active—not from an idle snapshot.

## Feature placement

### A - acceptable on ESP32

- A small number of additional MQTT state or metric topics.
- Small command subscriptions within a reviewed subscription limit.
- Simple counters, booleans, integer metrics, and compact JSON payloads.
- Existing retain, Last Will, reconnect, gateway, and buffering behavior.

### B - measure before adding

- Payloads above 512 B or several JSON documents alive concurrently.
- More than four subscriptions or high publication frequency.
- MQTT packet-buffer growth, batching, QoS-related library changes, or TLS.
- Additional BLE clients, larger rings, filesystem queues, or concurrent HTTP
  streams.
- Lightweight ECG-derived metrics, even if computation appears simple.

### C - externalize

- Advanced QRS analysis, heavy HRV, complex filtering, and FFT.
- Long-term ECG/history storage and analytics.
- Medical interpretation or processing.
- Historical visualization and cross-session aggregation.
- Raw ECG transport over MQTT.

The intended boundary remains:

```text
ESP32 = acquisition + buffer + transport + MQTT
server = analytics + history + heavy processing
```
