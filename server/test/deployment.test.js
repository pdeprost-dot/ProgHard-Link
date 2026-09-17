import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const repositoryRoot = new URL("../../", import.meta.url);

test("Compose exposes only Caddy and persists application and certificate data", async () => {
  const compose = await readFile(new URL("docker-compose.yml", repositoryRoot), "utf8");
  const serverSection = compose.slice(compose.indexOf("  server:"), compose.indexOf("  caddy:"));
  assert.match(compose, /ESPWAY_DOMAIN: \$\{ESPWAY_DOMAIN:\?set ESPWAY_DOMAIN in \.env\}/);
  assert.match(compose, /- "80:80"/);
  assert.match(compose, /- "443:443"/);
  assert.doesNotMatch(compose, /443:443\/udp/);
  assert.doesNotMatch(serverSection, /\n\s+ports:/);
  assert.match(serverSection, /app_data:\/data/);
  assert.match(compose, /data-init:[\s\S]*chown -R 1000:1000 \/data/);
  for (const volume of ["app_data", "caddy_data", "caddy_config"])
    assert.match(compose, new RegExp(`^  ${volume}:`, "m"));
});

test("Caddy is autonomous and keeps TLS authorization private", async () => {
  const caddy = await readFile(new URL("caddy/Caddyfile", repositoryRoot), "utf8");
  assert.match(caddy, /ask http:\/\/server:3000\/internal\/tls-ask/);
  assert.match(caddy, /@internal path \/internal\/\*[\s\S]*respond @internal 404/);
  assert.match(caddy, /http:\/\/tunnel\.\{\$ESPWAY_DOMAIN\}/);
  assert.match(caddy, /https:\/\/[\s\S]*on_demand/);
  assert.match(caddy, /root \* \/srv\/web-installer/);
  assert.doesNotMatch(caddy, /espway\.proghard\.com|espway-caddy|\/etc\/caddy\/sites/);
});
