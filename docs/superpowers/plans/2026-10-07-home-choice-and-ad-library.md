# Per-person Home + Ad Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each person choose whether `/` opens the overview or the ad library. Make "แอดของเรา" open as creative cards with %ปิด (Meta), the headline, "ใช้มาแล้ว N วัน", and in-card video.

**Architecture:**
- The home choice is a non-secret cookie (`pg_home`), read on the server in `/`. The overview stays reachable at `/market-overview`, and the nav points there.
- %ปิด and the days-since-created count are pure helpers in `lib/owned-ads/performance.ts`, computed from fields every row already carries.
- Sorting by %ปิด needs migration `0061`, which replaces the `owned_performance_page` RPC.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, CSS modules, Supabase Postgres (plpgsql RPC), `node:test` unit tests, Playwright check scripts.

**Spec:** `docs/superpowers/specs/2026-10-07-home-choice-and-ad-library-design.md`

**Rules for this repo:**
- Run all commands from `PT-Glory-Claude-Code-System-v1/`.
- Unit tests run with `node --experimental-strip-types --test tests/<file>.test.ts`.
- Do not commit unless the user has approved committing in this session.
- **Task 9 Step 4 writes to the shared production database. Stop and get explicit user approval first.**

---

## File map

| File | Change |
|---|---|
| `lib/home-choice.ts` | **Create.** Cookie name, parser, and cookie string |
| `components/HomeChoice.tsx` + `.module.css` | **Create.** "ตั้งเป็นหน้าแรกของฉัน" / "✓ หน้าแรกของฉัน" |
| `app/(app)/page.tsx` | Redirect to the library when `pg_home=library` |
| `app/(app)/market-overview/page.tsx` | Pass the home choice to Dashboard |
| `app/(app)/dashboard.tsx` | `home` prop, header button |
| `components/shell/nav.ts`, `components/shell/AppShell.tsx` | ภาพรวม → `/market-overview`, active and wide handling |
| `app/(app)/owned-ads/performance/page.tsx` | Read the cookie and pass it to OwnedPerformance |
| `app/(app)/owned-performance.tsx` + `.module.css` | Header button, %ปิด, grid default, headline, days, inline video, sort |
| `lib/owned-ads/performance.ts` | `closeRate`, `daysSinceCreated`, `close_rate` sort |
| `supabase/migrations/0061_owned_performance_close_rate{,.down}.sql` | **Create.** RPC with the `close_rate` sort |
| `tests/home-choice.test.ts` | **Create** |
| `tests/owned-performance.test.ts`, `tests/nav-roles.test.ts` | Extend / update |
| `scripts/check-owned-performance.mjs` | %ปิด text |

---

### Task 1: Home-choice cookie helpers

**Files:**
- Create: `lib/home-choice.ts`
- Test: `tests/home-choice.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/home-choice.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { HOME_COOKIE, homeCookie, parseHomeChoice } from "../lib/home-choice.ts";

test("home choice accepts only the two known pages and defaults to the overview", () => {
  assert.equal(parseHomeChoice("library"), "library");
  assert.equal(parseHomeChoice("overview"), "overview");
  for (const value of [undefined, "", "LIBRARY", "admin", "/owned-ads", "library;x=1"]) assert.equal(parseHomeChoice(value), "overview");
});

test("the cookie lasts a year for the whole site and is not cross-site", () => {
  assert.equal(HOME_COOKIE, "pg_home");
  assert.equal(homeCookie("library"), "pg_home=library; Path=/; Max-Age=31536000; SameSite=Lax");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test tests/home-choice.test.ts`
Expected: FAIL, `Cannot find module '../lib/home-choice.ts'`

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/home-choice.ts
/** Which page `/` opens for this browser. A page preference, not a secret: readable by the page that sets it. */
export const HOME_COOKIE = "pg_home";
export type HomeChoice = "overview" | "library";
export const parseHomeChoice = (value: string | undefined): HomeChoice => value === "library" ? "library" : "overview";
export const homeCookie = (choice: HomeChoice) => `${HOME_COOKIE}=${choice}; Path=/; Max-Age=31536000; SameSite=Lax`;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test tests/home-choice.test.ts`
Expected: `ℹ pass 2`, `ℹ fail 0`

- [ ] **Step 5: Commit** (only if approved)

```bash
git add lib/home-choice.ts tests/home-choice.test.ts
git commit -m "feat(home): per-browser home choice cookie helpers"
```

---

### Task 2: HomeChoice button component

**Files:**
- Create: `components/HomeChoice.tsx`, `components/HomeChoice.module.css`

- [ ] **Step 1: Create the component**

```tsx
// components/HomeChoice.tsx
"use client";

