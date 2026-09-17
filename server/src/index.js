import { loadConfig } from "./config.js";
import { createEspwayServer } from "./server.js";

const config = loadConfig();
const { server, authorizedDevices } = createEspwayServer(config);

process.on("SIGHUP", () => {
  try {
    authorizedDevices.reloadFromFile();
    console.log("ProgHard Link authorized device registry reloaded");
  } catch (error) {
    console.error(
      "ProgHard Link authorized device registry reload failed:",
      error.message,
    );
  }
});

server.listen(config.port, "0.0.0.0", () =>
  console.log(`ProgHard Link server listening on :${config.port}`),
);
