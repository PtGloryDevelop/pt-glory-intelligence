// Keeps "แอดของเรา" fresh without anyone pressing "อัปเดตข้อมูล": runs the owned-ads sync, then the
// thumbnail archive, at fixed Bangkok times. Meant for an always-on server (the Ads Management VPS,
// see deploy/owned-sync/). `--once` runs a single cycle now and exits with its status.
//
//   OWNED_SYNC_TIMES      Bangkok times, default "09:00,13:00,18:00"
//   OWNED_SYNC_ACTOR_ID   the admin user id the sync is recorded under (required)
//   plus everything scripts/sync-owned-library.mjs and scripts/archive-owned-thumbs.mjs read.
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { nextRun, parseTimes } from "./owned-sync-schedule.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const actor = process.env.OWNED_SYNC_ACTOR_ID ?? "";
const times = parseTimes(process.env.OWNED_SYNC_TIMES || "09:00,13:00,18:00");
if (!UUID.test(actor)) throw new Error("OWNED_SYNC_ACTOR_ID must be the admin user's id");
if (!times) throw new Error("OWNED_SYNC_TIMES must look like 09:00,13:00,18:00");

const log = (event, detail = {}) => console.log(JSON.stringify({ at: new Date().toISOString(), event, ...detail }));

let stopping = false;
let wake = null;
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { stopping = true; wake?.(); });

function run(args) {
  return new Promise((done) => {
    const child = spawn(process.execPath, args, { cwd: resolve(import.meta.dirname, ".."), env: process.env, stdio: "inherit" });
    child.on("exit", (code) => done(code ?? 1));
    child.on("error", () => done(1));
  });
}

async function cycle() {
  const started = Date.now();
  log("cycle_start");
  const sync = await run(["--experimental-strip-types", "scripts/sync-owned-library.mjs", actor]);
  // Pictures only after a published snapshot; a failed sync leaves the previous one in place.
  const thumbs = sync === 0 ? await run(["--conditions=react-server", "--experimental-strip-types", "scripts/archive-owned-thumbs.mjs"]) : null;
  log("cycle_end", { sync, thumbs, minutes: Math.round((Date.now() - started) / 6000) / 10 });
  return sync === 0 && thumbs === 0 ? 0 : 1;
}

if (process.argv.includes("--once")) {
  process.exitCode = await cycle();
} else {
  log("scheduler_start", { times });
  while (!stopping) {
    const at = nextRun(times);
    log("next_run", { at: at.toISOString() });
    await new Promise((done) => { wake = done; setTimeout(done, Math.max(0, at.getTime() - Date.now())); });
    wake = null;
    if (!stopping) await cycle();
  }
  log("scheduler_stop");
}