import { useState } from "react";
import { homeCookie, type HomeChoice } from "../lib/home-choice.ts";
import styles from "./HomeChoice.module.css";

/** The server passes the current choice, so the first render already says the right thing (no hydration flash). */
export function HomeChoiceButton({ target, current }: { target: HomeChoice; current: HomeChoice }) {
  const [home, setHome] = useState(current);
  if (home === target) return <span className={styles.isHome} data-testid="home-choice" title="จำไว้ในเครื่องนี้">✓ หน้าแรกของฉัน</span>;
  return <button type="button" className={styles.set} data-testid="home-choice" title="จำไว้ในเครื่องนี้"
    onClick={() => { document.cookie = homeCookie(target); setHome(target); }}>ตั้งเป็นหน้าแรกของฉัน</button>;
}
```

```css
/* components/HomeChoice.module.css */
.isHome { display: inline-flex; align-items: center; min-height: 36px; font-size: var(--fs-meta); color: var(--muted); white-space: nowrap; }
.set { min-height: 36px; font-size: var(--fs-meta); white-space: nowrap; }
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 3: Commit** (only if approved)

```bash
git add components/HomeChoice.tsx components/HomeChoice.module.css
git commit -m "feat(home): home choice button"
```

---

### Task 3: `/` follows the choice; the overview lives at `/market-overview` in the nav

**Files:**
- Modify: `app/(app)/page.tsx`, `app/(app)/market-overview/page.tsx`, `app/(app)/dashboard.tsx` (props + header), `components/shell/nav.ts:10`, `components/shell/AppShell.tsx:69-73`
- Test: `tests/nav-roles.test.ts:21`

- [ ] **Step 1: Update the nav test first**

In `tests/nav-roles.test.ts`, change the first test:

```ts
test('overview is the shared entry at its own URL; owned daily performance remains analyst-only', () => {
  // `/` follows each person's home choice, so the menu points at the page that is always the overview.
  for(const role of ['viewer','analyst','admin'] as const)assert.equal(itemFor(role,'ภาพรวม')?.href,'/market-overview');
  assert.equal(itemFor('viewer','แอดของเรา'),undefined);
  for(const role of ['analyst','admin'] as const)assert.equal(itemFor(role,'แอดของเรา')?.href,'/owned-ads/performance');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --experimental-strip-types --test tests/nav-roles.test.ts`
Expected: FAIL, `'/' !== '/market-overview'`

- [ ] **Step 3: Point the nav at `/market-overview`**

`components/shell/nav.ts` line 10:

```ts
    { label: "ภาพรวม", icon: "home", href: "/market-overview" },
```

- [ ] **Step 4: AppShell treats `/` as ภาพรวม and keeps it wide**

In `components/shell/AppShell.tsx`, replace lines 69–72 (the `isWide` const and the `activeItem` const):

```tsx
  // `/` may render the overview (or redirect to a person's chosen home); either way the menu item is ภาพรวม.
  const path = pathname === "/" ? "/market-overview" : pathname;
  const isWide = path === "/market-overview" || /^\/datasets\/[^/]+/.test(path)
    || path === "/competitors" || path === "/owned-ads" || path === "/owned-ads/performance" || path === "/compare/ads" || path === "/command-center";

  const activeItem=sections.flatMap(section=>section.items).filter(item=>item.href&&(path===item.href||path.startsWith(`${item.href}/`))).sort((a,b)=>(b.href?.length??0)-(a.href?.length??0))[0];
```

- [ ] **Step 5: `/` redirects to the library for people who chose it**

Replace `app/(app)/page.tsx` entirely:

