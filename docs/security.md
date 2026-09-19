# Security

This is an operator guide, not a claim of formal security certification. Keep
dependencies patched, protect persistent volumes and validate exposure after
every deployment change. Report vulnerabilities through [SECURITY.md](../SECURITY.md).

## Portal downloads

The Portal host is public but exposes only its page, stylesheet and exact
versioned Arduino ZIP names. Download resolution rejects encoded or ambiguous
paths, backslashes, NULs, traversal and symlinks, does not list directories,
and validates artifact size and SHA-256 against an immutable release lock.
Portal responses use a restrictive CSP, deny framing, disable MIME sniffing and
send no referrer. Portal and Installer remain independent public surfaces.

Each enabled device has an individual token stored outside Git. Tunnel v2 uses
that token for challenge authentication, directional session keys, signed
frames, strict sequencing and selective AEAD encryption. ESP8266 uses
ChaCha20-Poly1305 and ESP32/ESP32-C3 use AES-128-GCM through their platform
crypto implementations. Device
metadata becomes trusted only after the signed hello.

The ESP-to-server tunnel is plain WebSocket by design; its confidentiality and
integrity properties come from the authenticated application protocol. Public
browser access remains HTTPS through Caddy.

The operator-initiated Registry OTA endpoint has a separate credential and
fails closed if it is not configured. Registry firmware paths are canonicalized
inside a read-only controlled repository. Device Manager's user `.bin` upload
instead requires a human session, device ownership and CSRF protection; the
server retrieves the Device Token internally and computes the OTA proof. The
device verifies SHA-256 before finalizing either update.

Interactive OTA derives `otaKey = HMAC-SHA256(deviceToken,
"ESPWAY-OTA-KEY-1")`. A one-use, 60-second challenge binds the device ID,
decimal size and lowercase SHA-256 into an `ESPWAY-OTA-AUTH-1` proof. The
browser sends neither the token nor `otaKey`. The ESP verifies the proof in
constant time before `Update.begin()` and verifies the streamed digest before
`Update.end(true)`. It never silently bypasses authorization.

The embedded browser implementation has no CDN dependency or dynamic code and
is checked against standard SHA-256/HMAC vectors plus the same complete OTA
vector used by Node and the ESP hardware self-test. Recent devices announce
their next OTA partition capacity. The server applies an 8 MiB operational
ceiling, a conservative 1 MiB fallback for older firmware without an announced
capacity, one active OTA per device, ACK backpressure and a bounded timeout.
Firmware bytes are not accumulated in Node or ESP RAM.

Tokens and passwords must never be logged or committed. The current release is
small and materially tested but has not received an independent security
audit. SHA-256 authenticates the server-selected bytes in the established
session; signed firmware remains a recommended future defence against a
repository or operator compromise.

The on-demand TLS authorization endpoint permits enabled device hostnames and
only the portal, installer, tunnel and admin hostnames derived from
`ESPWAY_DOMAIN`. Other hostnames remain denied. Caddy blocks public access to
the internal authorization path and calls it over the private Compose network.

Firmware Registry V1 rejects malformed identities, traversal and every
symbolic link in the registry tree. It recalculates file size and SHA-256 and
compares released artifacts with the immutable `released.json` lock. Public
responses contain only manifests and explicitly addressed non-candidate
firmware; there is no directory listing or write API. Filesystem paths, device
records, environment files, credentials and backups are never returned.

Device Manager is published only on the dedicated admin hostname. Node login,
sessions, roles and device ownership are the primary human security boundary;
the edge proxy does not apply Basic Auth. The application rejects admin paths
on all other hosts and redirects unauthenticated pages to `/login`. Admin
writes require JSON, a non-simple request marker and a same-host Origin or
Referer when supplied. Device IDs are canonical and public responses are built
from field allowlists. A newly generated device token is returned once and is
never logged or returned by subsequent reads.

Authentication V1 additionally fails closed in Node. Human passwords are
salted and hashed with scrypt; opaque sessions use Secure, HttpOnly, Strict
SameSite, host-only cookies. Device Manager mutations require a per-session
CSRF token. Remote device requests require either an authorized device-host
browser session or a hashed, revocable Personal API Token, and authorization
is checked against the user-device relationship before tunnel forwarding.

For V1, device tokens remain plaintext in the protected persistent registry so
the server can perform challenge authentication. This is documented technical
debt: the data directory must be private, writable only by the service, and
must never be exposed by Caddy.
