# Provisioning and Enrollment V1

If LittleFS has no valid Wi-Fi configuration, ProgHard Link starts AP+station
mode. Its SSID is `ESPway-XXXXXX`, where the suffix comes from the stable chip
identity. The AP uses `192.168.4.1`.

The firmware answers common captive-portal HTTP probes with the setup page.
Automatic opening still depends on the operating system and browser; if no
portal appears, open `http://192.168.4.1/` manually.

The captive setup page asks only for a device name, Wi-Fi credentials and the
base URL of the target ProgHard Link instance. Saving writes `/config.json`
atomically and restarts the device. Application `begin()`, `loop()` and routes
are all deferred until networking has been provisioned, so application
workloads cannot interfere with first boot.

The instance URL is configuration, not an identity baked into the protocol. It
must be a complete HTTPS origin such as `https://link.example.org`; a trailing
slash is normalized away. A build can propose a default, and another
installation can replace it without changing the enrollment mechanism.

## Enrollment on the LAN

After joining the LAN, the local page shows the configured instance and
**Register this device in ProgHard Link**. The device has already generated and
stored its random 256-bit machine credential. Clicking Register makes the
device send that credential and its metadata directly to the configured
instance over certificate-verified HTTPS.

The server creates a random, one-time enrollment token with a ten-minute
default lifetime and returns a claim URL. The browser sees only this temporary
URL; it never receives the permanent machine credential. If login is needed,
the requested enrollment path is preserved. Confirmation is protected by the
normal session, Origin and CSRF checks and atomically creates both the device
authorization and the user's ownership relation.

The server also returns its configured device-service domain. The device stores
that domain and retries its signed tunnel authentication with its own machine
credential. Device ID remains useful for routing and diagnostics, but neither
Device ID nor credential is copied or entered by the user.

Once the authenticated tunnel is connected, the local page replaces the
registration action with **Registered with ProgHard Link**. If the device is
offline or its authorization was removed, the action remains available so a
new enrollment can be started.

`/config` can change ordinary settings without revealing stored Wi-Fi secrets
or machine credentials. Reset Wi-Fi and Factory Reset remain available for
development and recovery.
