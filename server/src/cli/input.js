import { emitKeypressEvents } from "node:readline";

export function rejectPasswordArguments(argv = process.argv.slice(2)) {
  if (argv.some((argument) => /^(?:--)?password(?:=|$)/i.test(argument)))
    throw new Error("the password must not be passed as a command-line argument");
}

export function readHiddenLine(input, output, prompt, emitKeypress = emitKeypressEvents) {
  return new Promise((resolve, reject) => {
    let value = "";
    const wasRaw = Boolean(input.isRaw);
    const wasPaused = input.isPaused?.() ?? false;

    const cleanup = () => {
      input.removeListener("keypress", onKeypress);
      input.setRawMode?.(wasRaw);
      if (wasPaused) input.pause?.();
    };
    const finish = () => {
      cleanup();
      output.write("\n");
      resolve(value);
    };
    const cancel = () => {
      cleanup();
      output.write("\n");
      reject(new Error("password input cancelled"));
    };
    const onKeypress = (text, key = {}) => {
      if (key.ctrl && (key.name === "c" || key.name === "d")) return cancel();
      if (key.name === "return" || key.name === "enter") return finish();
      if (key.name === "backspace") {
        value = Array.from(value).slice(0, -1).join("");
        return;
      }
      if (key.ctrl && key.name === "u") {
        value = "";
        return;
      }
      if (!key.ctrl && !key.meta && text) value += text;
    };

    output.write(prompt);
    emitKeypress(input);
    input.on("keypress", onKeypress);
    input.setRawMode?.(true);
    input.resume?.();
  });
}

export async function readPasswordFromStdin({
  input = process.stdin,
  output = process.stderr,
  readHidden = readHiddenLine,
} = {}) {
  if (input.isTTY) {
    const password = await readHidden(input, output, "Password: ");
    const confirmation = await readHidden(input, output, "Confirm password: ");
    if (password !== confirmation) throw new Error("password_confirmation_mismatch");
    return password;
  }
  const chunks = [];
  for await (const chunk of input) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8").replace(/[\r\n]+$/, "");
}

export function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}
