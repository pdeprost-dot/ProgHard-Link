import { loadConfig } from "../config.js";
import { openAuthDatabase } from "../auth/database.js";
import { AuthService } from "../auth/auth-service.js";
import { option, readPasswordFromStdin, rejectPasswordArguments } from "./input.js";

rejectPasswordArguments();
const username = option("--username");
if (!username) throw new Error("usage: npm run reset-admin-password -- --username <username>");
const auth = new AuthService(openAuthDatabase(loadConfig().authDatabaseFile));
try {
  const user = auth.getUserByUsername(username);
  if (!user || user.role !== "admin") throw new Error("administrator not found");
  await auth.updateUser(user.id, { password: await readPasswordFromStdin() }, user);
  console.log(`Reset password for administrator ${user.username}`);
} finally { auth.close(); }
