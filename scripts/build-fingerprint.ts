/**
 * A hash of everything that can change what the browser is served.
 *
 * The visual suite asserts on rendered geometry, so a screenshot taken against
 * a build from older source is not a weaker result — it is a wrong one, and it
 * looks exactly like a real regression. This is what lets the run prove which
 * source the server is actually running.
 */
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, sep } from "node:path";
import { pathToFileURL } from "node:url";

/** Everything Next compiles into the served output, plus what configures it. */
const ROOTS = ["app", "components", "lib", "styles", "public"];
const FILES = ["next.config.ts", "next.config.mjs", "next.config.js", "package-lock.json", "tsconfig.json"];

export const FINGERPRINT_FILE = join(".next", "SOURCE_FINGERPRINT");

async function walk(dir: string, out: string[]): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out; // an optional root (public/, styles/) may simply not exist
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path, out);
    else out.push(path);
  }
  return out;
}

export async function sourceFingerprint(): Promise<string> {
  const found: string[] = [];
  for (const root of ROOTS) await walk(root, found);
  for (const file of FILES) if (existsSync(file)) found.push(file);

  // Sorted so the hash depends on content and path, never on directory order.
  found.sort();
  const hash = createHash("sha256");
  for (const path of found) {
    hash.update(path.split(sep).join("/"));
    hash.update("\0");
    hash.update(readFileSync(path));
    hash.update("\0");
  }

  /*
   * NEXT_PUBLIC_* values are inlined into BOTH the server and the client output
   * at build time, so they are part of what is served just as much as a source
   * file is. Leaving them out meant a build made against one Supabase project
   * was reused against another: found at D1.2, when the existing .next carried
   * the PILOT project ref in 34 files and the local suite would have run a
   * server wired to PILOT while every guard reported a local target. Public by
   * definition, so hashing the values leaks nothing.
   */
  const publicEnv = Object.entries(process.env)
    .filter(([name]) => name.startsWith("NEXT_PUBLIC_"))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  for (const [name, value] of publicEnv) {
    hash.update(`env:${name}=${value ?? ""}`);
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 16);
}

/** What the last build was made from, or null if nothing has been built. */
export function builtFingerprint(): string | null {
  try {
    return readFileSync(FINGERPRINT_FILE, "utf8").trim();
  } catch {
    return null;
  }
}

// Runnable on its own for debugging: node --experimental-strip-types this file.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(await sourceFingerprint());
}