```tsx
import {cookies} from 'next/headers';
import {redirect} from 'next/navigation';
import {requireActorOrRedirect,satisfies} from '@/lib/auth/roles';
import {legacyPerformanceHref} from '@/lib/owned-ads/performance-navigation';
import {HOME_COOKIE,parseHomeChoice} from '@/lib/home-choice';
import {Dashboard} from './dashboard';
export const dynamic = "force-dynamic";
export default async function Home({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
  const actor=await requireActorOrRedirect();
  const canAnalyze=satisfies(actor.role,'analyst');
  const legacy=legacyPerformanceHref(await searchParams);
  if(canAnalyze&&legacy)redirect(legacy);
  // Viewers cannot open the library, so their home is always the overview.
  const home=parseHomeChoice((await cookies()).get(HOME_COOKIE)?.value);
  if(canAnalyze&&home==='library')redirect('/owned-ads/performance');
  return <Dashboard canAnalyze={canAnalyze} home={home}/>;
}
```

Replace `app/(app)/market-overview/page.tsx` entirely:

```tsx
import { cookies } from "next/headers";
import { requireActorOrRedirect, satisfies } from "@/lib/auth/roles";
import { HOME_COOKIE, parseHomeChoice } from "@/lib/home-choice";
import { Dashboard } from "../dashboard";

export const dynamic = "force-dynamic";
/** Always the overview, whatever this person chose as home; the menu's ภาพรวม points here. */
export default async function MarketOverview() {
  const actor = await requireActorOrRedirect();
  return <Dashboard canAnalyze={satisfies(actor.role, "analyst")} home={parseHomeChoice((await cookies()).get(HOME_COOKIE)?.value)} />;
}
```

- [ ] **Step 6: Dashboard takes `home` and shows the button**

In `app/(app)/dashboard.tsx`, add the imports after the `styles` import (line 13):

```tsx
import {HomeChoiceButton} from '@/components/HomeChoice';
import type {HomeChoice} from '@/lib/home-choice';
```

Change the signature on line 46:

```tsx
export function Dashboard({canAnalyze,home='overview'}:{canAnalyze:boolean;home?:HomeChoice}){
```

Replace the header's segment line (line 130):

```tsx
      {canAnalyze?<div className={styles.headActs}><HomeChoiceButton target="overview" current={home}/><div className={styles.seg} role="group" aria-label="ช่วงเวลา">{WINDOWS.map(value=><button key={value} type="button" aria-pressed={value===days} onClick={()=>setWindow(value)}>{value} วัน</button>)}</div></div>:null}
```

In `app/(app)/dashboard.module.css`, add after the `.seg` rules (line 8):

```css
.headActs { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
```

- [ ] **Step 7: Run tests and typecheck**

Run: `node --experimental-strip-types --test tests/nav-roles.test.ts && npx tsc --noEmit`
Expected: nav test PASS, tsc exit 0

- [ ] **Step 8: Commit** (only if approved)

```bash
git add "app/(app)/page.tsx" "app/(app)/market-overview/page.tsx" "app/(app)/dashboard.tsx" "app/(app)/dashboard.module.css" components/shell/nav.ts components/shell/AppShell.tsx tests/nav-roles.test.ts
git commit -m "feat(home): / follows each person's home; overview menu points to /market-overview"
```

---

### Task 4: Home button on แอดของเรา

**Files:**
- Modify: `app/(app)/owned-ads/performance/page.tsx`, `app/(app)/owned-performance.tsx:6,34,147`

- [ ] **Step 1: Pass the cookie from the server page**

Replace `app/(app)/owned-ads/performance/page.tsx` entirely:

```tsx
import {cookies} from 'next/headers';
import {forbidden} from 'next/navigation';
import {requireActorOrRedirect,satisfies} from '@/lib/auth/roles';
import {HOME_COOKIE,parseHomeChoice} from '@/lib/home-choice';
import {OwnedPerformance} from '../../owned-performance';

export const dynamic='force-dynamic';
export default async function Page(){
  const actor=await requireActorOrRedirect();
  if(!satisfies(actor.role,'analyst'))forbidden();
  return <OwnedPerformance home={parseHomeChoice((await cookies()).get(HOME_COOKIE)?.value)}/>;
}
```

- [ ] **Step 2: Accept the prop and render the button**

In `app/(app)/owned-performance.tsx`, add after line 6 (`PageHeader` import):

```tsx
import { HomeChoiceButton } from "@/components/HomeChoice";
import type { HomeChoice } from "@/lib/home-choice";
```

Line 34:

```tsx
export function OwnedPerformance({ home = "overview" }: { home?: HomeChoice }) {
```

On line 147, change the start of the PageHeader `actions` prop from `actions={<div className={styles.actions}><button type="button" onClick=` to:

