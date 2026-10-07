# Command Center + ad-library layout (sub-project 3)

Date: 2026-10-07
Status: draft for review
Mockups: `.superpowers/brainstorm/8548-1791360032/content/library-directory-v1.html` (library, layout A) and
`command-center-v2.html` (Command Center, layout A)

## Why

The ad team's sketch asks for a Command Center that ranks our creatives: ทำเงิน / ค่าทักถูกที่สุด / ROAS สูงสุด /
ใช้มานาน / เริ่มตก. UI v2 folded it into แอดของเรา as sort buttons, and the team didn't find it there. The owner also
asked for a directory-style layout (cult/ui "Directory"), adapted to our light theme. Both pages share one frame:
a header box, a unit list on the left, and the content on the right.

## Decisions (7 Oct)

- **สื่อที่เริ่มตก** (falling), using Bangkok dates:
  - previous 7 days ROAS (Meta) ≥ 2.5
  - latest 7 days ROAS < 2.5
  - spend ≥ 1,000 THB in **both** windows
  - The windows are fixed: the last 7 days with data (snapshot `daily_to`) and the 7 days before them. They do
    not follow the page's period filter.
  - Ordered by latest-7-day spend, highest first. The same 2.5 applies to every unit.
  - Measured on 7 Oct: 140 ads, covering 65% of spend.
- **Rankings** (selected period, unit and page filters):
  - ทำเงิน = ยอดขาย (Meta) `purchase_value`, highest first
  - ค่าทักถูกที่สุด = `cost_per_conversation` ascending, conversations ≥ 30
  - ROAS สูงสุด = ROAS descending, spend ≥ 1,000
  - ใช้มานาน = Meta `created_time` oldest first, spend ≥ 1,000 in the period ("still being run")
- **Layout A** on both pages: unit list on the left, collapsing to a horizontal chip row below 900px.
  Command Center shows falling as a full-width panel, then the other four in a 2×2 board.
- Light theme, existing tokens and CSS modules. No Tailwind or shadcn, and no template code.

## 1. Data: migration `0062_owned_command_center`

New `security definer` function `public.owned_command_center(p_sync uuid, p_from date, p_to date, p_unit text, p_page_id text)`.

- **Guards:** analyst/admin only, with the same role check, input validation and `search_path` as
  `owned_performance_page`. Grants go to `authenticated` only. A `.down.sql` drops the function.
- **Scope:**
  - The THB currency only (rankings across currencies are meaningless).
  - Eligible ads are those with known positive spend in the window, matching `owned_performance_page`.
- **Returns** jsonb:
  - `windows`: `{ recent: {from,to}, previous: {from,to} }` for the falling rule
  - `falling_counts`: `[{ unit_id, count }]` for every unit, ignoring `p_unit`, plus a `null` unit for unassigned
  - `falling`: up to 50 ads for `p_unit`/`p_page_id`, ordered by recent spend desc
  - `sales`, `cheap_chats`, `top_roas`, `oldest`: up to 10 ads each for the period, `p_unit` and `p_page_id`
  - Each ad uses the same card shape that `owned_performance_page` returns (account/ad ids, names, unit names,
    status, title, body, creative_url, video_id, created_time, spend, conversations, purchases, purchase_value,
    cost_per_conversation). Falling ads add `previous_roas`, `recent_roas`, `recent_spend`, `previous_spend`.
- The thresholds (2.5, 1,000, 30) are literals in SQL with a comment, mirrored as exported TS constants for the labels.

**API:** `GET /api/owned-ads/command-center?period&from&to&unit&pageId`
- analyst+ (`ownedReportRoute`)
- reuses `parseOwnedPerformanceQuery` for validation
- calls the RPC on the latest completed daily snapshot
- runs every row's `creative_url` through `cachedOwnedImage`, as the performance read does

## 2. Shared UI: `UnitRail`

`app/(app)/owned-ads/unit-rail.tsx`
- **Inputs:** units with ad counts (from the existing `/api/owned-ads/units`), falling counts (from the command
  center API), the active unit, and `onPick`.
- **Content:** "ทุกยูนิต" first, then the units sorted by ad count, then "ยังไม่ผูกยูนิต". Each row shows the ad
  count and a red falling count when > 0.
- **Width:** a left column ≥ 900px; below that, horizontal chips.

## 3. แอดของเรา (library) changes

- **Header box:**
  - title "คลังโฆษณาของเรา"
  - "{n} แอดที่มีค่าแอดใน {period}" + data date
  - the HomeChoice and refresh buttons
  - **the big search input**
  - period / page / status selects. The unit select is removed; the rail replaces it.
- KPI tiles as they are now.
- **Falling strip:** up to 4 falling ads for the current unit, plus "ดูใน Command Center →"
  (`/command-center?unit=…`). It is hidden when there are none.
- **Body:** `UnitRail` on the left, and the existing sort buttons and cards/table on the right.
- **The `UnitSummary` panel is removed from this page.** Its one-line totals duplicate the KPI tiles, and the rail
  replaces its unit picking. `/api/owned-ads/units` stays, because the rail uses it.

## 4. Command Center page (`/command-center`)

- **Routing:** if the URL has a `sort` param (old Command Center links), keep redirecting to
  `/owned-ads/performance`. Otherwise render the new page (analyst+).
- **Nav:** "Command Center" (icon `target`, analyst+), between แอดของเรา and คู่แข่ง.
- **Header box:** title, period + unit text, period and page selects.
- **Body:** `UnitRail` + the board.
  - Falling: a full-width panel, 4 rows in two columns, "ดูทั้ง {n} แอด" expands in place to the full list (≤ 50).
    Each row shows ROAS previous → recent in red, and recent spend.
  - Four 2×2 panels, 3 rows each, "ดูทั้งหมด" expands in place to 10. Each row shows rank, thumbnail (▶ badge for
    video), name, a secondary line, and the panel's main number.
  - Clicking a row opens the existing `CompanyDetail` drawer, which plays video.
- **Empty states:**
  - "ไม่มีสื่อที่เริ่มตกในยูนิตนี้"
  - "ยังไม่มีแอดที่ทักถึง 30 ครั้ง"
  - and similar for the other panels

## Out of scope

- Per-unit ROAS targets
- Sales-system close rate
- AI summary (sub-project 5)
- Executive overview (sub-project 4)
- New sorts on the library page

## Testing

- **SQL:** after applying 0062, the RPC's falling count for all units equals the ad-hoc query count for the same
  windows (140 on the 5 Oct snapshot). For the four rankings, check that ordering and thresholds hold on the live
  output.
- **Unit:**
  - the falling-rule TS mirror (`isFalling(prev, recent)`) for edge values: 2.5 exactly, spend 999 / 1,000
  - the rail ordering
  - the API param validation
- **Browser (localhost:3000, 1440 and 390):**
  - the rail filters both pages
  - the falling strip links to Command Center with the unit
  - the panels expand
  - a row opens the drawer
  - old `/command-center?sort=roas` still redirects
  - no horizontal scroll at 390
- `npx tsc --noEmit`, eslint, `npm run test:unit` (the 12 failures that already fail are unchanged).
- **Applying 0062 to production needs explicit approval, as 0061 did.**
