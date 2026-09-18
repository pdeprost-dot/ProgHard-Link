# ProgHard Link application development

This document is the development contract for ProgHard Link applications. It
describes the current public library APIs and separates current behavior from
future design direction.

## 1. Principle

ProgHard Link Base and `ESPwayFramework` provide the shared device services.
An `ESPwayApplication` provides the user-facing function: clock, thermostat,
sensor, actuator, acquisition or another workload.

An application implements `applicationId()`, `firmwareVersion()`, `begin()`,
`loop()` and `handle()`. It should reuse the framework rather than build a
parallel Wi-Fi, enrollment, tunnel, remote-access or OTA stack.

## 2. Services to reuse

| Concern | Framework service |
|---|---|
| Wi-Fi and recovery | Two managed profiles, fallback AP and `/config` |
| First setup | Captive provisioning and persistent `/config.json` |
| Identity | Stable chip-derived Device ID and ESP-generated Device Token |
| Enrollment | Verified HTTPS enrollment and authenticated user claim |
| Remote access | Authenticated `espway-tunnel/2` and per-device HTTPS hostname |
| HTTP | One `WebRequest`/`WebResponse` dispatcher for LAN and tunnel requests |
| Navigation | `ESPwayApplication::navigationItems()` |
| OTA | Framework-owned local upload and controlled remote OTA paths |
| Human/API authentication | Device Manager session, ownership and Personal API Tokens |
| MQTT | `ESPwayMqttService` supplied in `ESPwayApplicationContext` |

The Device Token is an internal machine credential. Applications must not ask
the user to enter it or expose it through pages, APIs, logs or diagnostics.

## 3. Application web pages

`ESPwayApplication::handle()` registers routes by recognizing the method and
path and returning `true`. Returning `false` lets the framework try its own
routes. `WebRequest` contains `method`, `path`, `body` and `query`;
`WebResponse` contains `status`, `contentType` and `body`.

Important pages must also be declared with `navigationItems()`. The framework
adds at most four valid application entries to the navigation rendered on its
own pages. Labels are HTML-escaped and paths must begin with `/` and contain
only alphanumeric characters, `/`, `-`, `_` or `.`.

The framework calls this navigation renderer on `/`, `/config`, `/ota` and
`/diagnostics`. It does not call it for the captive setup page and does not
modify HTML returned by `ESPwayApplication::handle()`. There is currently no
public helper that lets an application inject the complete framework navbar
into its own HTML. The recommended current pattern is therefore both to
declare the page with `navigationItems()` and to include concise links in the
application HTML to `/`, its own main page and relevant framework pages.

This uses the real API and navigation pattern from `DhtSensorDemo`, with the
recommended explicit GET check:

```cpp
bool DhtSensorApp::handle(
  const WebRequest& request,
  WebResponse& response
) {
  if (request.path == "/dht" && request.method == "GET") {
    response.contentType = "text/html";
    response.body = page();
    return true;
  }
  return false;
}

const ESPwayNavigationItem* DhtSensorApp::navigationItems(
  size_t& count
) const {
  static const ESPwayNavigationItem items[] = {
    {"DHT sensor", "/dht"},
  };
  count = sizeof(items) / sizeof(items[0]);
  return items;
}
```

The same handler serves LAN and remote requests. Application HTML is returned
as-is: the framework does not inject its navigation into an application page.
An application page should therefore include useful links back to `/` and the
relevant framework pages. A significant page must not remain a hidden URL.

Current navigation references are `DhtSensorDemo`, `ProgHardLinkBase`,
`ThermostatDemo`, `QuadPzemWattmeter`, `PolarH10ProgHardLinkDemo` and
`ClockDemo`.

## 4. Application APIs

Application APIs use the same `handle()` hook. Validate the method explicitly,
return `405` for a known route with the wrong method, validate all input, and
set an appropriate content type.

```cpp
bool DemoApplication::handle(
  const WebRequest& request,
  WebResponse& response
) {
  if (request.path != "/api/demo") return false;
  if (request.method != "GET") {
    response.status = 405;
    response.body = "{\"error\":\"method_not_allowed\"}";
    return true;
  }
  response.body = "{\"value\":42}";
  return true;
}
```