```tsx
actions={<div className={styles.actions}><HomeChoiceButton target="library" current={home} /><button type="button" onClick=
```

- [ ] **Step 3: Check nothing else renders OwnedPerformance**

Run: `grep -rn "<OwnedPerformance" app components`
Expected: only `app/(app)/owned-ads/performance/page.tsx`

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 5: Commit** (only if approved)

```bash
git add "app/(app)/owned-ads/performance/page.tsx" "app/(app)/owned-performance.tsx"
git commit -m "feat(home): set the ad library as home from its header"
```

---

### Task 5: `closeRate` and `daysSinceCreated` helpers

**Files:**
- Modify: `lib/owned-ads/performance.ts` (append after `previousOwnedPerformancePeriod`, line 107)
- Test: `tests/owned-performance.test.ts`

- [ ] **Step 1: Write the failing tests**

Change the import on line 3 of `tests/owned-performance.test.ts` to:

```ts
import { parseOwnedPerformanceQuery, ownedPerformancePeriod, previousOwnedPerformancePeriod, OwnedPerformanceQueryError, closeRate, daysSinceCreated } from "../lib/owned-ads/performance.ts";
```

Append at the end of the file:

```ts
test("close rate is Meta-reported orders over chats and hides thin samples", () => {
  assert.equal(closeRate({ purchases: 13, conversations: 40 }, 30), 13 / 40);
  assert.equal(closeRate({ purchases: 2, conversations: 2 }, 30), null, "two chats and two orders must not read as 100%");
  assert.equal(closeRate({ purchases: null, conversations: 100 }, 30), null);
  assert.equal(closeRate({ purchases: 5, conversations: null }, 30), null);
  assert.equal(closeRate({ purchases: 0, conversations: 30 }, 30), 0);
});

test("days since creation count Bangkok calendar days", () => {
  const now = new Date("2026-10-07T03:00:00Z"); // 10:00 on 7 Oct in Bangkok
  assert.equal(daysSinceCreated("2026-10-06T18:30:00+00:00", now), 0); // 01:30 on 7 Oct in Bangkok
  assert.equal(daysSinceCreated("2026-10-06T16:00:00+00:00", now), 1); // 23:00 on 6 Oct in Bangkok
  assert.equal(daysSinceCreated("2024-11-18T09:41:15+00:00", now), 688);
  assert.equal(daysSinceCreated(null, now), null);
  assert.equal(daysSinceCreated("not a date", now), null);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --experimental-strip-types --test tests/owned-performance.test.ts`
Expected: FAIL, `closeRate is not a function` (or a missing export SyntaxError)

- [ ] **Step 3: Implement**

Append to `lib/owned-ads/performance.ts` after `previousOwnedPerformancePeriod` (after line 107):

```ts
/** %ปิด (Meta): Meta-reported orders ÷ conversations. Null below `minChats`, so two chats and two orders never read as 100%. */
export function closeRate(row: { purchases: number | null; conversations: number | null }, minChats: number): number | null {
  return row.purchases != null && row.conversations != null && row.conversations >= minChats ? row.purchases / row.conversations : null;
}

/** Whole Bangkok calendar days from Meta's ad creation time to `now`; null when unknown. Creation, not first delivery. */
export function daysSinceCreated(created: string | null, now = new Date()): number | null {
  const time = created ? Date.parse(created) : NaN;
  if (!Number.isFinite(time)) return null;
  const day = (ms: number) => Math.floor((ms + 7 * 3600000) / 86400000);
  return Math.max(0, day(now.getTime()) - day(time));
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --experimental-strip-types --test tests/owned-performance.test.ts`
Expected: all tests pass, `ℹ fail 0`

- [ ] **Step 5: Commit** (only if approved)

```bash
git add lib/owned-ads/performance.ts tests/owned-performance.test.ts
git commit -m "feat(owned): close rate (Meta) and days-since-created helpers"
```

---

### Task 6: Show %ปิด (Meta) on the KPI tile, the cards, and the table

**Files:**
- Modify: `app/(app)/owned-performance.tsx` (imports line 9, helpers near line 22, KPI line 151, table lines 181/193, card line 204, summary/basis lines 210–211), `scripts/check-owned-performance.mjs:62`

- [ ] **Step 1: Imports and percent formatter**

