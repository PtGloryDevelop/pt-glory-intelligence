# Command Center + Ad-Library Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- Bring back `/command-center` as a ranking board (falling + four rankings).
- Give แอดของเรา the same directory frame: a header box with a big search, a falling strip, and a unit rail on the left.

**Architecture:**
- One new RPC `owned_command_center` (migration 0062) computes the falling ads on fixed latest-7 vs previous-7 windows, plus four top-10 rankings, in THB.
- A server reader plus the `/api/owned-ads/command-center` route expose it.
- A shared `UnitRail` component and a tiny `useJson` hook are used by both pages.
- The rule constants and the pure helpers live in `lib/owned-ads/command-center.ts`.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, CSS modules (tokens from `app/globals.css`), Supabase Postgres plpgsql, `node:test`, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-07-command-center-design.md`

**Rules:**
- Run commands from `PT-Glory-Claude-Code-System-v1/`.
- No commits unless the user approves.
- **Task 2 Step 3 writes to production: get explicit approval first.**
- Colours only from tokens (`tests/*` enforce it).

**Deviation from spec:** Command Center has a period select only, no page select. The page list is not available without an extra read. Add it later if asked.

---

## File map

| File | Change |
|---|---|
| `lib/owned-ads/command-center.ts` | **Create.** Constants, types, `isFalling`, `railOrder` |
| `tests/command-center.test.ts` | **Create** |
| `supabase/migrations/0062_owned_command_center{,.down}.sql` | **Create** |
| `lib/owned-ads/command-center-read.ts` | **Create.** Server reader |
| `app/api/owned-ads/command-center/route.ts` | **Create** |
| `app/(app)/owned-ads/use-json.ts` | **Create.** Fetch hook |
| `app/(app)/owned-ads/unit-rail.tsx` + `.module.css` | **Create** |
| `app/(app)/owned-performance.tsx` + `.module.css` | Header box, rail, falling strip, UnitSummary removed |
| `app/(app)/command-center/page.tsx` | Redirect only legacy `sort` links |
| `app/(app)/command-center/command-center.tsx` + `.module.css` | **Create.** Board |
| `components/shell/nav.ts`, `tests/nav-roles.test.ts` | Command Center menu item |
| `scripts/check-owned-performance.mjs` | Unit select → rail |

---

### Task 1: Rule constants and pure helpers

**Files:** Create `lib/owned-ads/command-center.ts`, `tests/command-center.test.ts`

- [ ] **Step 1: Failing test**

```ts
// tests/command-center.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { isFalling, railOrder } from "../lib/owned-ads/command-center.ts";

test("falling needs a good previous week, a weak latest week and real spend in both", () => {
  assert.equal(isFalling({ spend: 1000, value: 2500 }, { spend: 1000, value: 2490 }), true);
  assert.equal(isFalling({ spend: 1000, value: 2490 }, { spend: 1000, value: 1000 }), false, "2.49 before was never good");
  assert.equal(isFalling({ spend: 1000, value: 3000 }, { spend: 1000, value: 2500 }), false, "exactly 2.5 now has not fallen");
  assert.equal(isFalling({ spend: 999, value: 5000 }, { spend: 1000, value: 100 }), false);
  assert.equal(isFalling({ spend: 1000, value: 5000 }, { spend: 999, value: 100 }), false);
  assert.equal(isFalling({ spend: 1000, value: null }, { spend: 1000, value: 100 }), false);
});

test("rail lists units by ad count with their falling counts", () => {
  const rail = railOrder(
    [{ id: "b", name: "U11", ads: 388 }, { id: null, name: "x", ads: 397 }, { id: "a", name: "U5", ads: 412 }, { id: "c", name: "U3", ads: 388 }],
    [{ unit_id: "b", count: 22 }, { unit_id: null, count: 5 }],
  );
  assert.deepEqual(rail.map(unit => unit.name), ["U5", "U11", "U3"]);
  assert.deepEqual(rail.map(unit => unit.falling), [0, 22, 0]);
});
```

Run: `node --experimental-strip-types --test tests/command-center.test.ts`
Expected: FAIL, `ERR_MODULE_NOT_FOUND`

- [ ] **Step 2: Implement**

```ts
// lib/owned-ads/command-center.ts
import type { CompanyAd } from "./source-rows.ts";

/** Falling rule (7 Oct): previous 7 days ROAS ≥ 2.5, latest 7 days < 2.5, spend ≥ 1,000 THB in both. Mirrors migration 0062. */
export const FALL_ROAS = 2.5;
export const FALL_MIN_SPEND = 1000;
/** ROAS and "ใช้มานาน" rankings count only ads that spent at least this much in the period. */
export const RANK_MIN_SPEND = 1000;

export type CommandAd = CompanyAd & {
  unit_ids: string[]; unit_names: string[]; roas: number | null; cost_per_conversation: number | null;
  video_id: string | null; created_time: string | null;
  previous_roas?: number; recent_roas?: number; recent_spend?: number; previous_spend?: number;
};
export type CommandWindow = { from: string; to: string };
export type CommandCenterData = {
  windows: { recent: CommandWindow; previous: CommandWindow };
  falling_counts: { unit_id: string | null; count: number }[]; falling_total: number;
  falling: CommandAd[]; sales: CommandAd[]; cheap_chats: CommandAd[]; top_roas: CommandAd[]; oldest: CommandAd[];
};

type Week = { spend: number | null; value: number | null };
export function isFalling(previous: Week, recent: Week): boolean {
  if (previous.spend == null || recent.spend == null || previous.value == null || recent.value == null) return false;
  if (previous.spend < FALL_MIN_SPEND || recent.spend < FALL_MIN_SPEND) return false;
  return previous.value / previous.spend >= FALL_ROAS && recent.value / recent.spend < FALL_ROAS;
}

