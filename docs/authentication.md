# Authentication and multi-user V1

ProgHard Link separates human authorization from device authentication. Human users
authenticate on the dedicated admin hostname. Devices continue to use their
individual device tokens, tunnel HMAC, AEAD and OTA proofs; human credentials
and Personal API Tokens are never sent through the tunnel.

## Roles and device access

There are two global roles. An `admin` can access every device and administer
users and assignments. A `user` can list, observe, update, run OTA on and open
only devices explicitly associated through `user_devices`. Unknown and
unassigned device IDs both return `404` to normal users.

When a user registers a device, ProgHard Link reserves the ownership association,
creates the machine identity in `devices.json`, and removes the association if
creation fails. An administrator can assign one device to one or more users.

## Storage and passwords

Human data is stored in `/data/auth.sqlite`. Schema V1 contains `users`,
`user_devices`, `api_tokens` and `audit_log`. SQLite uses foreign keys, WAL and
full synchronous writes. `devices.json` remains the machine authorization
source because device tokens are independent from human accounts.

Passwords use Node's native scrypt with a random 128-bit salt, N=32768, r=8,
p=1 and a 256-bit result. The stored value includes a format version and cost
parameters. Passwords must contain 12 to 256 characters and are never logged or
stored reversibly.

## First administrator and recovery

There is no HTTP bootstrap route. Create the first administrator locally in
the server container:

```sh
sudo docker compose exec server npm run create-admin -- --username admin
```

The CLI prompts for the password and its confirmation with input hidden. The
password is never placed in the command line or shell history. For controlled
automation, the CLI also accepts a single password on non-interactive standard
input; do not put that password literally in a shell command.

Reset an existing administrator with the same hidden prompts:

```sh
sudo docker compose exec server npm run reset-admin-password -- --username admin
```

The admin hostname fails closed with `503 authentication_unavailable` while
the database is unavailable, invalid, or contains no users. Machine tunnels
and the public Portal remain independent.

## Browser sessions

Login is available at `/login` on the admin hostname. Successful login creates
an opaque, random server-side session and a host-only cookie with `HttpOnly`,
`Secure`, `SameSite=Strict` and `Path=/`. The default lifetime is eight hours.
Logout, password reset, account disable and account deletion invalidate the
relevant sessions.

Mutating admin requests require JSON, the existing non-simple request marker,
a session-specific CSRF token and a matching Origin when one is provided.
Login failures are limited independently by source address and username.

Opening a remote device does not share the main cookie with the device
wildcard. Device Manager creates a 60-second, single-use access ticket after
checking the ACL. It submits the ticket in a POST body so it is not placed in
proxy URLs or access logs. The exchange creates a separate host-only cookie for
that exact device hostname, allowing same-origin fetch requests to work
normally.

## Personal API Tokens

From **API tokens** in Device Manager, create a named token such as
`Node-RED home`. Its secret is displayed exactly once. ProgHard Link stores only its
SHA-256 fingerprint. Tokens inherit the user's role and device associations,
and can be revoked immediately.

```sh
curl --fail-with-body \
  -H 'Authorization: Bearer espway_pat_REPLACE_WITH_TOKEN' \
  https://esp-a4f912.link.proghard.com/api/status
```

A missing, invalid, revoked or disabled-user token returns `401`. A valid token
used for another user's device returns `404`. Do not store the token in a
shared flow export or source repository.

## Node-RED

Import [`examples/node-red-personal-api-token.json`](../examples/node-red-personal-api-token.json).
Store the token in a Node-RED environment variable named
`ESPWAY_PERSONAL_API_TOKEN`, then set the target device hostname in the
Function node. For POST, set `msg.method = "POST"`, set `msg.payload`, and
retain the same Authorization header.

## Security operations

- Back up `auth.sqlite` with a SQLite-consistent backup and protect it as a
  secret. Sessions are memory-only and do not need backup.
- Never log passwords, cookies, PATs, device tokens, OTA proofs, HMAC or AEAD
  keys.
- Node authentication is the primary human security boundary. The production
  admin hostname no longer uses Caddy Basic Auth; unauthenticated pages redirect
  to `/login` and protected APIs fail closed in the application.
- V1 rate limiting uses the direct peer address. Forwarded client addresses
  must not be trusted without an explicit trusted-proxy policy.

## Production rollback

Back up the application-data volume before authentication changes. Roll back
the application and its project-owned Caddy configuration together through a
known Git revision, then validate the Compose stack before restarting it. Node
sessions, roles, device ownership, PAT checks, CSRF protection and audit
logging remain the authentication boundary; there is no separate host proxy
configuration to restore.
