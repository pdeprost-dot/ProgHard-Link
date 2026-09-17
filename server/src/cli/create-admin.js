import { loadConfig } from "../config.js";
import { openAuthDatabase } from "../auth/database.js";
import { AuthService } from "../auth/auth-service.js";
import { option, readPasswordFromStdin, rejectPasswordArguments } from "./input.js";

rejectPasswordArguments();
const username = option("--username");
if (!username) throw new Error("usage: npm run create-admin -- --username <username>");
const auth = new AuthService(openAuthDatabase(loadConfig().authDatabaseFile));
try {
  const user = await auth.createUser({ username, password: await readPasswordFromStdin(), role: "admin" });
  console.log(`Created administrator ${user.username} (${user.id})`);
} finally { auth.close(); }