Line 9 becomes:

```tsx
import { closeRate, daysSinceCreated, defaultSortDir, ownedPerformancePeriod, parseOwnedPerformanceQuery, OWNED_PERFORMANCE_STATUSES } from "@/lib/owned-ads/performance";
```

After the `number` const (line 22) add:

```tsx
const percent = (value: number | null) => value == null ? "—" : `${number(value * 100)}%`;
```

- [ ] **Step 2: KPI tile**

In line 151, replace

```tsx
<KPIStat label="% ปิดจากระบบขาย" value="—" helper="ยังไม่ได้เชื่อมระบบขาย · ยอดปิด ÷ ทัก" testId="performance-close" />
```

with

```tsx
<KPIStat label="%ปิด (Meta)" value={<span className={styles.figure}>{percent(group ? closeRate(group, MIN_CHATS) : null)}</span>} helper="ออเดอร์ที่ Meta รายงาน ÷ ทัก" testId="performance-close" />
```

- [ ] **Step 3: Table column (plain header for now; Task 9 makes it sortable)**

In the table `<thead>` (line 181), insert after `{head("cost_per_conversation", "ค่าทัก")}`:

```tsx
<th className={styles.num}>%ปิด (Meta)</th>
```

In the row, insert after the ค่าทัก `<td>` (line 193):

```tsx
            <td className={styles.num}>{percent(closeRate(ad, MIN_CHATS))}</td>
```

- [ ] **Step 4: Card fact**

In line 204, replace `<Fact label="% ปิด (ระบบขาย)" value="—" />` with:

```tsx
<Fact label="%ปิด (Meta)" value={percent(closeRate(ad, MIN_CHATS))} />
```

- [ ] **Step 5: Correct the explanatory text**

In line 210, replace `ยังไม่มีข้อมูลยอดปิดจากระบบขาย จึงยังสรุป % ปิดหรือกำไรจริงไม่ได้ · การวิเคราะห์ AI ยังไม่เปิดใช้งาน` with:

```
%ปิด (Meta) ใช้ออเดอร์ที่ Meta รายงาน ไม่ใช่ยอดปิดจริงจากระบบขาย · ยังสรุปกำไรจริงไม่ได้ · การวิเคราะห์ AI ยังไม่เปิดใช้งาน
```

In line 211, replace `<p>% ปิดที่ทีมต้องการ = ยอดปิดจากระบบขาย ÷ จำนวนทัก · แสดง “—” จนกว่าจะเชื่อมข้อมูลขาย</p>` with:

```tsx
<p>%ปิด (Meta) = ออเดอร์ที่ Meta รายงาน ÷ จำนวนทัก · แสดงเมื่อทักตั้งแต่ {MIN_CHATS} ครั้ง · อาจไม่ตรงยอดปิดจริงของทีมแชท</p>
```

- [ ] **Step 6: Update the check script**

`scripts/check-owned-performance.mjs` line 62:

```js
  await expect(page.getByTestId('performance-close')).toContainText('%ปิด (Meta)');
```

- [ ] **Step 7: Typecheck and lint**

Run: `npx tsc --noEmit && npx eslint "app/(app)/owned-performance.tsx"`
Expected: exit 0, no lint output

- [ ] **Step 8: Commit** (only if approved)

```bash
git add "app/(app)/owned-performance.tsx" scripts/check-owned-performance.mjs
git commit -m "feat(owned): show %ปิด (Meta) on KPI, table and cards"
```

---

### Task 7: Cards by default, headline, "ใช้มาแล้ว N วัน"

**Files:**
- Modify: `app/(app)/owned-performance.tsx` (line 41, view toggle in line 178, card body line 203), `app/(app)/owned-performance.module.css` (after line 49)

- [ ] **Step 1: Default view = cards**

Line 41:

```tsx
  const view = params.get("view") === "table" ? "table" : "grid";
```

In line 178, change the two toggle buttons' `onClick`s:
- the table button: `onClick={() => change({ view: "table", page: String(page) })}`
- the grid button: `onClick={() => change({ view: "", page: String(page) })}`

- [ ] **Step 2: Headline and days in the card body**

In line 203, replace

```tsx
<h3>{ad.ad_name}</h3>{flagLine(ad)}<p className={styles.caption} title={ad.body_text ?? ad.title ?? undefined}>{ad.body_text ?? ad.title ?? "ต้นทางไม่มีแคปชัน"}</p>
```