On the LAN, current application routes have no framework-provided human or PAT
authentication. Do not describe a LAN API as authenticated merely because the
remote path is protected. `WebRequest` currently carries no HTTP authorization
header for an application to inspect.

Remotely, the Node server authenticates the device hostname before forwarding
the request. Interactive browsers use the per-host device session established
by **My devices -> Open**. External clients use a Personal API Token:

```sh
curl -H "Authorization: Bearer <personal-api-token>" \
  https://<deviceId>.<domain>/api/demo
```

The proxy checks the PAT's user, enabled state and device ownership. The PAT is
not sent through the tunnel or exposed to the application. Useful references
are `ThermostatDemo` for multiple REST routes, `QuadPzemWattmeter` for validated
persistent configuration, `PolarH10ProgHardLinkDemo` for binary responses, and
`MqttDemo` for the framework MQTT service.

## 5. Credentials

| Credential | Purpose | Generated by | Stored where | Visible to user? | Used by | Rotation or revocation |
|---|---|---|---|---|---|---|
| Device Token / machine credential | Device enrollment, tunnel keys and OTA proof | ESP on first boot | ESP LittleFS `/config.json`; server `devices.json` | No during normal enrollment | ESP and server | No automatic rotation; factory erase creates a new token and the server record must be reconciled |
| User password | Human login | User/admin | Scrypt hash in `auth.sqlite` | Entered, never redisplayed | Device Manager | Password change/reset |
| User session | Authenticated Device Manager browser session | Server | Server memory; opaque host-only cookie in browser | Cookie is not script-readable | Admin hostname | Logout, expiry, password reset, disable/delete user |
| Access ticket | Transfer authorization from Device Manager to one device hostname | Server | Short-lived server memory | Submitted automatically, not a user credential | **Open device** flow | One use or 60-second expiry |
| Hostname device-session cookie | Browser access to one remote device hostname | Server | Server memory and host-only browser cookie | Not exposed by the UI | Remote browser requests | Expiry or user session invalidation |
| Personal API Token (PAT) | Non-interactive remote HTTPS API access | Server on user request | SHA-256 fingerprint in `auth.sqlite`; secret held by user/client | Shown exactly once at creation | curl, Python, Node-RED and other external clients | User revokes it in Device Manager |
| OTA operator token | Controlled legacy/operator Registry OTA endpoint | Instance operator | Server environment | Not part of normal user UX | `X-ESPway-Operator-Token` endpoint | Replace server secret |
| Enrollment token | Short-lived claim URL, distinct from Device Token | Server | Pending enrollment memory | Present in the claim URL | Enrollment browser flow | One use, replacement or expiry |
| OTA challenge/proof | One-update anti-replay authorization | ESP; proof currently by browser for `/ota` | Volatile only | Nonce is observable; proof is protocol data | OTA stream | One use or 60-second expiry |

A normal user obtains an application API credential in Device Manager under
**API tokens**. The created `espway_pat_...` secret is displayed exactly once;
the user must save it in the external client's secret storage. This is a PAT,
not the Device Token. The existing one-time display is intentional, although a
user who closes it must create another token.

The concrete flow is:

1. Sign in to the Device Manager.
2. Select **API tokens** in the main header (available to ordinary users and
   administrators).
3. Enter a descriptive name and select **Create token**.
4. Use **Copy token** and store the displayed `espway_pat_...` secret safely.
5. Confirm **I have saved this token** before closing the dialog.
6. Send it as `Authorization: Bearer <token>` to an owned device hostname.
7. Return to **API tokens** and select **Revoke** to invalidate it immediately.

Only its SHA-256 fingerprint, creation time, last-use time and revocation state
remain server-side. A lost PAT cannot be redisplayed; create a replacement and
revoke the old entry.

## 6. Persistence

Framework configuration is stored atomically in LittleFS `/config.json` and
contains Wi-Fi profiles, instance/domain, `remoteEnabled`, Device Token and MQTT
configuration. The Device ID is derived from the chip and is not stored there.

