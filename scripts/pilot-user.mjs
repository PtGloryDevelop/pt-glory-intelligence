/**
 * Provisions a pilot account with exactly one role.
 *
 *   PT_GLORY_ENV=pilot node --env-file-if-exists=.env.local \
 *     scripts/pilot-user.mjs <email> <viewer|analyst|admin>
 *
 * The generated password is written to .env.pilot-users.local (gitignored) and
 * never printed. A password echoed into a terminal ends up in scrollback, in a
 * transcript, and eventually in a screenshot — the file is one place, and it can
 * be deleted once the person has changed their password.
 *
 * Roles go through public.user_roles, which is what every RLS policy reads, so
 * an account provisioned here is subject to the same rules as any other. There
 * is no bypass and no shared login: one account, one person, one role.
 */
import { appendFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { isPilotProject } from "./destructive-guard.mjs";

const [, , email, role] = process.argv;
const ROLES = ["viewer", "analyst", "admin"];

if (!email || !ROLES.includes(role)) {
  console.error("usage: pilot-user.mjs <email> <viewer|analyst|admin>");
  process.exit(1);
}
if ((process.env.PT_GLORY_ENV ?? "").toLowerCase() !== "pilot") {
  console.error("refused: PT_GLORY_ENV=pilot is not set");
  process.exit(1);
}
if (!isPilotProject(process.env.DATABASE_URL)) {
  console.error("refused: DATABASE_URL does not point at the pilot project");
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
if (!url || !serviceKey) {
  console.error("refused: Supabase service credentials are not configured in this shell");
  process.exit(1);
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

/*
 * 24 bytes of base64url: long enough that nobody will guess it, short enough
 * that somebody can type it once before changing it.
 */
const password = randomBytes(24).toString("base64url");

const { data: created, error } = await admin.auth.admin.createUser({
  email,
  password,
  // Confirmed on creation: there is no mail transport configured for the pilot,
  // and an unconfirmed account cannot sign in.
  email_confirm: true,
});
if (error) {
  console.error(`could not create ${email}: ${error.message}`);
  process.exit(1);
}
const userId = created.user.id;

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
await client.query(
  `insert into public.user_roles (user_id, role) values ($1, $2)
   on conflict (user_id) do update set role = excluded.role, updated_at = now()`,
  [userId, role],
);
const { rows } = await client.query(
  "select role from public.user_roles where user_id = $1", [userId],
);
await client.end();

appendFileSync(
  ".env.pilot-users.local",
  `# ${new Date().toISOString()} ${role}\n${email}\t${password}\n`,
  { mode: 0o600 },
);

// Prove the account can actually sign in, rather than assuming it can.
const anon = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});
const signIn = await anon.auth.signInWithPassword({ email, password });

console.log(JSON.stringify({
  email,
  role: rows[0]?.role ?? null,
  userId,
  signInWorks: !signIn.error,
  signInError: signIn.error?.message ?? null,
  passwordWrittenTo: ".env.pilot-users.local",
}, null, 2));
