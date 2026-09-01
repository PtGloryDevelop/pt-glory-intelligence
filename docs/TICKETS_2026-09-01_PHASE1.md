# Ticket Plan — Phase 1

วันที่: 1 กันยายน 2569 · จาก `SPEC_2026-09-01_PHASE1.md` + `ARCHITECTURE_REVIEW_2026-09-01_PHASE1.md`

**สถานะ: รออนุมัติ ยังไม่ implement**

20 tickets · milestone ที่ระบบรันได้: หลัง T09, T13, T16

---

## P0 — Foundation

### T01 · Project scaffold + git init
**Goal** repo รันได้ พร้อม lint/typecheck/build/test harness
**Scope** git init · Next.js App Router + TypeScript · ESLint · `.env.example` · `npm test` (node:test) · Playwright ติดตั้งแต่ยังไม่มี spec
**Files** root config, `app/layout.tsx`, `app/page.tsx` (placeholder)
**Acceptance** `npm run lint && npm run typecheck && npm run build && npm test` ผ่านทั้งหมด · `.env` อยู่ใน `.gitignore`
**Tests** smoke: build สำเร็จ
**Deps** —
**Out** UI จริง, Supabase

### T02 · Supabase baseline + auth + dual client
**Goal** ล็อกอินได้ รู้ role และแยก credential สองสายตั้งแต่ต้น
**Scope** Supabase Auth · **`dbUser()`** (anon key + user JWT → RLS ทำงาน) และ **`dbPrivileged()`** (`DATABASE_URL` direct pg → bypass RLS) แยกไฟล์คนละที่ · helper `requireRole()` ฝั่ง server
**Files** `lib/db/user.ts`, `lib/db/privileged.ts`, `lib/auth/*`, `app/(auth)/login`
**Data contract** `user_roles` ถูกสร้างใน T03 · T02 อ่านอย่างเดียว
**Acceptance** ล็อกอิน/ออกได้ · `requireRole` โยน 403 ที่ server · **มี lint rule/test ห้าม `dbPrivileged` ถูก import ในไฟล์ของเส้นทางอ่าน**
**Tests** unit: `requireRole` ทุก role · integration: route ด้วย role ต่างกัน · static: grep import graph
**Deps** T01
**Out** RLS policies (T04), UI จัดการผู้ใช้

### T03 · Migrations 0001–0015 (schema + indexes)
**Goal** schema **13 ตาราง** + indexes ขึ้น/ลงได้
**Scope** `user_roles` + 12 domain tables ตามสเปก · ทุกไฟล์มี `.down.sql` · seed `app_settings.evergreen_threshold_days = 90`
**Data contract**
- `ads.ad_archive_id NOT NULL UNIQUE` · `ads.is_active` **nullable**
- `publisher_platform`/`page_categories` เป็น `text[]` ไม่ใช่ enum
- `collection_method` CHECK 3 ค่า
- `import_quarantine.reason` CHECK **2 ค่า** (`missing_ad_archive_id`, `unresolved_source_record`)
- `collection_runs` มีทั้ง `reported_*` และ `computed_*`
- **`unique (ad_observations(collection_run_id, ad_ref))`** และ **`unique (page_observations(collection_run_id, page_ref))`**
**Acceptance** migrate up/down สะอาด · CHECK ปฏิเสธค่านอกรายการทั้ง 2 จุด · unique constraint ปฏิเสธ observation ซ้ำใน run เดียว
**Tests** integration: CRUD ทุกตาราง · migrate down/up ซ้ำได้ · constraint violation ทุกตัว
**Deps** T02
**Out** RLS

### T04 · RLS policies (0016)
**Goal** authorization บังคับที่ฐานข้อมูลสำหรับเส้นทางอ่าน
**Scope** เปิด RLS ทุกตาราง · policy อ่าน role จาก `public.user_roles` · `deleted_at is null` filter
**Acceptance** viewer insert/update ไม่ได้ทุกตาราง · analyst แตะ `audit_logs`/`app_settings`/`user_roles` ไม่ได้ · admin ได้ทั้งหมด · **ยืนยันว่า `dbPrivileged` bypass RLS ได้จริง** (เพื่อพิสูจน์ว่าจำเป็นต้องมี `requireRole` ฝั่ง Node)
**Tests** integration ต่อ role × ต่อตาราง (matrix) · test ที่แสดงว่า privileged connection ข้าม policy ได้
**Deps** T03
**Out** —

