import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const email = `trial.${Date.now()}@ptglory.local`;
const password = `PG!${randomBytes(12).toString("base64url")}9a`;
const { data, error } = await client.auth.admin.createUser({ email, password, email_confirm: true });
if (error) throw error;
const assigned = await client.from("user_roles").insert({ user_id: data.user.id, role: "analyst" });
if (assigned.error) {
  await client.auth.admin.deleteUser(data.user.id);
  throw assigned.error;
}
const login = await client.auth.signInWithPassword({ email, password });
if (login.error) throw login.error;
await mkdir("e2e/.auth", { recursive: true });
await writeFile("e2e/.auth/trial-credentials.json", JSON.stringify({ email, password }));
console.log(JSON.stringify({ email, password, role: "analyst", loginVerified: true }));
