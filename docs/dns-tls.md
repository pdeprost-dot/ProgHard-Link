# DNS and TLS

ProgHard Link uses an apex record plus one wildcard DNS record:

```text
link.example.com    ->  public server IP
*.link.example.com  ->  public server IP
```

Adding `esp-abcdef` therefore requires no new DNS record. DNS resolution only
directs traffic to the server; it does not authorize a device or certificate.
Device authorization still comes from the ESPway registry and individual
token.

The namespace reserves these infrastructure names:

- `install.link.example.com` for the Web Installer;
- `admin.link.example.com` for Device Manager;
- `tunnel.link.example.com` for tunnel v2 and controlled firmware files.

All other matching names are device names and must satisfy ESPway's canonical
device-ID rule. Caddy On-Demand TLS asks the ProgHard Link server before issuing a
certificate. It permits enabled device names and only the explicitly
configured infrastructure hosts; wildcard DNS alone is never sufficient.

Set `ESPWAY_DOMAIN` to the apex value. The server and Caddy derive every
infrastructure and device hostname from it. The DNS provider is otherwise
irrelevant. Create wildcard `A` or `AAAA` records rather than one record per
device, but do not publish `AAAA` unless IPv6 is routed and tested.

Useful checks are:

```text
nslookup admin.link.example.com
nslookup esp-abcdef.link.example.com
dig +short tunnel.link.example.com A
dig +short install.link.example.com AAAA
```

DNS propagation and certificate authorization are separate checks. Confirm
both resolution and an authenticated HTTPS response before declaring a new
infrastructure hostname operational.
