# Competitor page in the directory frame (design + plan)

Date: 2026-10-07 · Status: approved (mockup A, `.superpowers/brainstorm/10923-1791363115/content/rivals-v1.html`)

## Why

- The competitor page lists pages only. To see any rival creative, people have to switch to the "คลังแอดทั้งหมด" tab.
- 3 of 5 survey respondents start from rival ads, and marketing/content want ideas.
- Admin-only clutter dominates the first screen: a big "ค้นและเก็บแอดเพิ่ม" button and the Apify cost box.
- Units without keywords hide in a form at the bottom of the page.

## Design (approved)

- **Header box** (`app/(app)/competitors/page.tsx`):
  - title "ส่องคู่แข่ง", one-line description
  - a small "⚙ จัดการการเก็บข้อมูล" link to `/collect` (analyst+) instead of the big button
  - on the board view only, a big search that GETs `/competitors?view=all&search=…`
  - the existing 4 tabs, kept so existing links still work
- **Board** (`rival-board.tsx`) = `UnitRail` plus content:
  - **Rail:** units with keywords show "{pages} เพจ · {new} ใหม่". Units without keywords are dimmed with
    "+ คำค้น"; selecting one shows the "start with keywords" panel for that unit. "ทุกยูนิต" combines every unit's
    pages. The selected unit is stored in `?unit=` (replaceState).
  - **🆕 แอดใหม่ของคู่แข่ง:** catalog ads first seen in 7 days from the scope's pages, newest first. 4 cards,
    "ดูทั้งหมด" loads 24. The header shows the total from the API and the last collected date.
  - **🔥 ยิงนานที่สุด:** active catalog ads from the same pages, `ad_age_days` desc. 4 cards, "ดูทั้งหมด" loads 24.
  - Cards reuse `AdCard` and open `AdDrawer`, whose compare link analysts already have. Each card adds a
    "เทียบกับแอดเรา" link for analysts.
  - **Pages table** per unit in scope: page (avatar, name, sample as title), แอดใหม่ 7 วัน, กำลังแสดง, ยิงนานสุด,
    "เพจนี้คือ" (3 small buttons, or the confirmed chip plus "เปลี่ยน"), and the เก็บแอดใหม่ toggle. Keyword chips
    and the add input go above the table; the hidden-pages note goes below it.
  - **Removed:** the ①②③ how-to line, the right column (Apify UsageBars and the cost estimate; admins keep
    `/collector`), and the bottom "เพิ่มคำค้นให้ยูนิตอื่น" form (the rail replaces it).
  - **Footnote:** "Ads Library ไม่มีข้อมูลค่าแอดของคู่แข่ง และไม่มียอดขาย · “ใหม่” คือระบบเพิ่งเห็นครั้งแรก ·
    เพจไม่เท่ากับแบรนด์". The wording has to pass `tests/ui-vocabulary.test.ts` denials.

## Data (no migration)

- `getCatalogAds` gains `pageIds?: string[]` (`.in('page_id', …)`) and `sort?: 'new' | 'age'`:
  - `new` = `first_seen_at` desc
  - `age` = `ad_age_days` desc
  - default stays `last_seen_at` desc
- `/api/catalog/ads` accepts:
  - `pages` = a comma list of 1–60 numeric ids, parsed by `pageList()` in `lib/read/request.ts`
  - `sort=new|age`
  - anything else returns 400
- `useJson` accepts `null` (idle) for scopes without pages.
- `RailUnit` gains optional `note` and `dim`; `UnitRail` renders the note in place of the counts.

## Tasks

1. `pageList()` + tests (`tests/read-request-pages.test.ts`): valid list, dedupe, >60, non-numeric, empty.
2. Catalog options + route params; verify with a live request that `pages=` returns only those page_ids, `sort=age`
   is non-increasing in `ad_age_days`, and `sort=new` is non-increasing in `first_seen_at`.
3. `useJson(null)`; `RailUnit.note/dim` + rendering.
4. `page.tsx` header box + CSS.
5. `rival-board.tsx` restructure + CSS (keep testids `rival-board`, `competitor-board-tab`).
6. Verify:
   - `tsc`, eslint, `npm run test:unit` (only the 12 known failures)
   - browser at 1440 and 390: rail switching, both ad strips render cards, "ดูทั้งหมด" loads more, the drawer
     opens, the relation/track buttons render (not clicked: they write shared team data), no horizontal scroll
