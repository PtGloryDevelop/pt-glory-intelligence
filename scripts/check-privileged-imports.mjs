#!/usr/bin/env node
/**
 * The import transaction connects with DATABASE_URL, which bypasses RLS. If that
 * module ever gets imported from a read path, RLS silently stops protecting
 * anything. This walks the source tree and fails the build if it happens.
 *
 * Allowlist stays tiny on purpose: only the import write path may touch it.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const SCAN = ["app", "components", "lib", "tests"];
const PRIVILEGED = /lib\/db\/privileged/;

// Paths permitted to import the privileged client.
const ALLOWED = [
  "app/api/imports/commit/route.ts",
  "app/api/collections/advance/route.ts",
  "lib/import/commit.ts",
  "lib/collect/admission.ts",
  "lib/collect/cost.ts",
  "lib/collect/machine.ts",
  "lib/collect/recovery.ts",
  "tests/db/",
];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(entry)) out.push(full);
  }
  return out;
}

const offenders = [];
for (const dir of SCAN) {
  let files;
  try {
    files = walk(join(ROOT, dir));
  } catch {
    continue; // directory not created yet
  }
  for (const file of files) {
    const rel = relative(ROOT, file).split(sep).join("/");
    if (ALLOWED.some((allowed) => rel === allowed || rel.startsWith(allowed))) continue;
    const source = readFileSync(file, "utf8");
    if (PRIVILEGED.test(source)) offenders.push(rel);
  }
}

if (offenders.length > 0) {
  console.error("lib/db/privileged.ts imported outside the write path:");
  for (const file of offenders) console.error(`  ${file}`);
  console.error("\nRead paths must use lib/db/user.ts so RLS applies.");
  process.exit(1);
}

console.log("check:imports ok — privileged client stays on the write path");
