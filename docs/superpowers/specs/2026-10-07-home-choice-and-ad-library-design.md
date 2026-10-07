# Per-person home and the ad library (sub-projects 1 + 2)

Date: 2026-10-07
Status: draft for review

## Why

- Pilot surveys (5 people) say "เข้ามาแล้วงง ไม่รู้จะเริ่มตรงไหน".
- The ad team then redrew the screen they want (photo, 7 Oct). It is the same sketch the site was built from on
  2 Oct (`docs/TEAM_FLOW_2026-10-02.md`): home = our ad library as creative cards, plus a Command Center ranking.
- The UI v2 change on 5 Oct moved home to "ภาพรวม" and merged Command Center into "แอดของเรา", so the team's
  starting screen disappeared.
- Managers want a different first screen (executive summary).
- Decision (7 Oct): **each person picks their own home**. %ปิด uses Meta-reported orders for now, labelled
  "(Meta)". Videos play **inside the card on click** (autoplay is not possible: Meta returns only its preview
  iframe for our videos, 4 of 4 tested).

## Roadmap (each item gets its own spec → plan → build)

1. **Per-person home** (this spec)
2. **แอดของเรา as the ad library** (this spec)
3. Command Center rankings: ทำเงิน / ค่าทักถูก / ROAS สูง / ใช้มานาน / เริ่มตก. "เริ่มตก" needs a definition first.
4. Executive overview: summary + decisions (feed rules from `2026-10-07-home-next-step-design.md`) + unit
   status + 8-week trend
5. AI summary per page/unit: best creative + what content to build on

## 1. Per-person home

- **Cookie `pg_home`**, value `overview` or `library`.
  - Settings: path `/`, max-age 1 year, SameSite=Lax. Not httpOnly; it holds a page preference, not a secret.
  - Any other value is ignored.
- **`/`** (`app/(app)/page.tsx`): the legacy-bookmark redirect runs first, unchanged. Then, if the role is
  analyst+ and `pg_home=library`, redirect to `/owned-ads/performance`. Otherwise render the overview, as now.
  Viewers always get the overview.
- **The nav "ภาพรวม" link points to `/market-overview`**, which already renders the same Dashboard. This keeps the
  overview reachable when someone's home is the library. The nav active state treats `/` and `/market-overview`
  as the same item.
- **Button in the page header** of both the overview and แอดของเรา:
  - "ตั้งเป็นหน้าแรกของฉัน" sets the cookie.
  - On the page that is already home, it shows a non-button label "✓ หน้าแรกของฉัน".
  - Title text: "จำไว้ในเครื่องนี้".
- No database change and no account setting. The choice is per device, which is fine for a page preference.

## 2. แอดของเรา as the ad library (`app/(app)/owned-performance.tsx`)

1. **Cards by default.** No `view` param means the creative grid. `view=table` opens the table. Old links with
   `view=grid` still work. The view toggle stays.
2. **%ปิด (Meta) = Meta-reported orders ÷ conversations × 100**, from `purchases` and `conversations`, which
   every row and the summary already carry.
   - The KPI tile "% ปิดจากระบบขาย —" becomes "%ปิด (Meta)" with the real value. Helper text:
     "ออเดอร์ที่ Meta รายงาน ÷ ทัก".
   - The card fact "% ปิด (ระบบขาย) —" becomes "%ปิด (Meta)".
   - The value shows only when conversations ≥ `MIN_CHATS` (30), otherwise "—", matching the ค่าทัก rule.
   - The `OwnedPerformanceSummary.close_rate: null` type is left alone. The value is computed in the UI from
     existing fields, so no new stored metric.
3. **Sort by %ปิด**: migration `0061` replaces `owned_performance_page`:
   - the `p_sort` allowlist gains `close_rate`
   - sort key = `purchases / nullif(conversations,0)`, with nulls last
   - default direction desc
   - matching `.down.sql`
   Add `close_rate` to `OWNED_PERFORMANCE_SORTS` and the SORTS list ("%ปิด (Meta)").
4. **Card content** follows the sketch:
   - page name · unit · status (as now)
   - **headline** (`title`) in bold above the caption, when present
   - ad name / VDO name, caption, campaign (as now)
   - **"ใช้มาแล้ว N วัน"** = Bangkok today − Meta `created_time`. Title text: "นับจากวันที่สร้างแอดใน Meta".
     It replaces "มีค่าแอด N วันในช่วงนี้", which moves to the title of the same line.
   - facts: ค่าแอด, ค่าทัก, ทัก, ROAS (Meta), Hook rate, %ปิด (Meta)
5. **Video plays in the card (B).**
   - The card's "ดูวิดีโอ" button swaps the thumbnail for the existing `OwnedVideoPlayer` with `autoLoad`, which
     uses Meta's preview iframe or the file when one exists.
   - Only one card plays at a time: the parent holds `playingKey`, and starting another card closes the previous.
   - "ดูรายละเอียด" still opens the drawer.
6. **Status in "เรียงตาม"**: not added as a sort. The existing "สถานะล่าสุด" filter sits beside it and answers the same
   need. Revisit if the team asks again.

## Out of scope

- Real close rate from the sales system (later, shown next to the Meta one).
- Muted autoplay (needs our own video copies and a page-level token).
- Sub-projects 3–5.

## Testing

- Unit:
  - the cookie parser accepts only `overview` and `library`
  - the close-rate helper returns null below 30 chats and the correct percentage otherwise
  - "ใช้มาแล้ว" days use Bangkok dates
  - `parseOwnedPerformanceQuery` accepts `sort=close_rate`
- Migration: the up/down pair applies on local Supabase, and `sort=close_rate` returns rows ordered by
  purchases/conversations.
- Browser on localhost:3000:
  - setting home to library makes `/` land on cards
  - nav "ภาพรวม" still opens the overview
  - clearing the cookie restores the overview
  - only one card plays at a time
  - at 390px wide the page has no horizontal scroll
- Update `scripts/check-owned-performance.mjs` and `scripts/check-ad-image-delivery.mjs` where they assume the
  table is the default.
- `npx tsc --noEmit`, eslint on the touched files, `npm run test:unit` (the 12 failures that already fail are
  unchanged).