with

```tsx
<h3>{ad.ad_name}</h3>{flagLine(ad)}{ad.title ? <p className={styles.headline}>{ad.title}</p> : null}<p className={styles.caption} title={ad.body_text ?? undefined}>{ad.body_text ?? "ต้นทางไม่มีแคปชัน"}</p>
```

and in the same line replace

```tsx
<span>{ad.delivery_days == null ? "ยังไม่มีวันที่ส่งแอด" : `มีค่าแอด ${number(ad.delivery_days)} วันในช่วงนี้`} · {date(ad.delivery_first)}</span>
```

with

```tsx
<span title={`นับจากวันที่สร้างแอดใน Meta${ad.delivery_days == null ? "" : ` · มีค่าแอด ${number(ad.delivery_days)} วันในช่วงนี้ · เริ่มมีค่าแอด ${date(ad.delivery_first)}`}`}>{daysSinceCreated(ad.created_time) == null ? "ไม่ทราบวันสร้างแอด" : `ใช้มาแล้ว ${number(daysSinceCreated(ad.created_time))} วัน`}</span>
```

- [ ] **Step 3: Headline style**

In `app/(app)/owned-performance.module.css`, after the `.caption` rule (line 49):

```css
.headline { font-size:var(--fs-meta); font-weight:600; line-height:1.6; overflow-wrap:anywhere; margin:0 0 6px; }
```

- [ ] **Step 4: Typecheck and lint**

Run: `npx tsc --noEmit && npx eslint "app/(app)/owned-performance.tsx"`
Expected: exit 0

- [ ] **Step 5: Commit** (only if approved)

```bash
git add "app/(app)/owned-performance.tsx" "app/(app)/owned-performance.module.css"
git commit -m "feat(owned): open as creative cards with headline and days since created"
```

---

### Task 8: Play video inside the card, one at a time

**Files:**
- Modify: `app/(app)/owned-performance.tsx` (imports, state near line 46, `change()` line 70, card media line 202), `app/(app)/owned-performance.module.css`

- [ ] **Step 1: Import and state**

After the `Creative` import (line 11) add:

```tsx
import { OwnedVideoPlayer } from "./owned-ads/owned-video-player";
```

After `const [selected, setSelected] = ...` (line 46) add:

```tsx
  // One card plays at a time; Meta gives our videos only as its preview iframe, so autoplay is not possible.
  const [playing, setPlaying] = useState<string | null>(null);
```

In `change()` (line 70), after `setSelected(null);` add `setPlaying(null);`.

- [ ] **Step 2: Card media**

In line 202, replace

```tsx
<button type="button" className={styles.previewButton} onClick={() => setSelected(ad)} aria-label={`${ad.video_id ? 'ดูวิดีโอ' : 'เปิดสื่อ'} ${ad.ad_name}`}><Creative url={media[adKey(ad)] ?? ad.creative_url} name={ad.ad_name} isVideo={Boolean(ad.video_id)} mediaLoading={!Object.hasOwn(media, adKey(ad))} /></button>
```

with

```tsx
{playing === adKey(ad) ? <div className={styles.inlinePlayer} data-testid={`performance-player-${ad.ad_id}`}>
          <OwnedVideoPlayer ad={ad} url={media[adKey(ad)] ?? ad.creative_url} autoLoad />
          <button type="button" className={styles.stopVideo} onClick={() => setPlaying(null)}>ปิดวิดีโอ</button>
        </div> : <button type="button" className={styles.previewButton} onClick={() => ad.video_id ? setPlaying(adKey(ad)) : setSelected(ad)} aria-label={`${ad.video_id ? 'เล่นวิดีโอ' : 'เปิดสื่อ'} ${ad.ad_name}`}><Creative url={media[adKey(ad)] ?? ad.creative_url} name={ad.ad_name} isVideo={Boolean(ad.video_id)} mediaLoading={!Object.hasOwn(media, adKey(ad))} /></button>}
```

- [ ] **Step 3: Player styles**

Append to `app/(app)/owned-performance.module.css`, before the `@media(max-width:640px)` rule:

```css
.inlinePlayer { display:grid; gap:8px; justify-items:center; padding:12px; background:var(--surface-sunken); }
.inlinePlayer iframe { height:420px; min-height:0; }
.stopVideo { min-height:36px; font-size:var(--fs-meta); }
```

