# Security policy

## Supported version

The initial public baseline is ProgHard Link Base 0.2.3, Arduino library 0.4.8
and the server version contained in this repository. Older private development
snapshots are not supported publicly.

## Reporting a vulnerability

Do not open a public issue containing credentials, device tokens, session
cookies, exploit details or personal data. Use GitHub private vulnerability
reporting when enabled, or another private channel published by the repository
owner. Remove all real secrets from logs and screenshots. No response-time or
bounty promise is made.

## Operator responsibilities

Keep Ubuntu, Docker and the deployment current; restrict SSH; back up the
application and Caddy volumes; never publish ports 3000 or 2019; and do not put
`.env`, runtime databases, device registries, tokens or private keys in Git.