export type RailUnit = { id: string; name: string; ads: number; falling: number };
/** Units with the most ads first, then Thai name order; unassigned (null id) is shown separately by the caller. */
export function railOrder(units: { id: string | null; name: string; ads: number | null }[], falling: { unit_id: string | null; count: number }[]): RailUnit[] {
  const fallingBy = new Map(falling.map(row => [row.unit_id, row.count]));
  return units.filter((unit): unit is { id: string; name: string; ads: number | null } => unit.id != null)
    .map(unit => ({ id: unit.id, name: unit.name, ads: unit.ads ?? 0, falling: fallingBy.get(unit.id) ?? 0 }))
    .sort((a, b) => b.ads - a.ads || a.name.localeCompare(b.name, "th") || a.id.localeCompare(b.id));
}
```

Run: `node --experimental-strip-types --test tests/command-center.test.ts`
Expected: `ℹ pass 2`, `ℹ fail 0`

---

### Task 2: Migration 0062 `owned_command_center`

**Files:** Create `supabase/migrations/0062_owned_command_center.sql`, `supabase/migrations/0062_owned_command_center.down.sql`

- [ ] **Step 1: Up migration**

```sql
-- Command Center (7 Oct): falling ads on fixed windows plus four rankings for the selected period. THB only.
-- Falling = previous 7 days ROAS >= 2.5, latest 7 days < 2.5, spend >= 1,000 in both (mirrors lib/owned-ads/command-center.ts).
create or replace function public.owned_command_center(
  p_sync uuid,p_from date,p_to date,p_unit text,p_page_id text
) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp set plan_cache_mode=force_custom_plan as $$
declare result jsonb; v_to date;
begin
  if (select public.current_user_role()) is null or (select public.current_user_role()) not in ('analyst','admin') then
    raise exception 'Analyst authorization required' using errcode='42501';
  end if;
  if p_from is null or p_to is null or p_from>p_to or p_from<date '0001-01-01' or p_to>date '9999-12-31'
    or p_unit is null or (p_unit<>'' and p_unit !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    or p_page_id is null or (p_page_id<>'' and p_page_id !~ '^[0-9]{1,32}$') then
    raise exception 'Invalid command center filters' using errcode='22023';
  end if;
  select daily_to into v_to from public.owned_library_syncs where id=p_sync and status='completed' and daily_ready;
  if v_to is null then raise exception 'Completed daily snapshot required' using errcode='22023'; end if;
  with days as materialized (
    select d.* from public.owned_library_daily d
    where d.sync_id=p_sync and d.currency='THB' and (p_page_id='' or d.page_id=p_page_id)
      and d.insight_date between least(p_from,v_to-13) and greatest(p_to,v_to)
  ), period as materialized (
    select account_id,ad_id,
      coalesce(array_agg(distinct unit_id::text) filter(where unit_id is not null),'{}'::text[]) unit_ids,
      coalesce(array_agg(distinct unit_name) filter(where unit_name is not null),'{}'::text[]) unit_names,
      case when count(spend)=count(*) then sum(spend) end spend,
      case when count(conversations)=count(*) then sum(conversations) end conversations,
      case when count(purchases)=count(*) then sum(purchases) end purchases,
      case when count(purchase_value)=count(*) then sum(purchase_value) end purchase_value,
      case when count(spend)=count(*) and count(purchase_value)=count(*) and sum(spend)>0 then sum(purchase_value)/sum(spend) end roas,
      case when count(spend)=count(*) and count(conversations)=count(*) and sum(conversations)>0 then sum(spend)/sum(conversations) end cost_per_conversation
    from days where insight_date between p_from and p_to and (p_unit='' or unit_id::text=p_unit)
    group by account_id,ad_id having sum(spend)>0
  ), cards as materialized (
    select p.*,a.data->>'created_time' created_text,
      coalesce(a.data,'{}'::jsonb)||jsonb_build_object('account_id',p.account_id,'ad_id',p.ad_id,'currency','THB','status',a.status,
        'unit_ids',p.unit_ids,'unit_names',p.unit_names,'spend',p.spend,'conversations',p.conversations,'purchases',p.purchases,
        'purchase_value',p.purchase_value,'roas',p.roas,'cost_per_conversation',p.cost_per_conversation) card
    from period p left join public.owned_library_ads a on a.sync_id=p_sync and a.account_id=p.account_id and a.ad_id=p.ad_id
  ), windows as materialized (
    select account_id,ad_id,
      (array_agg(unit_id::text order by insight_date desc) filter(where unit_id is not null))[1] unit_id,
      (array_agg(unit_name order by insight_date desc) filter(where unit_name is not null))[1] unit_name,
      sum(spend) filter(where insight_date between v_to-6 and v_to) recent_spend,
      sum(purchase_value) filter(where insight_date between v_to-6 and v_to) recent_value,
      sum(spend) filter(where insight_date between v_to-13 and v_to-7) previous_spend,
      sum(purchase_value) filter(where insight_date between v_to-13 and v_to-7) previous_value
    from days where insight_date between v_to-13 and v_to group by account_id,ad_id
  ), falling_all as materialized (
    select w.*,w.previous_value/w.previous_spend previous_roas,w.recent_value/w.recent_spend recent_roas from windows w
    where w.previous_spend>=1000 and w.recent_spend>=1000 and w.previous_value is not null and w.recent_value is not null
      and w.previous_value/w.previous_spend>=2.5 and w.recent_value/w.recent_spend<2.5
  ), falling_list as materialized (
    select f.account_id,f.ad_id,f.recent_spend,coalesce(a.data,'{}'::jsonb)||jsonb_build_object('account_id',f.account_id,'ad_id',f.ad_id,'currency','THB','status',a.status,
      'unit_ids',case when f.unit_id is null then '{}'::text[] else array[f.unit_id] end,
      'unit_names',case when f.unit_name is null then '{}'::text[] else array[f.unit_name] end,
      'spend',f.recent_spend,'previous_spend',f.previous_spend,'recent_spend',f.recent_spend,
      'previous_roas',f.previous_roas,'recent_roas',f.recent_roas) card
    from falling_all f left join public.owned_library_ads a on a.sync_id=p_sync and a.account_id=f.account_id and a.ad_id=f.ad_id
    where p_unit='' or f.unit_id=p_unit
  )
  select jsonb_build_object(
    'windows',jsonb_build_object('recent',jsonb_build_object('from',v_to-6,'to',v_to),'previous',jsonb_build_object('from',v_to-13,'to',v_to-7)),
    'falling_counts',coalesce((select jsonb_agg(jsonb_build_object('unit_id',unit_id,'count',n)) from (select unit_id,count(*) n from falling_all group by unit_id) c),'[]'::jsonb),
    'falling_total',(select count(*) from falling_list),
    'falling',coalesce((select jsonb_agg(card order by recent_spend desc,account_id,ad_id) from (select * from falling_list order by recent_spend desc,account_id,ad_id limit 50) t),'[]'::jsonb),
    'sales',coalesce((select jsonb_agg(card order by purchase_value desc,account_id,ad_id) from (select * from cards where purchase_value>0 order by purchase_value desc,account_id,ad_id limit 10) t),'[]'::jsonb),
    'cheap_chats',coalesce((select jsonb_agg(card order by cost_per_conversation,account_id,ad_id) from (select * from cards where conversations>=30 and cost_per_conversation is not null order by cost_per_conversation,account_id,ad_id limit 10) t),'[]'::jsonb),
    'top_roas',coalesce((select jsonb_agg(card order by roas desc,account_id,ad_id) from (select * from cards where spend>=1000 and roas is not null order by roas desc,account_id,ad_id limit 10) t),'[]'::jsonb),
    'oldest',coalesce((select jsonb_agg(card order by created_text::timestamptz,account_id,ad_id) from (select * from cards where spend>=1000 and created_text is not null order by created_text::timestamptz,account_id,ad_id limit 10) t),'[]'::jsonb)
  ) into result;
  return result;
end $$;
revoke all on function public.owned_command_center(uuid,date,date,text,text) from public,anon;
grant execute on function public.owned_command_center(uuid,date,date,text,text) to authenticated;
comment on function public.owned_command_center(uuid,date,date,text,text) is 'Command Center for analysts. THB only. Falling uses fixed windows ending at the snapshot daily_to (latest 7 vs previous 7 days): previous ROAS >= 2.5, latest < 2.5, spend >= 1,000 in both; falling_counts ignore the unit filter. Rankings use the selected period and filters: sales by Meta purchase value; cheapest cost per chat from 30 chats; ROAS and oldest (Meta created_time) from 1,000 spend. Ratios use summed totals; CRM close rate is unavailable.';
notify pgrst,'reload schema';
```

- [ ] **Step 2: Down migration**

```sql
-- Removes the Command Center function (0062).
drop function if exists public.owned_command_center(uuid,date,date,text,text);
notify pgrst,'reload schema';
```

- [ ] **Step 3: ⚠ Apply (stop for explicit user approval)**

First confirm 0062 is the only pending migration (read-only):

```bash
node --env-file=.env.local --input-type=module -e "
import pg from 'pg';import {readdirSync} from 'node:fs';const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();
const a=new Set((await db.query('select version from public.schema_migrations')).rows.map(r=>r.version));
console.log(readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')&&!f.endsWith('.down.sql')&&!a.has(f)));await db.end();"
```

Expected: `[ '0062_owned_command_center.sql' ]`. Then, after approval:

Run: `node --env-file=.env.local scripts/migrate.mjs up`
Expected: `applied 0062_owned_command_center.sql`

---

### Task 3: Server reader and API route

**Files:** Create `lib/owned-ads/command-center-read.ts`, `app/api/owned-ads/command-center/route.ts`

- [ ] **Step 1: Reader**

```ts
// lib/owned-ads/command-center-read.ts
import "server-only";
import { dbUser } from "../db/user.ts";
import { cachedOwnedImage } from "./media-cache.ts";
import { ownedPerformancePeriod, parseOwnedPerformanceQuery, type OwnedPerformancePeriod } from "./performance.ts";
import type { CommandAd, CommandCenterData } from "./command-center.ts";

const LISTS = ["falling", "sales", "cheap_chats", "top_roas", "oldest"] as const;
export type CommandCenterResult = CommandCenterData & { period: OwnedPerformancePeriod };

/** JWT/RLS read on the latest completed daily snapshot; same validation as the ads list. Null when daily data is not ready. */
export async function getCommandCenter(input: URLSearchParams): Promise<CommandCenterResult | null> {
  const params = new URLSearchParams();
  for (const key of ["period", "from", "to", "unit", "pageId"]) for (const value of input.getAll(key)) params.append(key, value);
  const query = parseOwnedPerformanceQuery(params);
  const db = await dbUser();
  const latest = await db.from("owned_library_syncs").select("id,daily_ready,daily_from,daily_to").eq("status", "completed").order("finished_at", { ascending: false }).limit(1).maybeSingle();
  if (latest.error) throw new Error("Owned daily snapshot unavailable");
  if (!latest.data?.daily_ready) return null;
  const coverage = latest.data.daily_from && latest.data.daily_to ? { from: latest.data.daily_from, to: latest.data.daily_to } : null;
  const period = ownedPerformancePeriod(query, coverage);
  const result = await db.rpc("owned_command_center", { p_sync: latest.data.id, p_from: period.from, p_to: period.to, p_unit: query.unit, p_page_id: query.pageId });
  if (result.error) throw new Error("Command center unavailable");
  const data = result.data as CommandCenterData;
  for (const list of LISTS) data[list] = data[list].map((ad: CommandAd) => ({ ...ad, creative_url: cachedOwnedImage(ad) ?? null }));
  return { ...data, period };
}
```

- [ ] **Step 2: Route**

```ts
// app/api/owned-ads/command-center/route.ts
import { NextResponse } from "next/server";
import { ownedReportRoute } from "@/lib/owned-ads/store";
import { OwnedPerformanceQueryError } from "@/lib/owned-ads/performance";
import { getCommandCenter } from "@/lib/owned-ads/command-center-read";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return ownedReportRoute(async () => {
    try {
      const data = await getCommandCenter(new URL(request.url).searchParams);
      return data ? NextResponse.json(data) : NextResponse.json({ error: "ข้อมูลรายวันยังไม่พร้อม" }, { status: 503 });
    } catch (error) {
      if (error instanceof OwnedPerformanceQueryError) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ error: "Command Center ยังไม่พร้อมใช้งาน" }, { status: 503 });
    }
  });
}
```

- [ ] **Step 3: Verify against an independent SQL count** (dev server on :3000)

```bash
node --env-file=.env.local --input-type=module -e "
import pg from 'pg';const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();
const s=(await db.query(\"select id from owned_library_syncs where status='completed' order by finished_at desc limit 1\")).rows[0].id;
const r=(await db.query(\`with t as (select daily_to e from owned_library_syncs where id=\$1), w as (select account_id,ad_id,
 sum(spend) filter(where insight_date between (select e from t)-6 and (select e from t)) cs, sum(purchase_value) filter(where insight_date between (select e from t)-6 and (select e from t)) cv,
 sum(spend) filter(where insight_date between (select e from t)-13 and (select e from t)-7) ps, sum(purchase_value) filter(where insight_date between (select e from t)-13 and (select e from t)-7) pv
 from owned_library_daily where sync_id=\$1 and currency='THB' and insight_date between (select e from t)-13 and (select e from t) group by 1,2)
 select count(*) n from w where ps>=1000 and cs>=1000 and pv/ps>=2.5 and cv/cs<2.5\`,[s])).rows[0];console.log('sql falling',r.n);await db.end();
const {chromium}=await import('@playwright/test');const b=await chromium.launch();const c=await b.newContext({storageState:'e2e/.auth/trial.json'});
const res=await c.request.get('http://localhost:3000/api/owned-ads/command-center?period=7d',{timeout:120000});const j=await res.json();
console.log('api',res.status(),'falling_total',j.falling_total,'sum counts',j.falling_counts?.reduce((a,x)=>a+x.count,0),'lists',['falling','sales','cheap_chats','top_roas','oldest'].map(k=>k+'='+j[k]?.length).join(' '));
console.log('falling sorted',j.falling.every((x,i,a)=>i===0||a[i-1].recent_spend>=x.recent_spend),'cheap>=30',j.cheap_chats.every(x=>x.conversations>=30),'roas spend',j.top_roas.every(x=>x.spend>=1000));await b.close();"
```

Expected:
- `api 200`
- `falling_total` == `sum counts` == `sql falling`
- each list has ≤ 10 items, falling ≤ 50
- every check prints `true`

---

### Task 4: `useJson` hook and `UnitRail`

**Files:** Create `app/(app)/owned-ads/use-json.ts`, `app/(app)/owned-ads/unit-rail.tsx`, `app/(app)/owned-ads/unit-rail.module.css`

- [ ] **Step 1: Hook**

```ts
// app/(app)/owned-ads/use-json.ts
"use client";

import { useEffect, useState } from "react";

/** GET JSON for a URL. Keeps the last good data while a new URL loads; errors belong to the URL that failed. */
export function useJson<T>(url: string, retry = 0): { data: T | null; error: string | null; loading: boolean } {
  const [state, setState] = useState<{ url: string; data: T | null; error: string | null } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(url, { cache: "no-store", signal: controller.signal }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "เปิดข้อมูลไม่สำเร็จ");
      if (!controller.signal.aborted) setState({ url, data: body as T, error: null });
    }).catch((failure: Error) => {
      if (!controller.signal.aborted && failure.name !== "AbortError") setState(previous => ({ url, data: previous?.data ?? null, error: failure.message }));
    });
    return () => controller.abort();
  }, [url, retry]);
  return { data: state?.data ?? null, error: state?.url === url ? state.error : null, loading: state?.url !== url };
}
```

- [ ] **Step 2: Rail**

```tsx
// app/(app)/owned-ads/unit-rail.tsx
"use client";

import type { RailUnit } from "@/lib/owned-ads/command-center";
import styles from "./unit-rail.module.css";

const n = (value: number) => value.toLocaleString("th-TH");

/** Units as one-click filters (directory layout); chips below 900px. Red = falling ads in that unit. */
export function UnitRail({ units, unassigned, fallingTotal, active, onPick }: {
  units: RailUnit[]; unassigned: number | null; fallingTotal: number | null; active: string; onPick: (unit: string) => void;
}) {
  return <nav className={styles.rail} aria-label="ยูนิต" data-testid="unit-rail">
    <span className={styles.heading}>ยูนิต</span>
    <button type="button" aria-pressed={!active} className={styles.unit} onClick={() => onPick("")} data-testid="unit-rail-all">
      ทุกยูนิต<i>{fallingTotal ? <b className={styles.falling} title="สื่อที่เริ่มตก">{n(fallingTotal)}⚠</b> : null}</i>
    </button>
    {units.map(unit => <button key={unit.id} type="button" aria-pressed={active === unit.id} className={styles.unit} onClick={() => onPick(unit.id)} data-testid={`unit-rail-${unit.id}`}>
      {unit.name}<i>{n(unit.ads)}{unit.falling ? <> · <b className={styles.falling} title="สื่อที่เริ่มตก">{n(unit.falling)}⚠</b></> : null}</i>
    </button>)}
    {unassigned ? <span className={styles.unassigned} title="ผูกเพจเข้ายูนิตใน Ads Management">ยังไม่ผูกยูนิต<i>{n(unassigned)}</i></span> : null}
  </nav>;
}
```

```css
/* app/(app)/owned-ads/unit-rail.module.css */
.rail { display:grid; gap:2px; align-content:start; padding:10px; background:var(--surface); border:1px solid var(--line); border-radius:var(--radius); position:sticky; top:12px; }
.heading { padding:2px 8px 8px; font-size:var(--fs-eyebrow); font-weight:600; color:var(--muted); }
.unit,.unassigned { display:flex; justify-content:space-between; align-items:center; gap:8px; width:100%; min-height:36px; padding:6px 10px; border:0; border-radius:var(--radius-sm); background:transparent; color:var(--ink); font-size:var(--fs-meta); text-align:left; }
.unit { cursor:pointer; }
.unit:hover { background:var(--brand-tint); }
.unit[aria-pressed='true'] { background:var(--accent-blue); color:var(--surface); font-weight:600; }
.unit i,.unassigned i { font-style:normal; font-size:var(--fs-eyebrow); color:var(--muted); white-space:nowrap; }
.unit[aria-pressed='true'] i,.unit[aria-pressed='true'] .falling { color:var(--surface); }
.falling { color:var(--danger); font-weight:700; }
.unassigned { color:var(--muted); }
@media (max-width:900px) {
  .rail { position:static; display:flex; flex-wrap:wrap; gap:6px; padding:0; background:transparent; border:0; }
  .heading { display:none; }
  .unit,.unassigned { width:auto; border:1px solid var(--line); border-radius:var(--radius-pill); background:var(--surface); }
}
```

- [ ] **Step 3:** `npx tsc --noEmit` → exit 0

---

### Task 5: Library page: header box, rail, falling strip

**Files:** Modify `app/(app)/owned-performance.tsx`, `app/(app)/owned-performance.module.css`, `scripts/check-owned-performance.mjs:151`

- [ ] **Step 1: Imports and state**

Replace `import { UnitSummary } from "./owned-ads/unit-summary";` with:

```tsx
import { UnitRail } from "./owned-ads/unit-rail";
import { useJson } from "./owned-ads/use-json";
import { railOrder, type CommandCenterData } from "@/lib/owned-ads/command-center";
import type { UnitSummary as UnitSummaryData } from "@/lib/owned-ads/unit-summary";
import type { CompanyAd } from "@/lib/owned-ads/source-rows";
```

Change `const [selected, setSelected] = useState<OwnedPerformanceRow | null>(null);` to `useState<CompanyAd | null>(null);` (the drawer takes `CompanyAd`; falling cards are not performance rows).

After `const unitQuery = ...` (before `return`) add:

```tsx
  const centerQuery = new URLSearchParams(["period", "from", "to", "pageId", "unit"].flatMap(key => params.get(key) ? [[key, params.get(key)!]] : [])).toString();
  const unitData = useJson<UnitSummaryData>(`/api/owned-ads/units?${unitQuery}`);
  const center = useJson<CommandCenterData>(`/api/owned-ads/command-center?${centerQuery}`);
  const rail = railOrder(unitData.data?.units.map(row => ({ id: row.id, name: row.name, ads: row.current?.ad_count ?? null })) ?? [], center.data?.falling_counts ?? []);
  const fallingTotal = center.data ? center.data.falling_counts.reduce((sum, row) => sum + row.count, 0) : null;
```

- [ ] **Step 2: Header box (title, big search, filters)**

Replace the `<PageHeader title="แอดของเรา" description="สรุปรายยูนิต แล้วจัดอันดับแอดในช่วงเดียวกัน เพื่อเลือกแอดที่ต้องตรวจหรือเทียบกับคู่แข่ง" actions={` opening with:

```tsx
    <section className={styles.hero}><PageHeader title="คลังโฆษณาของเรา" description={data ? `${number(data.total)} แอดที่มีค่าแอด · ${date(data.period.from)} — ${date(data.period.to)}` : "กำลังเปิดคลังโฆษณา…"} actions={
```

Then move the whole `<form className={styles.filters} ...>…</form>` block (currently after `<UnitSummary …/>`) to directly after the `PageHeader` element, followed by `</section>`. In the moved form, delete the unit select line:

```tsx
        <label>ยูนิต<select data-testid="performance-unit" value={params.get("unit") ?? ""} onChange={event => change({ unit: event.target.value, pageId: "" })}><option value="">ทุกยูนิต</option>{choices?.units.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
```

- [ ] **Step 3: Falling strip replaces UnitSummary**

Replace `<UnitSummary query={unitQuery} activeUnit={params.get("unit") ?? ""} onPick={unit => change({ unit, pageId: "" })} />` with:

```tsx
    {center.data?.falling.length ? <section className={styles.falling} aria-labelledby="falling-heading" data-testid="falling-strip">
      <div className={styles.fallingHead}><h2 id="falling-heading">⚠ สื่อที่เริ่มตก · {number(center.data.falling_total)} แอด</h2><Link href={`/command-center${params.get("unit") ? `?unit=${params.get("unit")}` : ""}`}>ดูใน Command Center →</Link></div>
      <div className={styles.fallingRow}>{center.data.falling.slice(0, 4).map(ad => <button type="button" key={adKey(ad)} className={styles.fallingAd} onClick={() => setSelected(ad)}>
        <span className={styles.fallingThumb}>{ad.creative_url ? <AdImage src={ad.creative_url} alt="" sizes="52px" referrerPolicy="no-referrer" /> : null}</span>
        <span><b>{ad.ad_name}</b><small>{ad.unit_names[0] ?? "ยังไม่ผูกยูนิต"} · งบ {number(ad.recent_spend)}</small><span className={styles.drop}>ROAS {number(ad.previous_roas)} → {number(ad.recent_roas)}</span></span>
      </button>)}</div>
    </section> : null}
```

- [ ] **Step 4: Rail + results wrapper**

Replace `    {error ? <div className={styles.notice} role="alert">` (the first notice after the form) with:

```tsx
    <div className={styles.body}><UnitRail units={rail} unassigned={unitData.data?.unassigned.totals?.ad_count ?? null} fallingTotal={fallingTotal} active={params.get("unit") ?? ""} onPick={unit => change({ unit, pageId: "" })} /><div className={styles.results}>
    {error ? <div className={styles.notice} role="alert">
```

And replace the end of the data fragment, `    </> : null}\n    {selected ? <CompanyDetail`, with:

```tsx
    </> : null}
    </div></div>
    {selected ? <CompanyDetail
```

- [ ] **Step 5: Styles**

Change `.controls` to three columns: `.controls { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:16px; }`. Append before the `@media(max-width:640px)` rule:

```css
.hero { display:grid; gap:18px; padding:20px 22px; background:var(--surface); border:1px solid var(--line); border-radius:var(--radius); }
.hero > header { margin:0; }
.hero .filters { padding:0; border:0; background:transparent; }
.searchRow input { min-height:52px; font-size:var(--fs-subhead); }
.falling { display:grid; gap:12px; padding:14px 16px; background:var(--surface); border:1px solid var(--line); border-top:3px solid var(--danger); border-radius:var(--radius); }
.fallingHead { display:flex; justify-content:space-between; align-items:baseline; gap:12px; flex-wrap:wrap; }
.fallingHead h2 { margin:0; font-size:var(--fs-subhead); }
.fallingHead a { font-size:var(--fs-meta); }
.fallingRow { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:10px; }
.fallingAd { display:grid; grid-template-columns:52px minmax(0,1fr); gap:10px; align-items:center; padding:8px; border:1px solid var(--line); border-radius:var(--radius-sm); background:var(--surface); color:var(--ink); text-align:left; cursor:pointer; }
.fallingThumb { display:block; width:52px; height:52px; border-radius:var(--radius-sm); overflow:hidden; background:var(--surface-sunken); }
.fallingThumb img { width:100%; height:100%; object-fit:cover; }
.fallingAd b { display:block; font-size:var(--fs-meta); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.fallingAd small { display:block; color:var(--muted); font-size:var(--fs-eyebrow); }
.drop { display:block; color:var(--danger); font-weight:700; font-size:var(--fs-meta); }
.body { display:grid; grid-template-columns:200px minmax(0,1fr); gap:20px; align-items:start; }
.results { display:grid; gap:24px; min-width:0; }
@media (max-width:1100px) { .fallingRow { grid-template-columns:repeat(2,minmax(0,1fr)); } }
@media (max-width:900px) { .body { grid-template-columns:minmax(0,1fr); } .controls { grid-template-columns:minmax(0,1fr); } }
```

- [ ] **Step 6: Check script**

`scripts/check-owned-performance.mjs` line 151:

```js
      if (unit) await expect(page.getByTestId(`unit-rail-${unit}`)).toHaveAttribute('aria-pressed', 'true');
```

- [ ] **Step 7:** `npx tsc --noEmit && npx eslint "app/(app)/owned-performance.tsx" "app/(app)/owned-ads"` → exit 0

---

### Task 6: Command Center page and nav

**Files:** Modify `app/(app)/command-center/page.tsx`, `components/shell/nav.ts`, `tests/nav-roles.test.ts`. Create `app/(app)/command-center/command-center.tsx` + `.module.css`.

- [ ] **Step 1: Nav test first**

Append to `tests/nav-roles.test.ts`:

```ts
test('Command Center is an analyst page next to the ad library', () => {
  assert.equal(itemFor('viewer','Command Center'),undefined);
  for(const role of ['analyst','admin'] as const)assert.equal(itemFor(role,'Command Center')?.href,'/command-center');
  const work=visibleNav('analyst')[0].items.map(item=>item.label);
  assert.equal(work.indexOf('Command Center'),work.indexOf('แอดของเรา')+1);
});
```

Run: `node --experimental-strip-types --test tests/nav-roles.test.ts`. Expected: FAIL

- [ ] **Step 2: Nav item**

In `components/shell/nav.ts` after the แอดของเรา line:

```ts
    { label: "Command Center", icon: "target", href: "/command-center", minRole: "analyst" },
```

Run the nav test again. Expected: PASS

- [ ] **Step 3: Route**

Replace `app/(app)/command-center/page.tsx`:

```tsx
import { forbidden, redirect } from "next/navigation";
import { requireActorOrRedirect, satisfies } from "@/lib/auth/roles";
import { CommandCenter } from "./command-center";

export const dynamic = "force-dynamic";
/** The ranking board. Old links carried `sort` for the ads list (UI v2 merge); those still land there with their filters. */
export default async function CommandCenterPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActorOrRedirect();
  if (!satisfies(actor.role, "analyst")) forbidden();
  const params = await searchParams;
  if (params.sort != null) {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) for (const item of [value].flat()) if (item != null) next.append(key, item);
    redirect(`/owned-ads/performance?${next}`);
  }
  return <CommandCenter />;
}
```

- [ ] **Step 4: Board component**

```tsx
// app/(app)/command-center/command-center.tsx
"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import { PageHeader } from "@/components/shell/PageHeader";
import { AdImage } from "@/components/AdImage";
import type { CompanyAd } from "@/lib/owned-ads/source-rows";
import type { UnitSummary as UnitSummaryData } from "@/lib/owned-ads/unit-summary";
import type { CommandCenterResult } from "@/lib/owned-ads/command-center-read";
import { FALL_MIN_SPEND, FALL_ROAS, RANK_MIN_SPEND, railOrder, type CommandAd } from "@/lib/owned-ads/command-center";
import { closeRate, daysSinceCreated } from "@/lib/owned-ads/performance";
import { MIN_CHATS } from "@/lib/dashboard/updates";
import { UnitRail } from "../owned-ads/unit-rail";
import { useJson } from "../owned-ads/use-json";
import { CompanyDetail } from "../owned-ads/company-library";
import styles from "./command-center.module.css";

const PERIODS = [["3d", "3 วัน"], ["7d", "7 วัน"], ["14d", "14 วัน"], ["this-month", "เดือนนี้"], ["last-month", "เดือนที่แล้ว"], ["all", "ทั้งหมดที่นำเข้า"]] as const;
const n = (value: number | null | undefined, digits = 0) => value == null ? "—" : value.toLocaleString("th-TH", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const pct = (value: number | null) => value == null ? "—" : `${n(value * 100, 1)}%`;
const thai = (value: string) => new Date(`${value.slice(0, 10)}T12:00:00+07:00`).toLocaleDateString("th-TH", { day: "numeric", month: "short", timeZone: "Asia/Bangkok" });
const key = (ad: { account_id: string; ad_id: string }) => `${ad.account_id}:${ad.ad_id}`;

type Panel = { id: "sales" | "cheap_chats" | "top_roas" | "oldest"; title: string; why: string; main: (ad: CommandAd) => string; unit: string; sub: (ad: CommandAd) => string; good?: boolean; empty: string };
const PANELS: Panel[] = [
  { id: "sales", title: "💰 สื่อที่ทำเงิน", why: "ยอดขาย (Meta) สูงสุดในช่วงที่เลือก", main: ad => n(ad.purchase_value), unit: "บาท", sub: ad => `ROAS ${n(ad.roas, 2)} · ค่าแอด ${n(ad.spend)}`, empty: "ยังไม่มีแอดที่มียอดขายในช่วงนี้" },
  { id: "cheap_chats", title: "💬 ค่าทักถูกที่สุด", why: `เฉพาะแอดที่ทักตั้งแต่ ${MIN_CHATS} ครั้ง`, main: ad => n(ad.cost_per_conversation, 2), unit: "บาท/ทัก", sub: ad => `ทัก ${n(ad.conversations)} · %ปิด ${pct(closeRate(ad, MIN_CHATS))}`, empty: `ยังไม่มีแอดที่ทักถึง ${MIN_CHATS} ครั้ง` },
  { id: "top_roas", title: "📈 ROAS สูงสุด", why: `เฉพาะแอดที่ใช้งบตั้งแต่ ${n(RANK_MIN_SPEND)} บาท`, main: ad => n(ad.roas, 2), unit: "ROAS (Meta)", sub: ad => `ค่าแอด ${n(ad.spend)}`, good: true, empty: `ยังไม่มีแอดที่ใช้งบถึง ${n(RANK_MIN_SPEND)} บาท` },
  { id: "oldest", title: "⏳ สื่อที่ใช้มานาน", why: `ยังใช้งบอยู่ (ตั้งแต่ ${n(RANK_MIN_SPEND)} บาทในช่วงนี้) · นับจากวันที่สร้างแอด`, main: ad => n(daysSinceCreated(ad.created_time)), unit: "วัน", sub: ad => `ROAS ${n(ad.roas, 2)} · ค่าแอด ${n(ad.spend)}`, empty: `ยังไม่มีแอดที่ใช้งบถึง ${n(RANK_MIN_SPEND)} บาท` },
];

export function CommandCenter() {
  const params = useSearchParams(), pathname = usePathname();
  const period = PERIODS.find(([value]) => value === params.get("period"))?.[0] ?? "7d";
  const unit = params.get("unit") ?? "";
  const query = new URLSearchParams([["period", period], ...(unit ? [["unit", unit]] : [])]).toString();
  const center = useJson<CommandCenterResult>(`/api/owned-ads/command-center?${query}`);
  const units = useJson<UnitSummaryData>(`/api/owned-ads/units?period=${period}`);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<CompanyAd | null>(null);
  const data = center.data;
  const rail = railOrder(units.data?.units.map(row => ({ id: row.id, name: row.name, ads: row.current?.ad_count ?? null })) ?? [], data?.falling_counts ?? []);
  const unitName = unit ? rail.find(row => row.id === unit)?.name ?? "ยูนิตที่เลือก" : "ทุกยูนิต";

  function change(values: Record<string, string>) {
    const next = new URLSearchParams(params);
    for (const [name, value] of Object.entries(values)) if (value) next.set(name, value); else next.delete(name);
    window.history.replaceState(null, "", `${pathname}${next.size ? `?${next}` : ""}`);
    setOpen({});
  }
  const toggle = (id: string) => setOpen(value => ({ ...value, [id]: !value[id] }));
  const row = (ad: CommandAd, index: number, main: React.ReactNode, sub: string) => <li key={key(ad)}>
    <button type="button" className={styles.row} onClick={() => setSelected(ad)} data-testid={`cc-ad-${ad.ad_id}`}>
      <span className={styles.rank}>{index + 1}</span>
      <span className={styles.thumb}>{ad.creative_url ? <AdImage src={ad.creative_url} alt="" sizes="48px" referrerPolicy="no-referrer" /> : null}{ad.video_id ? <span className={styles.play} aria-label="วิดีโอ">▶</span> : null}</span>
      <span className={styles.name}><b>{ad.ad_name}</b><small>{sub}</small></span>
      <span className={styles.main}>{main}</span>
    </button>
  </li>;

  return <div className={styles.page} data-testid="command-center">
    <section className={styles.hero}><PageHeader title="Command Center" description={data ? `จัดอันดับสื่อของเรา · ${thai(data.period.from)} – ${thai(data.period.to)} · ${unitName}` : "กำลังจัดอันดับสื่อ…"}
      actions={<label className={styles.periodPick}>ช่วงวันที่<select value={period} onChange={event => change({ period: event.target.value })} data-testid="cc-period">{PERIODS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>} /></section>
    <div className={styles.body}>
      <UnitRail units={rail} unassigned={units.data?.unassigned.totals?.ad_count ?? null} fallingTotal={data ? data.falling_counts.reduce((sum, item) => sum + item.count, 0) : null} active={unit} onPick={value => change({ unit: value })} />
      <div className={styles.board}>
        {center.error ? <p className={styles.problem} role="alert">{center.error}</p> : null}
        {!data && !center.error ? <p className={styles.loading} role="status">กำลังจัดอันดับสื่อ…</p> : null}
        {data ? <>
          <section className={`${styles.panel} ${styles.fallingPanel}`} data-testid="cc-falling">
            <div className={styles.head}><h2>⚠ สื่อที่เริ่มตก · {n(data.falling_total)} แอด{unit ? ` ใน ${unitName}` : ""}</h2>
              {data.falling.length > 4 ? <button type="button" className={styles.more} onClick={() => toggle("falling")}>{open.falling ? "ย่อ" : `ดูทั้ง ${n(data.falling.length)} แอด`}</button> : null}</div>
            <p className={styles.why}>เคย ROAS ≥ {FALL_ROAS} ช่วง {thai(data.windows.previous.from)}–{thai(data.windows.previous.to)} แต่ {thai(data.windows.recent.from)}–{thai(data.windows.recent.to)} ต่ำกว่า {FALL_ROAS} · งบทั้งสองช่วงตั้งแต่ {n(FALL_MIN_SPEND)} บาท · เรียงจากงบล่าสุดมากสุด</p>
            {data.falling.length ? <ol className={styles.twoCol}>{(open.falling ? data.falling : data.falling.slice(0, 4)).map((ad, index) => row(ad, index, <span className={styles.bad}>{n(ad.previous_roas, 2)} → {n(ad.recent_roas, 2)}<small>ROAS</small></span>, `งบ 7 วันล่าสุด ${n(ad.recent_spend)} บาท`))}</ol>
              : <p className={styles.empty}>ไม่มีสื่อที่เริ่มตก{unit ? "ในยูนิตนี้" : ""}</p>}
          </section>
          {PANELS.map(panel => { const list = data[panel.id]; return <section key={panel.id} className={styles.panel} data-testid={`cc-${panel.id}`}>
            <div className={styles.head}><h2>{panel.title}</h2>{list.length > 3 ? <button type="button" className={styles.more} onClick={() => toggle(panel.id)}>{open[panel.id] ? "ย่อ" : "ดูทั้งหมด"}</button> : null}</div>
            <p className={styles.why}>{panel.why}</p>
            {list.length ? <ol className={styles.list}>{(open[panel.id] ? list : list.slice(0, 3)).map((ad, index) => row(ad, index, <span className={panel.good ? styles.good : undefined}>{panel.main(ad)}<small>{panel.unit}</small></span>, panel.sub(ad)))}</ol>
              : <p className={styles.empty}>{panel.empty}</p>}
          </section>; })}
        </> : null}
      </div>
    </div>
    {selected ? <CompanyDetail ad={selected} creativeUrl={selected.creative_url} mediaLoading={false} period={data ? { date_start: data.period.from, date_end: data.period.to } : null} returnTo={`${pathname}?${query}`} onClose={() => setSelected(null)} /> : null}
  </div>;
}
```

- [ ] **Step 5: Styles**

```css
/* app/(app)/command-center/command-center.module.css */
.page { display:grid; gap:20px; min-width:0; }
.hero { padding:20px 22px; background:var(--surface); border:1px solid var(--line); border-radius:var(--radius); }
.hero > header { margin:0; }
.periodPick { display:grid; gap:6px; font-size:var(--fs-meta); color:var(--muted); }
.periodPick select { min-height:40px; color:var(--ink); }
.body { display:grid; grid-template-columns:200px minmax(0,1fr); gap:20px; align-items:start; }
.board { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; min-width:0; }
.panel { background:var(--surface); border:1px solid var(--line); border-radius:var(--radius); padding:14px 16px; min-width:0; }
.fallingPanel { grid-column:1 / -1; border-top:3px solid var(--danger); }
.head { display:flex; justify-content:space-between; align-items:baseline; gap:10px; }
.head h2 { margin:0; font-size:var(--fs-subhead); }
.more { border:0; background:transparent; color:var(--accent-blue-ink); font-size:var(--fs-meta); padding:4px 0; cursor:pointer; white-space:nowrap; }
.why { margin:4px 0 8px; color:var(--muted); font-size:var(--fs-eyebrow); }
.list,.twoCol { list-style:none; margin:0; padding:0; }
.twoCol { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); column-gap:24px; }
.row { display:grid; grid-template-columns:18px 48px minmax(0,1fr) auto; gap:10px; align-items:center; width:100%; padding:8px 0; border:0; border-top:1px solid var(--line); background:transparent; color:var(--ink); text-align:left; cursor:pointer; }
.list li:first-child .row,.twoCol li:nth-child(-n+2) .row { border-top:0; }
.row:hover { background:var(--paper); }
.rank { color:var(--brand-ink); font-weight:700; font-size:var(--fs-meta); }
.thumb { position:relative; display:block; width:48px; height:48px; border-radius:var(--radius-sm); overflow:hidden; background:var(--surface-sunken); }
.thumb img { width:100%; height:100%; object-fit:cover; }
.play { position:absolute; left:3px; bottom:3px; display:grid; place-items:center; width:16px; height:16px; border-radius:50%; background:var(--ink); color:var(--surface); font-size:9px; }
.name { min-width:0; }
.name b,.name small { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.name b { font-size:var(--fs-meta); }
.name small { color:var(--muted); font-size:var(--fs-eyebrow); }
.main { text-align:right; font-weight:700; font-variant-numeric:tabular-nums; white-space:nowrap; }
.main small { display:block; font-weight:400; color:var(--muted); font-size:var(--fs-eyebrow); }
.good { color:var(--ok-ink); }
.bad { color:var(--danger); }
.empty,.loading { color:var(--muted); font-size:var(--fs-meta); margin:8px 0; }
.problem { grid-column:1 / -1; padding:12px 16px; border-radius:var(--radius-sm); background:var(--danger-tint); color:var(--danger); }
@media (max-width:1100px) { .board { grid-template-columns:minmax(0,1fr); } .twoCol { grid-template-columns:minmax(0,1fr); } .twoCol li:nth-child(2) .row { border-top:1px solid var(--line); } }
@media (max-width:900px) { .body { grid-template-columns:minmax(0,1fr); } }
```

- [ ] **Step 6:** `npx tsc --noEmit && npx eslint "app/(app)/command-center" components/shell/nav.ts tests/nav-roles.test.ts` → exit 0

---

### Task 7: Verification

- [ ] **Step 1:** `npx eslint "app/(app)" components lib tests scripts/check-owned-performance.mjs` → exit 0. Run `npm run test:unit 2>&1 | grep -E "^ℹ (pass|fail)"` → fail 12 (the same ones), pass ≥ 553.
- [ ] **Step 2: Browser (dev :3000)**. A Playwright script checks:
  - `/owned-ads/performance` shows `unit-rail` and `falling-strip`; the search input sits above the KPI tiles
  - clicking the first rail unit sets `unit=` in the URL and `aria-pressed=true`
  - the strip link goes to `/command-center?unit=…`
  - `/command-center` shows `cc-falling` + the four panels
  - "ดูทั้งหมด" expands a panel to more than 3 rows
  - clicking a row opens the drawer (`dialog[open]`)
  - `/command-center?sort=roas` redirects to `/owned-ads/performance?sort=roas`
  - at 390px wide neither page scrolls horizontally

  Save screenshots at 1440 and 390.
- [ ] **Step 3:** Report results with the screenshots.