Applications must use a separate namespace or file and version their schema.
`ThermostatDemo` and `QuadPzemWattmeter` use separate atomic LittleFS files;
ESP32-C6 `ClockDemo` uses the NVS-backed `Preferences` namespace `clock-demo`.

| Operation | Device ID | Wi-Fi and framework settings | Device Token | Server enrollment/ownership | Application configuration | Requires claim? |
|---|---|---|---|---|---|---|
| Simple reboot | Same chip-derived ID | Preserved | Preserved | Preserved | Preserved | No |
| LAN or remote OTA | Same | Preserved | Preserved | Preserved | Preserved when the filesystem/NVS layout and schema remain compatible | No |
| USB application flash without erase | Same | Normally preserved | Normally preserved | Preserved | Normally preserved | No |
| Web Installer installation with full erase | Same on the same physical chip | Wi-Fi, instance, `remoteEnabled` and MQTT erased | Erased and regenerated | Old server record remains but no longer matches the new token | LittleFS and NVS erased | Yes, after reconciling the old record |
| Reset Wi-Fi | Same | Wi-Fi profiles cleared; instance, `remoteEnabled` and MQTT preserved | Preserved | Preserved | Preserved | No |
| Factory reset | Same | `/config.json` removed, so Wi-Fi, instance, `remoteEnabled` and MQTT return to defaults | Regenerated after reboot | Old server record remains but no longer matches | Separate current app files/NVS are not cleared by the framework | Yes, after reconciling the old record |

USB preservation assumes the same board and a compatible partition layout.
Changing partition tables, flashing a complete merged installation image or
using an erase option can overwrite LittleFS, NVS or OTA metadata even when the
operation is initiated over USB.

The operations that explain the previously observed re-enrollment are full
erase/reinstallation and framework factory reset: both remove `/config.json`
and therefore replace the Device Token. They do not normally change the Device
ID on the same board. The resulting new token conflicts with the still-enabled
server record for that Device ID, producing `device_already_registered` until
the old authorization is deliberately removed or otherwise reconciled. A
normal OTA or same-layout USB sketch upload does not cause this condition.

The official Web Installer is an installation/recovery path, not an application
update path. Its published ESP32 images are merged offset-zero images and the
documented user flow erases the device.

## 7. Identity rule

**Normal application firmware updates must preserve the ProgHard Link device
identity and enrollment.**

Installing a new application version must not generate a replacement Device
Token, remove ProgHard Link configuration, format LittleFS, trigger factory
reset or require a new claim. A new credential with the same chip-derived
Device ID causes `device_already_registered` until the old server authorization
is deliberately reconciled.

On ESP32 the framework currently calls `LittleFS.begin(true)`, so an actual
mount failure may format LittleFS. This recovery behavior is platform code, not
an application-update requirement.

## 8. OTA

### Current

- `/ota` accepts a trusted local `.bin` over LAN or the remote device hostname.
- Its browser UI currently asks for the Device Token to calculate a one-use
  HMAC proof.
- Remote multipart uploads are streamed through tunnel V2 in 512-byte chunks
  with one chunk in flight and an ACK before the next chunk.
- Device Manager accepts an Arduino-exported `.bin` without asking for the
  Device Token. Session, ownership and CSRF authorize the request; the server
  retrieves the private machine credential and computes the existing proof.
- Devices advertise `otaMaxBytes` from their next OTA partition. The server
  applies an 8 MiB operational ceiling and a 1 MiB conservative fallback for
  older firmware that does not advertise a capacity.
- Firmware Registry installation and the advanced LAN OTA path remain
  available.
- A successful update reboots and the device reconnects with the same stored
  identity. OTA does not erase LittleFS or NVS.

The implemented Device Manager path is:

```text
Device Manager -> choose .bin -> authenticated remote streaming OTA
-> no user-visible Device Token -> dynamic otaMaxBytes
-> verified write -> reboot -> reconnect -> ONLINE
```

It reuses the existing nonce/HMAC/SHA-256 proof and tunnel V2 streaming.

