/**
 * The server the Playwright suite runs against — owned by the run, never
 * borrowed.
 *
 * We lost two full gate runs to a `next start` from an older build still
 * holding port 3000: the suite attached to it happily and reported failures
 * that did not exist in the working tree. A comment telling the next person to
 * remember to kill it is not a fix, so this does three things instead:
 *
 *   1. runs on its own port, away from `npm run dev`
 *   2. rebuilds whenever the source hash differs from what was last built
 *   3. refuses to start if something else already holds the port
 *
 * Normal development is untouched: `npm run dev` still owns 3000, and a run
 * whose source has not changed skips the build and starts immediately.
 */
import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { writeFileSync } from "node:fs";
import { builtFingerprint, FINGERPRINT_FILE, sourceFingerprint } from "./build-fingerprint.ts";

const PORT = Number(process.env.PLAYWRIGHT_PORT ?? 3177);

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", shell: process.platform === "win32" });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))));
  });
}

/** Resolves true when something is already listening on the port. */
function portTaken() {
  return new Promise((resolve) => {
    const socket = createConnection({ port: PORT, host: "127.0.0.1" })
      .on("connect", () => { socket.destroy(); resolve(true); })
      .on("error", () => resolve(false));
  });
}

if (await portTaken()) {
  console.error(
    `\n  port ${PORT} is already in use.\n\n` +
    `  This port belongs to the Playwright suite, which must own the server it\n` +
    `  tests — a leftover process would serve an older build and the visual\n` +
    `  assertions would fail against code that is not in the working tree.\n\n` +
    `  Stop whatever is holding it, then run the suite again.\n`,
  );
  process.exit(1);
}

const current = await sourceFingerprint();
if (builtFingerprint() !== current) {
  console.log(`build fingerprint ${builtFingerprint() ?? "none"} → ${current}; rebuilding`);
  await run("npx", ["next", "build"]);
  writeFileSync(FINGERPRINT_FILE, current);
} else {
  console.log(`build fingerprint ${current} is current; reusing .next`);
}

await run("npx", ["next", "start", "--port", String(PORT)]);
