import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readFile, stat } from "node:fs/promises";
import { test } from "node:test";
import { createWebInstallerManifest } from "../src/firmware-registry.js";

const repositoryRoot = new URL("../../", import.meta.url);
const installerUrl = new URL("web-installer/index.html", repositoryRoot);
const releaseUrl = new URL(
  "firmware-repository/esp8266/espway-base/0.2.3/",
  repositoryRoot,
);
const caddyUrl = new URL("caddy/Caddyfile", repositoryRoot);
const catalogUrl = new URL("web-installer/manifest.json", repositoryRoot);

test("web installer pins esp-web-tools and uses the versioned manifest", async () => {
  const html = await readFile(installerUrl, "utf8");
  assert.match(html, /esp-web-tools@10\.4\.0/);
  assert.match(html, /manifest="manifest\.json"/);
  assert.doesNotMatch(html, /improv/i);
  assert.match(html, /configure your Wi-Fi plus the ProgHard Link instance/);
  assert.match(html, /Register this device in ProgHard Link/);
  assert.doesNotMatch(html, /Copy.+(?:Device ID|device token)/is);
});

test("production installer serves its catalog and proxies Registry firmware", async () => {
  const caddy = await readFile(caddyUrl, "utf8");
  assert.match(caddy, /\/manifest\.json/);
  assert.match(caddy, /handle \/firmware\/\*/);
  assert.match(caddy, /install\.\{\$ESPWAY_DOMAIN\}/);
  assert.match(caddy, /on_demand_tls[\s\S]*ask http:\/\/server:3000\/internal\/tls-ask/);
  assert.match(caddy, /https:\/\/[\s\S]*on_demand/);
  assert.doesNotMatch(caddy, /espway\.proghard\.com/);
  assert.doesNotMatch(caddy, /@installerFiles/);
});

test("installer catalog selects all five supported chip families automatically", async () => {
  const manifest = JSON.parse(await readFile(catalogUrl, "utf8"));
  assert.equal(manifest.name, "ProgHard Link Base");
  assert.deepEqual(manifest.builds.map((build) => build.chipFamily), ["ESP8266", "ESP32", "ESP32-C3", "ESP32-C6", "ESP32-S3"]);
  for (const build of manifest.builds) {
    assert.equal(build.parts.length, 1);
    assert.equal(build.parts[0].offset, 0);
    assert.match(build.parts[0].path, /^\/firmware\/(esp8266|esp32|esp32-c3|esp32-c6|esp32-s3)\/espway-base\/0\.2\.3\/firmware\.bin$/);
  }
});

test("ProgHard Link Base installer manifest is derived from its registry manifest", async () => {
  const internal = JSON.parse(
    await readFile(new URL("manifest.json", releaseUrl), "utf8"),
  );
  const manifest = JSON.parse(
    await readFile(new URL("web-installer-manifest.json", releaseUrl), "utf8"),
  );
  assert.deepEqual(manifest, createWebInstallerManifest(internal));
  assert.equal(manifest.name, "ProgHard Link Base");
  assert.equal(manifest.version, "0.2.3");
  assert.equal(manifest.new_install_improv_wait_time, 0);
  assert.deepEqual(manifest.builds, [
    {
      chipFamily: "ESP8266",
      improv: false,
      parts: [{ path: "firmware.bin", offset: 0 }],
    },
  ]);
});

test("ProgHard Link Base release contains the validated firmware image", async () => {
  const firmwareUrl = new URL("firmware.bin", releaseUrl);
  await access(firmwareUrl);
  const firmware = await readFile(firmwareUrl);
  const internal = JSON.parse(await readFile(new URL("manifest.json", releaseUrl), "utf8"));
  assert.equal((await stat(firmwareUrl)).size, internal.size);
  assert.equal(createHash("sha256").update(firmware).digest("hex"), internal.sha256);
});

test("ESP32 installer releases use merged offset-zero images", async () => {
  for (const hardware of ["esp32", "esp32-c3", "esp32-c6", "esp32-s3"]) {
    const release = new URL(`firmware-repository/${hardware}/espway-base/0.2.3/`, repositoryRoot);
    const internal = JSON.parse(await readFile(new URL("manifest.json", release), "utf8"));
    const installer = JSON.parse(await readFile(new URL("web-installer-manifest.json", release), "utf8"));
    const firmware = await readFile(new URL("firmware.bin", release));
    assert.equal(internal.size, firmware.length);
    assert.equal(internal.sha256, createHash("sha256").update(firmware).digest("hex"));
    assert.deepEqual(installer.builds[0].parts, [{ path: "firmware.bin", offset: 0 }]);
    assert.equal(installer.builds[0].chipFamily, hardware.toUpperCase());
  }
});

test("public ProgHard Link Base sources contain no provisioned secrets", async () => {
  const sourceRoot = new URL(
    "firmware/esp8266/libraries/ESPway/examples/ProgHardLinkBase/",
    repositoryRoot,
  );
  const source = await Promise.all(
    ["ProgHardLinkBase.ino", "ESPwayBaseApp.h", "ESPwayBaseApp.cpp"].map((name) =>
      readFile(new URL(name, sourceRoot), "utf8"),
    ),
  );
  assert.doesNotMatch(
    source.join("\n"),
    /esp-[a-f0-9]{6,16}|deviceToken|wifiPassword|mqttPassword/i,
  );
});

test("ProgHard Link Base reserves the root route for provisioning and enrollment", async () => {
  const sourceUrl = new URL(
    "firmware/esp8266/libraries/ESPway/examples/ProgHardLinkBase/ESPwayBaseApp.cpp",
    repositoryRoot,
  );
  const source = await readFile(sourceUrl, "utf8");
  assert.match(source, /request\.path == "\/app"/);
  assert.doesNotMatch(source, /request\.path == "\/"/);
});