## 9. Application lifecycle

```text
Base installation and provisioning
-> enrollment and claim
-> application development
-> Arduino build/export
-> application firmware update without erase
-> reboot
-> same Device ID and Device Token
-> same enrollment and ownership
-> tunnel reconnects
-> ONLINE
```

Use the Web Installer with full erase for initial installation or intentional
recovery, not for routine application iteration.

## 10. New application checklist

- [ ] Uses the current official ProgHard Link library and `ESPwayApplication`.
- [ ] Does not duplicate Wi-Fi, provisioning, enrollment or tunnel services.
- [ ] Has stable application and firmware version identifiers.
- [ ] Declares every important page through `navigationItems()`.
- [ ] Application pages contain useful navigation back to framework pages.
- [ ] Routes validate method, input, bounds and response content type.
- [ ] LAN behavior and its authentication limitations are documented.
- [ ] Remote browser and PAT access are tested for intended APIs.
- [ ] No UI or API asks for or exposes the Device Token.
- [ ] Application configuration uses a separate, versioned namespace/file.
- [ ] Configuration remains compatible across normal OTA updates.
- [ ] OTA and USB iteration do not erase identity or require enrollment.
- [ ] Reboot restores the application and reconnects the tunnel.
- [ ] MQTT uses `ESPwayMqttService` and relative application topics.
- [ ] Blocking work does not starve `ESPwayFramework::loop()`.
- [ ] Memory, firmware size and partition capacity are measured.
- [ ] Hardware-specific code is isolated from generic application logic.
- [ ] A concise README documents board, dependencies, routes and validation.

## 11. Instructions for future Codex work

Before implementing a new ProgHard Link application:

1. Read this document and inspect the current library examples.
2. Reuse ProgHard Link services; do not invent parallel navigation,
   authentication, persistence, enrollment, tunnel or OTA systems.
3. Preserve Device ID, Device Token, provisioning and ownership across normal
   application updates.
4. Expose important pages through `navigationItems()` and implement routes with
   `handle()`.
5. Use Personal API Tokens for non-interactive remote application API clients;
   never request the Device Token from a user.
6. Keep application configuration separate and schema-versioned.
7. Keep hardware-specific code outside the generic framework and application
   logic where practical.
8. Modify ProgHard Link core only when a concrete framework limitation has
   been demonstrated against the current code.

## 12. Current example assessment

### ClockDemo

ClockDemo already declares `/clock` through `navigationItems()`, so the link is
present on framework-rendered navigation. Its own page is standalone HTML and
does not reproduce the full framework navbar; it provides manual links to the
device home, Configuration and OTA instead. This explains the observed visual
absence without an API regression.

Its NTP settings use a separate `Preferences` namespace and survive normal OTA
and reboot. It defines no separate JSON API. Its display driver is isolated
behind `ClockDisplay`, with Waveshare-specific code in `WaveshareClockDisplay`.
Its OTA behavior is inherited from the framework. The ESP32-C6 ClockDemo binary
of more than 1 MiB has been validated through the Device Manager upload flow
without asking the user for the Device Token. The device-reported capacity was
used, and the update preserved its Device ID, Device Token, Wi-Fi, enrollment
and application configuration.

### Other useful references and gaps

- `DhtSensorDemo`: clearest minimal page, navigation and read-only API pattern.
- `ThermostatDemo`: routes, validation and versioned atomic LittleFS settings.
- `QuadPzemWattmeter`: page, configuration API, persistence and MQTT use.
- `PolarH10ProgHardLinkDemo`: navigation, bounded binary API and MQTT; its page
  owns its HTML navigation like the other application pages.
- `MqttDemo`: smallest framework MQTT example, but `/api/demo` accepts methods
  without checking them and has no navigation item.
- `LedDemo`: useful route example, but it is not the strongest contract
  reference because it does not declare a navigation item.
- `ProgHardLinkBase`: navigation and API example; its LED state is intentionally
  volatile.

Application routes are remotely protected by the Node proxy, but are generally
unauthenticated on a trusted LAN. This is a current framework boundary, not an
application-specific API-key facility.