---

## P1 — Collector contract

### T05 · Canonical domain types
**Goal** type กลางที่ UI และ DB ใช้ร่วมกัน แยกจากรูปร่าง collector
**Scope** `CanonicalAd` `CanonicalPage` `CanonicalRun` `AdObservation` · **ห้ามมีฟิลด์** `likes/spend/reach/impressions` หรือชื่อใดในรายการต้องห้าม
**Acceptance** typecheck ผ่าน · มี test ยืนยันว่า type ไม่มีคีย์ต้องห้าม
**Tests** unit: type-level assertion
**Deps** T01
**Out** normalizer

### T06 · File-level validator + reject rules
**Goal** ไฟล์ที่โครงผิดถูกปฏิเสธพร้อมเหตุผล **โดยไม่แตะ DB เลย**
**Scope** zod schema · reason enum ระดับไฟล์ **6 ค่า**: `malformed_json` `schema_mismatch` `unknown_field` `unsupported_collection_method` `size_limit_exceeded` `count_mismatch` · guard 5,000 records / 25 MB
**Data contract** file-level error → คืน 422 `{reason, detail}` · **ห้ามสร้าง `collection_run` และห้ามเขียน `import_quarantine`**
**Acceptance** ไฟล์จริง 500 ads ผ่าน · `collection_method` มั่ว → `unsupported_collection_method` · คีย์ `foo` ในแถวเดียว → `unknown_field` + บอกชื่อคีย์ · 6,000 rows → `size_limit_exceeded` · JSON พัง → `malformed_json` · **ทุกเคส row count ใน DB ไม่เปลี่ยน**
**Tests** unit 6 เคส + integration ยืนยันว่าไม่มีแถวใหม่ในทุกตาราง
**Deps** T05
**Out** normalize, count recomputation (T06b)

### T06b · Server count recomputation + mismatch policy
**Goal** ไม่เชื่อตัวเลขที่ collector รายงาน (I3)
**Scope** คำนวณ `computed_source_rows` `computed_unique_ads` `computed_unique_pages` `computed_unresolved_count` จากข้อมูลที่ parse ได้จริง · เทียบกับ `reported_*` · ไม่ตรง → reject reason `count_mismatch`
**Formula** ตามสเปกหัวข้อ Deterministic Formulas
**Acceptance** ไฟล์จริง → computed ตรง reported ทั้ง 4 ค่า (500/500/309/0) · แก้ `unique_ads` เป็น 499 → **reject พร้อมข้อความ `reported 499 / computed 500`**
**Tests** unit ทั้ง 4 ฟิลด์ · fixture ที่จงใจให้เลขเพี้ยน
**Deps** T06
**Out** DB write

### T07 · Normalizer + forbidden-key stripper
**Goal** แปลง collector row → canonical และตัดฟิลด์ต้องห้ามทิ้งตั้งแต่ชั้นแรก
**Scope** map ตาม Source Field Map · ทิ้ง `meta_page_id` `page_aliases` `end_date_raw` `raw_evidence` · **ทิ้ง `likes/spend/reach/impressions` ถ้าโผล่มา** · แยก provenance (`record_key`, `start_date_raw`, `network_end_date_raw`, `_pt_glory`) ไปชั้น observation
**Acceptance** ไฟล์จริง → 500 canonical ads · ยัด `spend: 999` เข้าไปในแถวหนึ่ง → **ค่านั้นไม่ปรากฏใน output** (และ T06 reject ก่อนอยู่แล้ว — ต้องผ่านทั้งสองชั้น)
**Tests** unit: forbidden-key stripper · golden fixture 500 ads เทียบ output ทั้งก้อน
**Deps** T06
**Out** DB write

### T08 · Coverage / data-quality calculator
**Goal** วัด coverage ต่อฟิลด์อย่างถูกต้อง
**Scope** ฟังก์ชัน `isPresent()` **ตัวเดียวใช้ร่วมกันทุกที่** (Risk R4): null · `''` · `[]` · object ที่ทุกคีย์ null · `is_active = null` → ทั้งหมดนับเป็นไม่ครอบคลุม · จัด tier 80/50
**Formula** `coverage = present_count / total_count`
**Acceptance** ไฟล์จริงให้ค่าตรงกับที่วัดไว้: `title` 36% · `link_url` 9% · `cards` 3% · `page_like_count` 100% · `is_active` 100%
**Tests** unit: null-object เคส (`{a:null,b:null}` → ไม่ครอบคลุม) · array ว่าง · fixture 500 ads เทียบเลขจริง
**Deps** T07
**Out** UI

