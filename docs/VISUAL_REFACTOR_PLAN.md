# Visual Refactor Plan — V1–V5

อ้างอิง: `docs/PT_GLORY_UI_HANDOFF.md` + **Amendment A1 (orange color system)**
ฐาน: `docs/CURRENT_UI_INVENTORY.md` · baseline `71577e2`

Base44 = visual reference เท่านั้น · production app คือความจริงของ API / Supabase / RLS /
authorization / import / validator / normalizer / snapshot / historical observations /
data quality / deterministic rules / security

---

## 0. Decisions (อนุมัติแล้ว 2026-09-02)

| หัวข้อ | มติ |
| --- | --- |
| Styling | **CSS Modules + centralized CSS custom properties** · ไม่เอา Tailwind |
| Palette | Amendment A1 · brand `#F26522` · CTA = orange fill + charcoal text · **ห้าม white บน `#F26522`** |
| Active sidebar | **ไม่ใช่บล็อกส้มทึบ** — tint 8–12% + charcoal text + `#F26522` left indicator |
| Route group | ย้าย authenticated pages เข้า `app/(app)/` · URL / auth / API ไม่เปลี่ยน |
| B1/B2/B3 | อนุมัติ migration **0020 read-layer projection เท่านั้น** |
| V3 tests | Grid เป็น default · table test ต้องสลับโหมดก่อน · ห้ามลดความเข้มของ assertion |

## 0.1 Migration 0020 — ขอบเขตที่อนุมัติ

**ทำได้:** read RPC/function projection · snapshot-safe media projection ·
dataset-list projection จาก canonical data เดิม · deterministic server-side sort allowlist

**ห้าม:** business/source data ใหม่ · master semantics ใหม่ · แก้ table/column ·
แก้ RLS semantics · แก้ snapshot semantics · แก้ import/validator/normalizer

ต้องมี integration test + down migration

| Item | ต้องการอะไร | เงื่อนไข |
| --- | --- | --- |
| **B1** media ใน Ad Card | เพิ่ม `media` ใน projection ของ `dataset_ads_page` | ต้องมาจาก observation ของ run นั้น · **ห้ามผสม media ล่าสุดเข้า dataset เก่า** |
| **B2** dataset list columns | function/projection ใหม่ join `datasets` + `collection_runs` + count/quality เดิม | **ห้าม** เพิ่มคอลัมน์เก็บซ้ำ |
| **B3** explorer sort | พารามิเตอร์ sort ที่เป็น **allowlist ชัดเจน** | **ห้าม**รับชื่อ field / ทิศทางจาก client ตรง ๆ |

0020 จำเป็นตั้งแต่ **V2** (B2) และ **V3** (B1, B3) · **V1 ไม่ต้องใช้**

---

## 1. Component mapping

| Target | ที่มาปัจจุบัน | การกระทำ |
| --- | --- | --- |
| `AppSidebar` | — | ใหม่ · 4 section ตาม §5 · route Phase 2 = disabled ไม่มีข้อมูล |
| `PageHeader` | `<h1>` เปล่าใน 5 ไฟล์ | ใหม่ แทนทั้ง 5 |
| `ContextBar` | `<section data-testid="context-bar">` + `Item()` | สกัดออกมาเป็น component กลาง |
| `QualityBadge` | tier เป็น text ดิบ 2 ที่ | ใหม่ |
| `QualityStrip` | `quality-strip` + `CoverageTable` (ซ้ำกัน) | รวมเหลืออันเดียว (V2) |
| `StatusBadge` | ternary ใน explorer + drawer | ใหม่ · Active / Inactive / **Unknown** |
| `FilterToolbar` | inline div + `Select()` | สกัด + sticky/count/reset/toggle (V3) |
| `AdCard` | — | ใหม่ (V3) |
| `AdTable` | `ads-table` | คงไว้ · restyle · เพิ่ม Creative + Ad Age (V3) |
| `AdDetailDrawer` | `AdDrawer` + `Body` + `Row` | จัดเป็น section (V4) |
| `MediaPlaceholder` | `<p>` / `<span>` ใน `Media()` | สกัดตาม §10 |
| `EmptyState` / `ErrorState` / `LoadingSkeleton` | inline | ใหม่ |
| `ImportStepper` | `Phase` union มีอยู่แล้ว | ใหม่ (view เหนือ state เดิม) (V2) |
| `KPIStat` | — | ใหม่ (V2) |
| `EvidenceCard` `FactBlock` `AIInterpretationBlock` `CoverageWarning` `Tabs` | — | **Phase 2 · ไม่สร้าง** |

