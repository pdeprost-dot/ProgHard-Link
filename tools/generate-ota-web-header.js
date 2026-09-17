import { readFile, writeFile } from "node:fs/promises";

const sourceUrl = new URL(
  "../firmware/esp8266/libraries/ESPway/extras/ota-auth.js",
  import.meta.url,
);
const outputUrl = new URL(
  "../firmware/esp8266/libraries/ESPway/src/ESPwayOtaWebCrypto.h",
  import.meta.url,
);
const source = await readFile(sourceUrl, "utf8");
if (source.includes(")ESPWAY_JS\"")) throw new Error("raw literal delimiter collision");
await writeFile(outputUrl,
  `#pragma once\n#include <pgmspace.h>\n\n` +
  `static const char ESPWAY_OTA_WEB_CRYPTO[] PROGMEM = R\"ESPWAY_JS(${source})ESPWAY_JS\";\n`,
  "utf8",
);
