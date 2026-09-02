import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Static security checks over the build output and the source tree.
 *
 * Nothing here ever prints a secret. The values are read from the environment,
 * searched for, and reported only by name — a failing assertion says which
 * variable leaked, never what it contains.
 */

const CLIENT_DIR = join(".next", "static");
const built = existsSync(CLIENT_DIR);
const buildSkip = built ? false : "run `npm run build` first";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const clientText = () =>
  walk(CLIENT_DIR)
    .filter((path) => path.endsWith(".js") || path.endsWith(".json") || path.endsWith(".map"))
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");

test("no server-only credential reaches the client bundle", { skip: buildSkip }, () => {
  const bundle = clientText();
  const secrets = [
    "DATABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY",
  ] as const;

  for (const name of secrets) {
    const value = process.env[name];
    // The variable name itself must not appear either: its presence would mean
    // something on the client is reading process.env for it.
    assert.ok(!bundle.includes(name), `${name} is referenced in the client bundle`);
    if (value && value.length > 8) {
      assert.ok(!bundle.includes(value), `the value of ${name} is in the client bundle`);
    }
  }

  assert.ok(!bundle.includes("postgresql://"), "a Postgres connection string is in the bundle");
  assert.ok(!bundle.includes("postgres://"), "a Postgres connection string is in the bundle");
  // A service-role JWT carries this role claim; the anon key does not.
  assert.ok(!bundle.includes("service_role"), "a service-role key is in the client bundle");
});

test("the bundle scan is looking at real client code", { skip: buildSkip }, () => {
  // Without a positive control, a scan that silently read the wrong directory
  // would pass every secret check by finding nothing at all.
  const bundle = clientText();
  assert.ok(bundle.length > 10_000, "bundle scan found essentially no code");
  assert.ok(
    bundle.includes("/api/imports/preview"),
    "expected the import client's own fetch URL in the bundle",
  );
});

test("not even the anon key is shipped to the browser", { skip: buildSkip }, () => {
  // Supabase is only ever constructed on the server here, so the browser holds
  // no Supabase credential at all. Worth pinning: adding a browser client later
  // would be a deliberate decision, not an accident.
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!anon) return;
  assert.ok(!clientText().includes(anon), "a Supabase key is now in the client bundle");
});

/** Source files that run in the browser must not reach for the privileged client. */
function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return walk(dir).filter((path) => /\.(ts|tsx)$/.test(path));
}

test("no client component imports the privileged database module", () => {
  const offenders: string[] = [];
  for (const path of [...sourceFiles("app"), ...sourceFiles("lib")]) {
    const source = readFileSync(path, "utf8");
    const isClient = /^\s*["']use client["']/m.test(source);
    if (isClient && /db\/privileged/.test(source)) offenders.push(path);
  }
  assert.deepEqual(offenders, []);
});

test("no client component reads process.env for a server secret", () => {
  const offenders: string[] = [];
  for (const path of [...sourceFiles("app"), ...sourceFiles("lib")]) {
    const source = readFileSync(path, "utf8");
    if (!/^\s*["']use client["']/m.test(source)) continue;
    for (const match of source.matchAll(/process\.env\.(\w+)/g)) {
      if (!match[1].startsWith("NEXT_PUBLIC_")) offenders.push(`${path}: ${match[1]}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("the read layer never imports the privileged client", () => {
  for (const path of sourceFiles(join("lib", "read"))) {
    const source = readFileSync(path, "utf8");
    assert.doesNotMatch(source, /db\/privileged/, `${path} must read through dbUser()`);
  }
});
