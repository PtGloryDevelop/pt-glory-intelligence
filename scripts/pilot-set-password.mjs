/**
 * Lets a person set their own pilot password, typed into their own terminal.
 *
 *   PowerShell:
 *     $env:PT_GLORY_ENV='pilot'; node --env-file-if-exists=.env.local scripts/pilot-set-password.mjs <email>
 *
 * The password is read from a hidden prompt and nowhere else: never from argv
 * (shell history), never from an environment variable (process listings), never
 * written to a file, never printed. Whoever runs this is the only one who sees
 * it — which is the point. The app has no change-password screen yet, and the
 * alternative was to hand the value to somebody else to set.
 *
 * Once it succeeds, that account's generated record in .env.pilot-users.local is
 * obsolete, so it is removed: a file of passwords that no longer work is a file
 * nobody can trust.
 */
import readline from "node:readline";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { isPilotProject, PILOT_PROJECT_REF } from "./destructive-guard.mjs";

const USERS_FILE = ".env.pilot-users.local";
const MIN_LENGTH = 12;

const email = (process.argv[2] ?? "").trim().toLowerCase();

function refuse(reason) {
  console.error(`refused: ${reason}`);
  process.exit(1);
}

if (!email || !email.includes("@")) refuse("usage: pilot-set-password.mjs <email>");
if ((process.env.PT_GLORY_ENV ?? "").toLowerCase() !== "pilot") refuse("PT_GLORY_ENV=pilot is not set");
if (!isPilotProject(process.env.DATABASE_URL)) refuse("DATABASE_URL does not point at the pilot project");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !serviceKey || !anonKey) refuse("Supabase URL / keys are not configured in this shell");
// The admin API is reached by URL, not by DATABASE_URL, so it is checked too.
if (!url.includes(PILOT_PROJECT_REF)) refuse("NEXT_PUBLIC_SUPABASE_URL is not the pilot project");

/*
 * Without a real terminal the console echoes keystrokes itself, before Node can
 * hide them. Refusing is the only way to keep the promise in the header.
 */
if (!process.stdin.isTTY) {
  refuse("no interactive terminal — run this in PowerShell or Windows Terminal, not a piped or embedded shell");
}

/** Reads one line without echoing it. Ctrl+C cancels with nothing changed. */
function askHidden(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl.on("SIGINT", () => {
      rl.close();
      process.stdout.write("\ncancelled — nothing was changed\n");
      process.exit(130);
    });
    process.stdout.write(prompt);
    rl._writeToOutput = () => {};
    rl.question("", (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

function askVisible(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
const { data: list, error: listError } = await admin.auth.admin.listUsers({ perPage: 1000 });
if (listError) refuse(`could not list accounts: ${listError.message}`);
const user = list.users.find((row) => row.email?.toLowerCase() === email);
if (!user) refuse(`${email} has no pilot account`);

console.log(`setting a new password for ${email}`);
console.log(`at least ${MIN_LENGTH} characters · typing is hidden · Ctrl+C cancels`);

const password = await askHidden("new password: ");
if (password.length < MIN_LENGTH) refuse(`shorter than ${MIN_LENGTH} characters — nothing was changed`);
if (password.toLowerCase().includes(email.split("@")[0])) refuse("contains the email name — nothing was changed");

const again = await askHidden("again: ");
if (again !== password) refuse("the two entries differ — nothing was changed");

/*
 * A long run of digits is almost always a phone or ID number, and those are the
 * first thing anyone who knows the person will try. Said, not forbidden: the
 * account belongs to the person typing.
 */
if (/\d{9,}/.test(password)) {
  console.log("warning: this contains a long run of digits, which usually means a phone or ID number");
  const answer = await askVisible("use it anyway? type yes to continue: ");
  if (answer.toLowerCase() !== "yes") refuse("not confirmed — nothing was changed");
}

const { error: updateError } = await admin.auth.admin.updateUserById(user.id, { password });
if (updateError) refuse(`Supabase refused the change: ${updateError.message}`);

// Proven, not assumed.
const anon = createClient(url, anonKey, { auth: { persistSession: false } });
const { error: signInError } = await anon.auth.signInWithPassword({ email, password });

/*
 * Drop this account's generated record, and the comment line that introduced
 * it. Header comments and other people's records stay exactly as they were.
 */
let staleRecordRemoved = false;
if (existsSync(USERS_FILE)) {
  const kept = [];
  let pending = [];
  for (const line of readFileSync(USERS_FILE, "utf8").split(/\r?\n/)) {
    if (line.startsWith("#")) { pending.push(line); continue; }
    if (!line.trim()) continue;
    if (line.split("\t")[0].toLowerCase() === email) {
      kept.push(...pending.slice(0, -1));
      staleRecordRemoved = true;
    } else {
      kept.push(...pending, line);
    }
    pending = [];
  }
  kept.push(...pending);
  writeFileSync(USERS_FILE, `${kept.join("\n")}\n`, { mode: 0o600 });
}

console.log(JSON.stringify({
  email,
  passwordChanged: true,
  signInWorks: !signInError,
  signInError: signInError?.message ?? null,
  staleRecordRemovedFrom: staleRecordRemoved ? USERS_FILE : null,
}, null, 2));