---

## P1 — Import pipeline

### T09 · Import commit — real transaction ⭐ milestone
**Goal** บันทึกไฟล์ลง DB ครบถ้วนใน transaction จริงหนึ่งก้อน
**Scope** `requireRole('analyst')` → เปิด connection ผ่าน `dbPrivileged()` → `BEGIN` → insert `collection_runs` (`collected_at = export.generated_at`, `reported_*` + `computed_*`) · upsert `pages` · append `page_observations` · upsert `ads` · append `ad_observations` · insert `dataset_ads` · insert `dataset_quality` · `audit_logs` → `COMMIT`

**Transaction mechanism (ต้องระบุก่อนเขียนโค้ด)**
ใช้ driver `pg` ต่อ Supabase transaction-mode pooler ด้วย `DATABASE_URL` (server-only)
`BEGIN` / `COMMIT` / `ROLLBACK` ในคอนเนกชันเดียว
**ห้าม** ใช้ supabase-js หลายคำสั่งต่อกันแล้วเรียกว่า transaction

**Data contract** upsert ของ `ads` ตาม R2/I2 — `LEAST`/`GREATEST` สำหรับ first/last seen **บวก `case when excluded.last_seen_at >= ads.last_seen_at`** สำหรับ `is_active` `display_format` `publisher_platform` `page_ref` `collation_id` · กติกาเดียวกันกับ `pages`
**Acceptance**
- import ไฟล์จริง → ads 500 · pages 309 · observations 500/309 · quarantine 0
- **โยน error ที่ step กลาง (เช่นหลัง upsert ads) → row count ทุกตารางเท่ากับก่อนเริ่มทุกตาราง**
- viewer เรียก endpoint → 403 **ก่อนเปิด connection** (พิสูจน์ด้วย connection counter หรือ spy)
**Tests** integration: commit สำเร็จ · rollback จริงเมื่อ error กลาง step · authz ก่อน transaction
**Deps** T04, T08, T06b
**Out** preview endpoint, UI

### T10 · Re-import idempotency + observation history
**Goal** นำเข้าซ้ำไม่สร้าง master ซ้ำ แต่เก็บประวัติเพิ่ม
**Scope** ทดสอบและปิดช่องว่างของ T09
**Acceptance** import ไฟล์เดิม 2 ครั้ง → `ads` = 500 เท่าเดิม · `ad_observations` = 1,000 · `collection_runs` = 2 · `page_observations` = 618
**Tests** integration: 2 รอบ · `page_name` เปลี่ยน → observation ใหม่ ชื่อเดิมไม่หาย · `collation_count` เปลี่ยน → observation ใหม่
**Deps** T09

### T11 · Historical import — first/last seen + monotonic current state
**Goal** import ข้อมูลเก่ากว่าทีหลังแล้วทั้งประวัติและสถานะปัจจุบันยังถูก
**Scope** ยืนยันสูตร `MIN`/`MAX` (คำตัดสิน D) **และ monotonic guard (I2)**
**Acceptance**
- import ไฟล์ `generated_at = 28 ส.ค.` แล้วตามด้วยไฟล์ `generated_at = 10 ส.ค.` ที่มี ad เดียวกัน → **`first_seen_at` ขยับเป็น 10 ส.ค.** · `last_seen_at` ยังเป็น 28 ส.ค.
- ไฟล์ 10 ส.ค. มี `is_active = false` แต่ 28 ส.ค. เป็น `true` → **`ads.is_active` ยังเป็น `true`** · `ad_observations` ได้แถวของ 10 ส.ค. ที่ `is_active = false`
- เช็คเดียวกันกับ `display_format` `publisher_platform` `page_ref` `collation_id`
- สลับลำดับ import (ใหม่ก่อน/เก่าก่อน) แล้วผลลัพธ์สุดท้ายเหมือนกัน
**Tests** integration ทั้ง 4 ข้อ (fixture สังเคราะห์ 2 ไฟล์ที่ค่าต่างกันจงใจ)
**Deps** T10