- [ ] **Step 4: Typecheck and lint**

Run: `npx tsc --noEmit && npx eslint "app/(app)/owned-performance.tsx"`
Expected: exit 0

- [ ] **Step 5: Commit** (only if approved)

```bash
git add "app/(app)/owned-performance.tsx" "app/(app)/owned-performance.module.css"
git commit -m "feat(owned): play a card's video in place, one at a time"
```

---

### Task 9: Sort by %ปิด (migration 0061)

**Files:**
- Create: `supabase/migrations/0061_owned_performance_close_rate.sql`, `supabase/migrations/0061_owned_performance_close_rate.down.sql`
- Modify: `lib/owned-ads/performance.ts:7`, `app/(app)/owned-performance.tsx` (SORTS line 20, table header from Task 6)
- Test: `tests/owned-performance.test.ts`

- [ ] **Step 1: Write the down migration (restores 0060 exactly)**

```bash
cp supabase/migrations/0060_owned_performance_sort_direction.sql supabase/migrations/0061_owned_performance_close_rate.down.sql
```

Then replace line 1 of the new `.down.sql` with:

```sql
-- Restores the 0060 version (no close_rate sort).
```

- [ ] **Step 2: Write the up migration**

```bash
cp supabase/migrations/0060_owned_performance_sort_direction.sql supabase/migrations/0061_owned_performance_close_rate.sql
```

Make four edits in `0061_owned_performance_close_rate.sql`:

1. Line 1:
```sql
-- %ปิด (Meta) sort: close_rate = purchases ÷ conversations, only from 30 conversations (matches the UI). Signature, grants and other sorts unchanged.
```
2. The `p_sort` allowlist (line 17):
```sql
    or p_sort is null or p_sort !~ '^(spend|cost_per_conversation|roas|conversations|hook_rate|newest|longest|close_rate)(:(asc|desc))?$'
```
3. The sort-key `case` (line 91), replacing `when 'newest' then (g.delivery_first-date '2000-01-01')::numeric when 'longest' then g.delivery_days::numeric end sort_key) k` with:
```sql
      when 'newest' then (g.delivery_first-date '2000-01-01')::numeric when 'longest' then g.delivery_days::numeric
      when 'close_rate' then case when g.conversations>=30 then g.purchases::numeric/g.conversations end end sort_key) k
```
4. In the `comment on function` (line 128), replace `CRM close rate is unavailable.` with:
```
close_rate sort = Meta-reported purchases ÷ conversations from 30 conversations; CRM close rate is unavailable.
```

- [ ] **Step 3: Write the failing parse test**

Append to `tests/owned-performance.test.ts`:

```ts
test("close rate is a sort that opens highest first", async () => {
  const { ownedSortArg } = await import("../lib/owned-ads/performance.ts");
  const parsed = parseOwnedPerformanceQuery(new URLSearchParams("sort=close_rate"));
  assert.equal(parsed.dir, "desc");
  assert.equal(ownedSortArg(parsed), "close_rate");
  assert.equal(ownedSortArg(parseOwnedPerformanceQuery(new URLSearchParams("sort=close_rate&dir=asc"))), "close_rate:asc");
});
```

Run: `node --experimental-strip-types --test tests/owned-performance.test.ts`
Expected: FAIL, `OwnedPerformanceQueryError` (the sort is not in the allowlist yet)

- [ ] **Step 4: ⚠ Apply the migration (stop and get explicit user approval first)**

`DATABASE_URL` in `.env.local` is the shared production Supabase. Ask the user. Run only after a clear yes:

Run: `node --env-file=.env.local scripts/migrate.mjs up`
Expected: one line applying `0061_owned_performance_close_rate.sql`, exit 0

- [ ] **Step 5: Allow the sort in TypeScript**

`lib/owned-ads/performance.ts` line 7:

```ts
export const OWNED_PERFORMANCE_SORTS = ["spend", "cost_per_conversation", "roas", "conversations", "hook_rate", "newest", "longest", "close_rate"] as const;
```

`app/(app)/owned-performance.tsx` line 20 (SORTS) adds `["close_rate", "%ปิด (Meta)"]` after `["roas", "ROAS"]`:

