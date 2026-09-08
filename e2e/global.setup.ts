import { test as setup, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { connect, resetTables } from "../tests/db/helpers.ts";

/**
 * Puts the DEV database into a known state and signs two roles in through the
 * real login form, so the journey starts from a real session rather than a
 * hand-made cookie.
 */

import { ACCOUNTS, AUTH, CATEGORY, PASSWORD, TMP } from "./constants.ts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
// Same order as tests/db/auth-chain.test.ts: the JWT service-role key is what
// this supabase-js version accepts on the admin API.
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY!;

setup("prepare database, fixtures and sessions", async ({ browser, baseURL }) => {
  mkdirSync(TMP, { recursive: true });
  mkdirSync(AUTH, { recursive: true });
  writeFixtures();

  const admin: Admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const users = await Promise.all(
    Object.entries(ACCOUNTS).map(async ([role, email]) => ({
      role, email, id: await ensureUser(admin, email),
    })),
  );

  const client = await connect();
  try {
    await resetTables(client);
    await client.query("insert into public.categories (name) values ($1)", [CATEGORY]);
    for (const { id, role } of users) {
      await client.query(
        `insert into public.user_roles (user_id, role) values ($1, $2)
         on conflict (user_id) do update set role = excluded.role`,
        [id, role],
      );
    }
  } finally {
    await client.end();
  }

  for (const { role, email } of users) {
    // baseURL rather than a literal port: the suite owns its own server now.
    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();
    await page.goto("/login");
    await page.getByLabel("อีเมล").fill(email);
    await page.getByLabel("รหัสผ่าน").fill(PASSWORD);
    await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
    // The shell footer is the stable place the signed-in role appears; the home
    // page also prints it, so a bare text match now hits two elements.
    await expect(page.getByTestId("shell-role")).toHaveText(`สิทธิ์ ${role}`);
    await context.storageState({ path: join(AUTH, `${role}.json`) });
    await context.close();
  }
});

type Admin = ReturnType<typeof createClient>;

async function ensureUser(admin: Admin, email: string): Promise<string> {
  const created = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (created.data.user) return created.data.user.id;

  // Left over from an earlier run: reset the password so the login form works.
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const existing = data.users.find((user) => user.email === email);
  if (!existing) {
    throw new Error(`could not create or find ${email}: ${created.error?.message ?? "unknown"}`);
  }
  await admin.auth.admin.updateUserById(existing.id, { password: PASSWORD, email_confirm: true });
  return existing.id;
}

/** Small, valid exports derived from the golden fixture so counts stay honest. */
function writeFixtures() {
  const golden = JSON.parse(readFileSync("tests/fixtures/golden-500.json", "utf8"));
  const template = golden.ads[0];

  // A different ad and page from anything in the golden export, so the snapshot
  // proof counts only its own two runs.
  const OWN = { ad_archive_id: "700000000000001", page_id: "700000000000002" };

  const single = (generatedAt: string, overrides: Record<string, unknown>) => ({
    ...golden,
    generated_at: generatedAt,
    source_rows: 1, unique_ads: 1, unique_pages: 1, unresolved_count: 0,
    quality_summary: { ...golden.quality_summary, resolved_records: 1, unresolved_records: 0 },
    ads: [{ ...template, ...OWN, ...overrides }],
    unresolved_ads: [],
  });

  writeFileSync(join(TMP, "small-old.json"), JSON.stringify(
    single("2026-08-10T00:00:00.000Z", {
      is_active: true, display_format: "IMAGE", publisher_platform: ["FACEBOOK"],
      images: [], videos: [], cards: [],
    }),
  ));

  writeFileSync(join(TMP, "small-new.json"), JSON.stringify(
    single("2026-08-28T00:00:00.000Z", {
      is_active: false, display_format: "VIDEO", publisher_platform: ["INSTAGRAM"],
      images: [], videos: [], cards: [],
    }),
  ));

  // Unknown is not the same as false, and an absent field is not zero.
  writeFileSync(join(TMP, "small-unknown.json"), JSON.stringify(
    single("2026-08-12T00:00:00.000Z", {
      ad_archive_id: "700000000000003", is_active: null, display_format: null,
      cta_type: null, cta_text: null, end_date: null, caption: null,
      images: [], videos: [], cards: [],
    }),
  ));

  // The uploaded JSON is untrusted. These values must reach the page as text
  // and as a filtered-out media URL, never as markup or a navigable scheme.
  writeFileSync(join(TMP, "xss.json"), JSON.stringify(
    single("2026-08-14T00:00:00.000Z", {
      ad_archive_id: "700000000000004",
      title: "<script>window.__pwned = 'title'</script>",
      body_text: "<img src=x onerror=\"window.__pwned='body'\">ลดน้ำหนัก",
      caption: "<svg onload=\"window.__pwned='caption'\">",
      link_url: "javascript:window.__pwned='link'",
      cta_text: "</td></tr><script>window.__pwned='cta'</script>",
      images: [{ url: "javascript:window.__pwned='img'" }, { url: "data:text/html,<script>1</script>" }],
      videos: [], cards: [],
    }),
  ));

  // One row without an ad_archive_id: importable in part, so the run lands as partial.
  const noId: Record<string, unknown> = { ...template, page_id: "999888777666" };
  delete noId.ad_archive_id;
  writeFileSync(join(TMP, "partial.json"), JSON.stringify({
    ...golden,
    generated_at: "2026-08-20T00:00:00.000Z",
    source_rows: 2, unique_ads: 1, unique_pages: 2, unresolved_count: 1,
    quality_summary: { ...golden.quality_summary, resolved_records: 1, unresolved_records: 1 },
    ads: [{ ...template, ad_archive_id: "700000000000009" }],
    unresolved_ads: [noId],
  }));

  /*
   * One page, five ads, built so the Page surfaces have something real to say:
   * three active / one stopped / one unreadable, only two of five with a
   * readable CTA, and a spread of formats and platforms. The 40% CTA coverage
   * is the point — it is what makes the low-coverage wording appear instead of
   * a confident percentage.
   */
  const PAGE = { page_id: "710000000000001" };
  const variants = [
    { id: "710000000000101", is_active: true,  display_format: "VIDEO", cta_type: "MESSAGE_PAGE",
      publisher_platform: ["FACEBOOK", "INSTAGRAM"], collation_count: 4, start: "2020-03-01T00:00:00.000Z" },
    { id: "710000000000102", is_active: true,  display_format: "IMAGE", cta_type: "LEARN_MORE",
      publisher_platform: ["FACEBOOK"], collation_count: 2, start: "2026-08-25T00:00:00.000Z" },
    { id: "710000000000103", is_active: true,  display_format: "IMAGE", cta_type: null,
      publisher_platform: ["INSTAGRAM", "MESSENGER"], collation_count: 1, start: "2026-07-01T00:00:00.000Z" },
    { id: "710000000000104", is_active: false, display_format: "MULTI_IMAGES", cta_type: null,
      publisher_platform: ["FACEBOOK"], collation_count: 1, start: "2021-05-01T00:00:00.000Z" },
    { id: "710000000000105", is_active: null,  display_format: null, cta_type: null,
      publisher_platform: [], collation_count: 1, start: "2019-11-01T00:00:00.000Z" },
  ];

  writeFileSync(join(TMP, "pages-mixed.json"), JSON.stringify({
    ...golden,
    generated_at: "2026-09-01T00:00:00.000Z",
    source_rows: variants.length, unique_ads: variants.length, unique_pages: 1, unresolved_count: 0,
    quality_summary: {
      ...golden.quality_summary, resolved_records: variants.length, unresolved_records: 0,
    },
    ads: variants.map((variant) => ({
      ...template, ...PAGE,
      ad_archive_id: variant.id,
      page_name: "คลินิกทดสอบ P2",
      page_categories: ["Medical Center", "Health/beauty"],
      page_like_count: 4321,
      is_active: variant.is_active,
      display_format: variant.display_format,
      cta_type: variant.cta_type,
      cta_text: variant.cta_type === null ? null : "ทัก",
      publisher_platform: variant.publisher_platform,
      collation_count: variant.collation_count,
      start_date: variant.start,
      images: [], videos: [], cards: [],
    })),
    unresolved_ads: [],
  }));

  writeFileSync(join(TMP, "invalid.json"), "{ this is not json");
}
