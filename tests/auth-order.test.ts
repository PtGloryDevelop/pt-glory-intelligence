import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Every authenticated page must await its own auth guard before it reads.
 *
 * The `(app)` layout redirects too, but Next renders layout and page
 * concurrently — a page that calls a read function in its body has already
 * issued the query by the time the layout's `redirect()` throws. That is how an
 * unauthenticated `GET /datasets` answered 307 and still logged
 * `42501 permission denied for function dataset_list`.
 *
 * A runtime test cannot see that ordering: the response is a correct 307 either
 * way, and the only visible difference is a line in the server log. So this is
 * a source check — the same shape as scripts/check-privileged-imports.mjs.
 */

const APP_GROUP = join("app", "(app)");
const GUARD = "requireActorOrRedirect";

/** Read functions a page must not call before the guard has resolved. */
const READS = [
  "listDatasets", "listCategories", "getDatasetContext", "getDatasetQuality",
  "getDatasetAds", "getDatasetFacets", "getAdDetail", "getObservationHistory",
];

function pages(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return pages(path);
    return entry === "page.tsx" ? [path] : [];
  });
}

const found = pages(APP_GROUP);

test("the app route group actually has pages to check", () => {
  // Without this, a rename would turn every assertion below into a silent pass.
  assert.ok(found.length >= 4, `expected the authenticated pages, found ${found.length}`);
});

test("every authenticated page awaits the guard before any read", () => {
  for (const path of found) {
    const source = readFileSync(path, "utf8");
    const guardAt = source.indexOf(`await ${GUARD}(`);
    assert.notEqual(guardAt, -1, `${path} must await ${GUARD}()`);

    for (const read of READS) {
      const callAt = source.indexOf(`${read}(`);
      if (callAt === -1) continue;
      assert.ok(
        callAt > guardAt,
        `${path} calls ${read}() before awaiting ${GUARD}()`,
      );
    }
  }
});

test("no page hands the guard to Promise.all beside a read", () => {
  // `Promise.all([getActor(), listDatasets()])` type-checks, reads naturally and
  // reintroduces the exact defect: both start together.
  for (const path of found) {
    const source = readFileSync(path, "utf8");
    for (const match of source.matchAll(/Promise\.all\(\[([\s\S]*?)\]\)/g)) {
      const inside = match[1];
      const hasGuard = inside.includes(GUARD) || inside.includes("getActor(");
      const hasRead = READS.some((read) => inside.includes(`${read}(`));
      assert.ok(
        !(hasGuard && hasRead),
        `${path} starts the auth check and a read in the same Promise.all`,
      );
    }
  }
});

test("pages do not fall back to the nullable getActor for authorization", () => {
  // getActor() returns null instead of redirecting, so a page using it keeps
  // rendering — and keeps reading — for a signed-out caller.
  for (const path of found) {
    const source = readFileSync(path, "utf8");
    assert.doesNotMatch(
      source,
      /await getActor\(/,
      `${path} must use ${GUARD}(), which orders the redirect before the read`,
    );
  }
});