### T12 · Row-level quarantine
**Goal** แถวที่มีปัญหาไม่เข้า master แต่ถูกบันทึกไว้ — และแยกจาก file-level reject ให้ชัด
**Scope** `unresolved_ads[]` → `import_quarantine` reason `unresolved_source_record` · แถวใน `ads[]` ที่ `ad_archive_id` null → reason `missing_ad_archive_id` · ทั้งคู่ **ไม่เข้า `ads`** (คำตัดสิน B) · run เป็นสถานะ `partial`
**Data contract** `import_quarantine.reason` มีได้แค่ 2 ค่านี้ · file-level reason **ห้ามปรากฏในตารางนี้**
**Acceptance** fixture unresolved 5 รายการ → `ads` ไม่เพิ่ม 5 · `import_quarantine` 5 แถว reason ถูกต้อง · `run.status = 'partial'` · ตัวเลขโผล่ใน dataset
**Tests** integration · test ยืนยันว่าไฟล์ที่ reject ระดับไฟล์ (T06) ไม่เคยสร้างแถวใน `import_quarantine`
**Deps** T09

### T13 · Preview endpoint + Import UI ⭐ milestone
**Goal** ผู้ใช้เห็นผลก่อนบันทึก
**Scope** `POST /api/imports/preview` (ไม่เขียน DB) · `POST /api/imports/commit` · หน้าอัปโหลด → preview → ยืนยัน · states: validating/preview/committing/success/rejected/partial/failed
**API** ตามสเปกหัวข้อ API Contracts
**Acceptance** preview ไม่เปลี่ยน row count ใดๆ (นับก่อน/หลัง) · เลขใน preview ตรงกับ `quality_summary` ในไฟล์ · ไฟล์ผิดโครงแสดงเหตุผลชัด · viewer เรียก commit → **403 จาก server**
**Tests** integration: preview ไม่เขียน DB · authz ต่อ role · E2E: อัปโหลด→preview→ยืนยัน
**Deps** T12, T02

---

## P1 — Read surfaces

### T14 · Dataset page + quality strip + provenance block
**Goal** เปิด dataset แล้วเห็นบริบท คุณภาพจริง และแยกตัวเลขของเราออกจากของ collector
**Scope** `GET /api/datasets/:id` · แสดง scope · `collected_at` · `collection_method` · `completeness_claim` · quality strip จาก `dataset_quality` (server calculator)
**Data contract** ตัวเลขหลักบนหน้า = `computed_*` และ `dataset_quality` · `reported_*` และ `reported_quality_summary` แสดงได้เฉพาะในบล็อก **"ข้อมูลที่ collector รายงาน"** ที่ระบุที่มาชัดเจน
**Acceptance** ฟิลด์ tier `low` แสดง warning · แสดง unresolved count · **ไม่มี Sum ของ page_like_count ที่ไหนเลย** · **`reported_quality_summary` ไม่ถูกใช้เป็นตัวเลขของระบบ** (test ตรวจ DTO)
**Tests** integration + E2E · unit: tier mapping
**Deps** T13

### T15 · Ads Explorer + filters (snapshot-scoped)
**Goal** กรองและค้นหาโฆษณาในชุดข้อมูล โดยค่าที่เห็นเป็นของรอบนั้นจริง
**Scope** `GET /api/datasets/:id/ads` · **join `ad_observations` ที่ `collection_run_id = dataset.collection_run_id`** (I1) · กรอง active(รวม unknown) / display_format / cta_type / publisher_platform / page_category · ค้นหา `body_text` (pg_trgm) · paging
**Data contract** response มี `total`, denominators และ `snapshot:{collection_run_id, collected_at}` · multi-value filter = "มีค่านี้อยู่ใน array" · **ห้ามใช้ latest observation แบบ global**
**Acceptance**
- **dataset A (run เก่า) และ B (run ใหม่) ที่มี ad เดียวกันแต่ `is_active` ต่างกัน → Explorer ของแต่ละอันแสดงค่าของ run ตัวเอง**
- import รอบใหม่แล้ว **ตัวเลขของ dataset เก่าไม่เปลี่ยน**
- `is_active = null` แสดง `—` และกรองด้วยตัวเลือก "ไม่ทราบ" ได้
- platform/category มีหมายเหตุว่ารวมเกิน 100% ได้ · empty state มีปุ่มล้างตัวกรอง
**Tests** integration ต่อ filter · **integration I1 สองรอบ** · unit: query builder · E2E
**Deps** T14