```tsx
const SORTS: readonly [OwnedPerformanceSort, string][] = [["spend", "ค่าแอด"], ["conversations", "ทัก"], ["cost_per_conversation", "ค่าทัก"], ["roas", "ROAS"], ["close_rate", "%ปิด (Meta)"], ["hook_rate", "Hook rate"], ["newest", "วันที่เผยแพร่"], ["longest", "จำนวนวันที่มีค่าแอด"]];
```

In the table header, replace the Task 6 `<th className={styles.num}>%ปิด (Meta)</th>` with:

```tsx
{head("close_rate", "%ปิด (Meta)")}
```

- [ ] **Step 6: Run the tests and verify the live ordering**

Run: `node --experimental-strip-types --test tests/owned-performance.test.ts && npx tsc --noEmit`
Expected: pass, exit 0

Then, with the dev server on :3000, run:

```bash
node --input-type=module -e "
const {chromium}=await import('@playwright/test');const b=await chromium.launch();const c=await b.newContext({storageState:'e2e/.auth/trial.json'});
const j=await (await c.request.get('http://localhost:3000/api/owned-ads/performance?period=7d&sort=close_rate',{timeout:120000})).json();
const r=j.rows.map(x=>x.conversations>=30?x.purchases/x.conversations:null);console.log(r.slice(0,6));
console.log('desc:',r.filter(v=>v!=null).every((v,i,a)=>i===0||a[i-1]>=v));await b.close();"
```

Expected: `desc: true`, with the first values the highest rates

- [ ] **Step 7: Commit** (only if approved)

```bash
git add supabase/migrations/0061_owned_performance_close_rate.sql supabase/migrations/0061_owned_performance_close_rate.down.sql lib/owned-ads/performance.ts "app/(app)/owned-performance.tsx" tests/owned-performance.test.ts
git commit -m "feat(owned): sort by %ปิด (Meta) (migration 0061)"
```

---

### Task 10: Verification

- [ ] **Step 1: Static checks**

Run: `npx tsc --noEmit && npx eslint "app/(app)" components lib tests scripts/check-owned-performance.mjs`
Expected: exit 0

- [ ] **Step 2: Unit tests**

Run: `npm run test:unit 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: `fail 12` (the same 12 that already failed: guard scripts, migration numbering, colour tokens). If there are more, read the new failures.

- [ ] **Step 3: Browser check (dev server on :3000)**

Run this Playwright script (save it to a temp file inside the repo, run it, then delete it):

```js
import { chromium } from '@playwright/test';
const b = await chromium.launch(); const c = await b.newContext({ storageState: 'e2e/.auth/trial.json', viewport: { width: 1440, height: 900 } });
const p = await c.newPage(); const base = 'http://localhost:3000';
await p.goto(base + '/owned-ads/performance', { timeout: 120000 });
await p.getByTestId('performance-grid').waitFor({ timeout: 90000 });
console.log('grid default ok');
await p.getByTestId('home-choice').click();
await p.goto(base + '/'); await p.waitForURL('**/owned-ads/performance**', { timeout: 60000 });
console.log('home → library ok');
await p.getByTestId('nav-/market-overview').click(); await p.getByTestId('overview').waitFor({ timeout: 90000 });
console.log('nav overview ok, active:', await p.getByTestId('nav-/market-overview').getAttribute('aria-current'));
await p.getByTestId('home-choice').click(); await p.goto(base + '/'); await p.getByTestId('overview').waitFor({ timeout: 90000 });
console.log('home → overview ok');
await p.goto(base + '/owned-ads/performance'); const cards = p.getByTestId('performance-grid').locator('article');
await cards.first().waitFor();
const videos = cards.filter({ has: p.getByRole('button', { name: /^เล่นวิดีโอ/ }) });
await videos.nth(0).getByRole('button', { name: /^เล่นวิดีโอ/ }).click();
await videos.nth(1).getByRole('button', { name: /^เล่นวิดีโอ/ }).click();
console.log('players open:', await p.locator('[data-testid^="performance-player-"]').count());
await p.setViewportSize({ width: 390, height: 844 });
console.log('fits 390:', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
await b.close();
```

Expected:
- `grid default ok`
- `home → library ok`
- `nav overview ok, active: page`
- `home → overview ok`
- `players open: 1`
- `fits 390: true`

- [ ] **Step 4: Report** to the user with the results above and the screenshots of `/owned-ads/performance` (1440 and 390).
