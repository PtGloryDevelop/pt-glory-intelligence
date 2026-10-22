# Overview: show what to look at first and what to do next

Date: 2026-10-07
Status: approved direction (mockup B "buttons say the job"). Deferred into sub-project 4 (executive overview),
where the decision list reuses these feed rules. See `2026-10-07-home-choice-and-ad-library-design.md` for the roadmap.

## Problem

Pilot surveys (round 1: 2 people, round 2: 3 people) all report the same thing: people open the site and don't
know where to start. The owner says the home layout is fine. What's missing is **where to start reading** and
**what to do after each item**. A first mockup added an ①②③ bar and pink "ทำต่อ" boxes, and the owner said it
looked odd. The approved direction adds almost nothing visible and makes **the primary button name the job**.

## Scope

Home page (`app/(app)/dashboard.tsx`), feed rules (`lib/dashboard/updates.ts`), and the flag line on our-ads
(`app/(app)/owned-performance.tsx`). Same layout, no new data, no new tables, no ①②③ bar, no coloured boxes.

## Changes

1. **Heading hint**: the "อัปเดตที่ควรรู้" heading's meta text becomes "เริ่มจากรายการบนสุด · {n} รายการรอทำ".
2. **The primary button names the job.** Each rule sets a primary action (label + target). For our-ad items the
   other target (ดูแอด / เทียบกับคู่แข่ง) stays as a secondary button.
3. **A short hint goes at the end of the existing detail line** (" · ถ้าค่าทักแพงขึ้น ควรลดงบกลับ"). There is no new
   line and no box.
4. **Feed order**: our ads (by spend, as now) → competitors (reserved slots, as now) → data upkeep last, shown at
   60% opacity. The limit stays at 6.
5. **Our-ads flag line** appends the same hint: "ควรตรวจ · {reason} · {hint}".
6. **When every item is done**, the empty state links to "ดูแอดคู่แข่งใหม่ →" (`/competitors?view=all&period=week`)
   and "ดูแอดของเราทั้งหมด →" (`/owned-ads/performance` + period).
7. **Colour legend above the "แอดใช้งบสูงสุด" table**: chips ดีกว่าภาพรวม (green) · แย่กว่าภาพรวม (red) ·
   ROAS ดีแต่งบลดลง (orange). The paragraph under the table keeps only the thresholds.
8. **Wording**: "ดูแล้ว" → "เสร็จแล้ว", with `title="จำไว้ในเครื่องนี้เท่านั้น"`. In the competitor list,
   "เปิดหลักฐาน" → "ดูแอดนี้".
9. **Catalog-template text**: competitor ad text in the overview strips `{{…}}` tokens. If nothing is left, it shows
   "แอดแคตตาล็อก (ไม่มีข้อความ)".

## Per-rule button and hint

| Rule (label) | Primary button → target | Secondary | Hint at end of detail line |
|---|---|---|---|
| ค่าทักสูงกว่าภาพรวม (ควรตรวจ) | เทียบหาคำเปิดใหม่ → compare | ดูแอด | ถ้ายังแพง ลดงบหรือปิดแอด |
| ใช้ค่าแอดเพิ่ม + ค่าทักถูก (โอกาส) | ดูแอดที่ทักถูก → ad | เทียบกับคู่แข่ง | ลองเพิ่มงบ หรือทำครีเอทีฟแนวเดียวกันอีกตัว |
| ใช้ค่าแอดเพิ่ม + ค่าทักไม่ถูก (ควรตรวจ) | เช็กยอดทักของแอดนี้ → ad | เทียบกับคู่แข่ง | ถ้าค่าทักแพงขึ้น ควรลดงบกลับ |
| ROAS ดีแต่ค่าแอดลดลง (ควรตรวจ) | เช็กงบของแอดนี้ → ad | เทียบกับคู่แข่ง | ถ้าไม่ได้ตั้งใจลด คืนงบเดิม |
| ทักถูกแต่ ROAS ต่ำ (ควรตรวจ) | ดูข้อเสนอในแอด → ad | เทียบกับคู่แข่ง | ให้ทีมแชทดูว่าทำไมปิดการขายไม่ได้ |
| แอดยังไม่ผูกยูนิต (ต้องแก้ข้อมูล) | ดูแอดของเรา → /owned-ads/performance | — | แจ้งแอดมินผูกเพจเข้ายูนิตใน Ads Management |
| ยูนิตยังไม่มีคำค้น (ข้อมูลยังไม่ตรง) | ใส่คำค้นให้ยูนิต → /competitors | — | (body already explains) |
| คู่แข่งมีแอดใหม่ (ควรดู) | ดูแอดใหม่ {n} ตัว → /competitors?view=all&period=week | — | ตัวไหนน่าสนใจ กด "เทียบกับแอดเรา" |
| ไม่มีความเปลี่ยนแปลง | ดูคู่แข่งของยูนิต → /competitors | — | — |
| เพจรอทีมตรวจ (รอทีมตรวจ) | ตรวจ {n} เพจ → /competitors | — | (body already explains) |

The hints are suggestions, not facts. They add no new numbers or thresholds.

## Implementation notes

- `AdFlag` gains `action: {label: string; to: 'ad' | 'compare'}` and `hint: string`. `buildUpdates` copies both
  onto `DashboardUpdate` as `action` and `hint`. Rival and data lines set `hrefLabel` to the button label and
  append the hint to `body`.
- `dashboard.tsx`'s `updateRow` renders the primary button from `action`, renders the other target as secondary,
  and appends `hint` to the body line.
- A small pure helper `cleanAdText(text)` in `lib/format/` strips `{{…}}` and returns null when nothing is left.

## Out of scope

- A remembered "my unit" picker, a team-shared "done" state, new layout or job cards, an ①②③ bar.

## Testing

- Unit tests:
  - every `adFlags` result has a non-empty `action.label` and `hint`
  - our-ad updates come before rival updates, and rival updates come before the data line
  - the rival "new" line links to `/competitors?view=all&period=week` and its label contains the count
  - `cleanAdText('{{product.brand}}')` returns null, and normal text is left unchanged
- Browser check on localhost:3000 at 1440 and 390 widths:
  - primary buttons carry the job label
  - the data item is last and faded
  - the legend sits above the table
  - the page has no horizontal scroll
- `npx tsc --noEmit`, eslint on the touched files, and `npm run test:unit` (the 12 failures that already fail are
  unchanged).