### T16 · Ad Detail Drawer (snapshot-aware) ⭐ milestone
**Goal** เจาะดูโฆษณาหนึ่งตัวโดยไม่ออกจากหน้า และไม่หลุด snapshot context
**Scope** `GET /api/ads/:adArchiveId?datasetId=` · drawer ขวา · media, metadata, copy, `ad_age_days`, first/last seen, ประวัติ observation
**Data contract** มี `datasetId` → mutable fields จาก observation ของ run นั้น + ป้าย snapshot · ไม่มี `datasetId` → master current state + **ป้าย "สถานะล่าสุดจากทุกรอบ"**
**Acceptance** เปิดจาก Explorer ของ dataset → **ค่าตรงกับแถวใน Explorer เป๊ะ** ไม่ใช่ค่าล่าสุด · เปิด/ปิดโดย URL หลักไม่เปลี่ยน · ฟิลด์ว่างแสดง `—` ไม่ซ่อนเงียบ · media โหลดไม่ได้ → placeholder ไม่พังทั้งหน้า · ประวัติเรียงใหม่→เก่าและครอบทุก run
**Tests** integration ทั้งสองโหมด · E2E: คลิกแถว→drawer→ค่าตรงกัน→ปิด · unit: ad_age
**Deps** T15

---

## P1 — Hardening

### T17 · Golden fixture + regression suite
**Goal** normalizer เปลี่ยนพฤติกรรมเมื่อไร รู้ทันที
**Scope** pin ไฟล์ 500 ads เป็น fixture + expected output ทั้งก้อน · fixture สังเคราะห์: unresolved, unknown key, `is_active` null, `collection_method` ผิด, JSON พัง, 6,000 rows
**Acceptance** แก้ normalizer แล้ว snapshot พังทันที · suite รันใน CI
**Tests** ตัวมันเอง
**Deps** T07, T08

### T18 · Security review + E2E journey
**Goal** พิสูจน์ว่า journey ทำงานจริงและไม่รั่ว
**Scope** Playwright journey เต็ม (login → category → import → preview → commit → dataset → explorer → filter → drawer) · ตรวจ client bundle ไม่มี `DATABASE_URL` และ service-role key · XSS ตอน render `body_text` · ไฟล์อัปโหลดถือเป็น untrusted · ตรวจว่า `dbPrivileged` ไม่ถูกใช้ในเส้นทางอ่าน
**Acceptance** E2E เขียว · `grep` bundle ไม่พบ credential ทั้งสองตัว · `body_text` ที่มี `<script>` ถูก escape · import graph ยืนยันว่าไม่มี read route แตะ `dbPrivileged`
**Tests** E2E + security test + static import-graph test
**Deps** T16, T17

---

## ลำดับและ milestone

```
T01 → T02 → T03 → T04
  → T05 → T06 → T06b → T07 → T08
  → T09 ⭐ (transaction จริง เขียน DB ได้)
  → T10 → T11 → T12
  → T13 ⭐ (import ผ่าน UI ได้ครบวง)
  → T14 → T15 → T16 ⭐ (journey ครบ snapshot-consistent)
  → T17 → T18 (พร้อมปิด Phase 1)
```

**Definition of Done ของ Phase 1** = T18 ผ่าน และ acceptance criteria ทั้ง **17 ข้อ** ในสเปกเป็นจริง

---

## หมายเหตุก่อนเริ่ม

- **T09 เสี่ยงที่สุด** — transaction mechanism ต้องเป็นของจริง และ upsert ต้องมี monotonic guard · T11 คือด่านที่จับได้ถ้าพลาด
- **T06 / T06b / T07 กัน forbidden field และตัวเลขปลอมคนละชั้น** ไม่ใช่ชั้นเดียว
- **T15/T16 คือจุดที่ I1 พังง่ายที่สุด** — เขียน query ผิดนิดเดียวก็กลายเป็น global latest โดยไม่มีอะไรเตือน ต้องมี integration test สองรอบเสมอ
- ยังไม่มี source ของ collector ตัวใหม่ → T17 คือประกันหลักของ Risk R3