---

## 2. Slices

### V1 — Global Shell
tokens (A1) · typography · `app/(app)/` + shell layout · `AppSidebar` · `ContextBar` ·
`PageHeader` · badges/states primitives · login + home restyle
**ไม่ต้องใช้ 0020**

### V2 — Import + Dataset
stepper · QualityStrip รวมร่าง · KPIStat · amber partial banner · dataset list columns
**ต้องมี 0020 (B2)**

### V3 — Ads Explorer
sticky FilterToolbar · filter count · reset · Grid⇄Table · grid 4/3/2/1 · AdCard
**ต้องมี 0020 (B1 media, B3 sort)**

### V4 — Ad Detail Drawer
600px · 6 section · sticky header · media fallback · history · snapshot/latest label

### V5 — Final consistency
loading / empty / error / responsive / focus / Thai overflow · full gate

---

## 3. Protected invariants ต่อ slice

| Invariant | V1 | V2 | V3 | V4 | V5 |
| --- | :--: | :--: | :--: | :--: | :--: |
| I1 snapshot pinning | | ● | ● | ● | ● |
| I4 membership 404 · ไม่ fallback | | | ● | ● | ● |
| Unknown ≠ Inactive | | | ● | ● | ● |
| Multi-value เกิน 100% ได้ | | | ● | | ● |
| coverage ต้องมี `present/total` | | ● | | | ● |
| preview ไม่เขียนอะไร | | ● | | | ● |
| filter/search/paging ฝั่ง server | | | ● | | ● |
| auth ฝั่ง server · viewer 403 | ● | ● | | | ● |
| ไม่มี forbidden metric | ● | ● | ● | ● | ● |
| Page ≠ Brand | | | ● | ● | ● |
| XSS / URL scheme filtering | | | ● | ● | ● |
| ไม่มี secret ใน client bundle | ● | | | | ● |

---

## 4. Tests ต่อ slice

ทุก slice ต้องผ่าน: `lint` · `typecheck` · `check:imports` · `npm test` · `npx playwright test` · `build`

| Slice | test ที่เป็นด่านหลัก |
| --- | --- |
| V1 | `global.setup.ts` (login ผ่าน UI จริง) · viewer 403 · `tests/security.test.ts` (bundle scan ต้องเห็น `components/` ด้วย) |
| V2 | journey: full / partial / invalid file · hardening: commit 400/403 · `read-snapshot` context · `import-guard` · golden coverage digest |
| V3 | journey: unknown filter / media failure / snapshot · hardening: paging clamp / bad filter 400 / long search / SQL-shaped input · `read-snapshot` filter tests |
| V4 | journey: snapshot proof · cross-dataset 404 · unknown = `—` · media abort · **hardening XSS `__pwned`** · `read-snapshot` drawer |
| V5 | ทั้งหมด + keyboard/focus + Thai overflow 375px |

## 5. Screenshots

Playwright project แยกชื่อ `visual` · `page.screenshot()` ธรรมดา **ไม่ใช่** `toHaveScreenshot()`
(pixel baseline บน Windows จะ flaky และเปลี่ยน cosmetic drift ให้กลายเป็น CI แดงโดยไม่ได้ป้องกันอะไร)

เก็บที่ **`test-artifacts/visual/<slice>/<route>-<viewport>.png`** · gitignored · รายงาน path ทุก slice

viewport: 1440 · 1280 · 768 · 375

| Slice | ภาพที่ต้องเก็บ |
| --- | --- |
| V1 | `/login` `/` `/datasets/[id]` × 4 viewport · sidebar กาง/หุบ |
| V2 | `/import` ทั้ง 5 phase รวม partial + rejected · `/datasets` · dataset detail completed + partial |
| V3 | grid × 4 viewport · table mode · toolbar ตอน scroll · empty state |
| V4 | drawer dataset mode · master mode · media unavailable · ad ที่ unknown ทุกช่อง · mobile sheet |
| V5 | ทุก route × 4 viewport + loading/empty/error/partial/media-unavailable |
