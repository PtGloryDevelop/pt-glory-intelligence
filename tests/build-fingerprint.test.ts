import assert from "node:assert/strict";
import test from "node:test";
import { sourceFingerprint } from "../scripts/build-fingerprint.ts";

/**
 * The fingerprint decides whether the Playwright server reuses .next or
 * rebuilds. NEXT_PUBLIC_* values are compiled into that output, so a build made
 * for one Supabase project must never be reused for another — that is how a
 * local run would end up serving a server wired to PILOT.
 */

async function withPublicUrl<T>(value: string | undefined, fn: () => Promise<T>): Promise<T> {
  const saved = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (value === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = value;
  try {
    return await fn();
  } finally {
    if (saved === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = saved;
  }
}

test("a build made for one Supabase project is not reused for another", async () => {
  const cloud = await withPublicUrl("https://someproject.supabase.co", sourceFingerprint);
  const local = await withPublicUrl("http://127.0.0.1:54321", sourceFingerprint);
  assert.notEqual(cloud, local);
});

test("the same source and the same public env give the same fingerprint", async () => {
  const first = await withPublicUrl("http://127.0.0.1:54321", sourceFingerprint);
  const second = await withPublicUrl("http://127.0.0.1:54321", sourceFingerprint);
  assert.equal(first, second);
});
