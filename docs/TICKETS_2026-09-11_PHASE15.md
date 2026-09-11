# Ticket Plan — Phase 15: Collection UX, Apify first

วันที่: 11 กันยายน 2569 · จาก `SPEC_2026-09-11_PHASE15-COLLECTION-UX.md` (`7921cb5`) +
`ARCHITECTURE_REVIEW_2026-09-11_PHASE15.md` (`941078c` — **ตัวนี้ชนะเมื่อขัดกับ spec**)

**สถานะ: APPROVED / FROZEN (11 ก.ย. 2569) — implementation เริ่มที่ C01-A**

17 tickets (C01 แยกเป็น C01-A / C01-B) · milestone ที่ระบบรันได้: หลัง C03, C05, C12, C15

กติกาทุก ticket: commit ต่อ ticket · test ไม่ติดต่อ Apify ไม่ว่ากรณีใด (ใช้ mock หรือ fake fetch) ·
ไม่มีราคาใดถูก hard-code · migration ใช้เลขถัดไป ณ วันที่ลงมือ · **`collector.enabled` เป็น `false`
จนกว่า C16 จะผ่าน — C16 เป็นประตูเปิดใช้งานจริงเพียงประตูเดียว** · token ของ Apify เจ้าของใส่ใน
`.env.local` เอง ไม่มีการขอ token ทางแชทไม่ว่ากรณีใด

---

## P0 — Evidence

### C01-A · Provider evidence — ไม่มีค่าใช้จ่าย / อ่านอย่างเดียว
**Goal** ตอบทุกข้อที่ตอบได้โดยไม่เสียเงิน และเตรียมแผน run ที่ต้องจ่ายให้เจ้าของอนุมัติ
**Scope**
- (a) อ่าน run ตัวอย่างเดิมผ่าน API (อ่านอย่างเดียว ไม่มีค่าใช้จ่าย): สถานะ · `usageTotalUsd` (ต้นทุนจริงของ run ตัวอย่าง) · `chargedEventCounts` · `pricingInfo` · รูปแบบ record `INPUT` (รูปทรงของ `urls`) · จำนวน item จาก `X-Apify-Pagination-Total`
- (b) `Authorization: Bearer` ใช้ได้กับ run, dataset items และ `INPUT` โดยไม่ต้องใส่ token ใน query
- (c) ความหมายของ `total` / `ads_count` / `position` จากไฟล์ตัวอย่าง (หลักฐานสำหรับ `source_exhausted`)
- (d) วัด import บน local stack: เวลา `analyzeImport` + `commitImport` และจำนวน SQL round trip ที่ 100 / 500 / 1,000 ads · byte ต่อ 100 ads ของ output ที่ผ่าน allowlist · ประเมินเวลาบน production จาก region ของ function และ latency ไปฐานข้อมูล → เสนอเพดาน `max_records_per_run`
- (e) แผน run สำหรับ C01-B: input ที่แน่นอน · เพดาน `maxTotalChargeUsd` · สิ่งที่จะสังเกต
**Files** `docs/SPIKE_2026-09-11_PROVIDER_EVIDENCE.md` + script ชั่วคราวใน scratchpad เท่านั้น
**Acceptance** (a)–(e) มีตัวเลขหรือคำตอบพร้อมหลักฐาน · token ไม่ปรากฏในเอกสาร log หรือแชท · ไม่มี run ใหม่เกิดขึ้น
**Tests** — (เป็นงานเก็บหลักฐาน)
**Deps** token ใน `.env.local` (เฉพาะข้อ a, b) · local stack (ข้อ d)
**Out** run ที่เสียเงิน · โค้ดระบบ

### C01-B · Paid qualification run — ต้องได้รับอนุมัติทันทีก่อนรัน
**Goal** ยืนยันสิ่งที่ต้องมี run จริงเท่านั้นถึงจะรู้
**Scope** run เล็กหนึ่งครั้งตามแผนใน C01-A(e) ตั้ง `runTag` และ `maxTotalChargeUsd` ต่ำ: `runTag` อ่านกลับจาก `INPUT` ได้หรือไม่ · actor หยุดที่ ceiling และสถานะปลายทางคืออะไร · `usageTotalUsd` ตอนจบเทียบกับหลังจบ N นาที (ใช้กำหนด cost settlement) · `X-Apify-Pagination-Total` ระหว่างรัน
**Files** ต่อท้าย `docs/SPIKE_2026-09-11_PROVIDER_EVIDENCE.md`
**Acceptance** ทุกข้อมีหลักฐาน · ค่าใช้จ่ายไม่เกินเพดานที่อนุมัติ
**Deps** C01-A · **เจ้าของอนุมัติแยกทันทีก่อนกดรัน**
**Out** โค้ดระบบ

---

## P1 — Foundation (collector ยังปิดอยู่)

### C02 · Apify Adapter + fixture ที่ตัดลายเซ็นแล้ว
**Goal** Apify items → PT Glory export ที่ผ่าน `validate()` เดิมโดยไม่แก้ validator
**Scope** `lib/collect/adapter.ts` (pure, ไม่มี I/O) · `lib/collect/url.ts` · fixture จากไฟล์ spike: **ตัด query string ลายเซ็นของ fbcdn ทุกตัว** แต่คงคีย์ต้องห้ามไว้ เพื่อทดสอบว่าถูกตัดทิ้งจริง
**Data contract** spec §6 + review:
- allowlist `AD_KEYS` ก่อน validate · คีย์ต้องห้ามไม่หลุดออกไปทั้งชื่อและค่า
- epoch วินาที → ISO · `end_date`: active → null · inactive + epoch ถูกต้อง → ISO · นอกนั้น null · **ไม่ใช้เวลาเก็บแทนเด็ดขาด** · `network_end_date_raw` = ISO ของค่าต้นทาง
- dedupe ด้วย `ad_archive_id` · แถวที่ไม่มี id / `page_id` / `start_date` → `unresolved_ads`
- media sub-key allowlist · `quality_summary` มี `collection_request_id` แต่ไม่มีข้อมูล provider
- `stop_reason`: `limit_reached` · `source_exhausted` **เฉพาะเมื่อครบทั้ง 5 เงื่อนไข** (run จบแบบสำเร็จ · ไม่ถูก cap จำนวนหยุด · ไม่ถูก ceiling ค่าใช้จ่ายหยุด · ไม่ถูก guard อื่นของระบบหยุด · หลักฐาน pagination/source บอกว่าไม่มีผลเพิ่ม) · `total` ใช้ตรวจความสอดคล้องเท่านั้น · ห้ามใช้ `ads_count` / `position` · นอกนั้น null
- ตรวจขนาด export ระหว่างสร้าง: ถ้า item ถัดไปจะทำให้เกิน `collector.max_export_bytes` (≤ `MAX_BYTES` 25 MB ซึ่งยังเป็นค่าที่ชี้ขาด) → หยุดก่อนสร้างไฟล์ที่เกิน และคืน `export_too_large`
**Acceptance** output ผ่าน `validate()` · ค่า start_date ตรงกับ Pilot ทุกแถวที่ซ้อนกัน (ยืนยันผล spike ซ้ำ) · fixture ไม่มี `oh=` / `oe=` หลงเหลือ
**Tests** unit ครบทุกกฎข้างบน · test สแกน fixture หาลายเซ็น
**Deps** — (กิ่ง `source_exhausted` ปิดหลัง C01-A)
**Out** HTTP ไปหา provider, DB

### C03 · Server-side provenance labels ⭐ milestone (ใช้ได้ทันทีกับข้อมูลเดิม)
**Goal** ผู้ใช้ที่ไม่ใช่ admin ไม่เห็นตัวตน provider ตั้งแต่วันนี้ รวมข้อมูลจาก Extension ที่มีอยู่แล้ว
**Scope** `lib/collect/labels.ts` · ใช้ใน read layer (`lib/read/queries.ts` และหน้าที่แสดง `วิธีเก็บ` / `source_product`) และ `/api/ads/[adArchiveId]` (ประวัติ observation ใน drawer) · admin เห็นค่าจริง
**Data contract** `apify_actor_run` → `เก็บข้อมูลอัตโนมัติ` · `network_response_observation` / `user_initiated_dom_observation` → `นำเข้าจากไฟล์` · source product → `PT Glory`
**Acceptance** HTML และ JSON ที่ viewer และ analyst ได้รับไม่มีสตริง method หรือ product ดิบ · admin ยังเห็นค่าจริง
**Tests** unit mapping · e2e: สแกน response ของ viewer และ analyst หาสตริงดิบ · ปรับ test เดิมที่เช็กค่าดิบ
**Deps** —
**Out** ข้อมูลใหม่จาก Apify (ยังไม่มี)

### C04 · Migration: collection_requests + invariants + settings
**Goal** ตารางและกฎทั้งหมดที่ state machine พึ่งพา บังคับที่ระดับ schema
**Scope**
- method CHECK เพิ่ม `apify_actor_run` + `lib/domain/types.ts`
- `collection_requests`: กลุ่มคอลัมน์ user-safe / admin / recovery · status (`queued, starting, provider_start_uncertain, running, importing, succeeded, failed`) · `requires_admin` · cost lifecycle (`cost_status`, `cost_reserved_usd`, `cost_provisional_usd`, `cost_final_usd`, `cost_first_read_at`, `cost_finalized_at`, `ceiling_reached`)
- invariants: `unique (requested_by, request_key)` · `unique (provider_run_id)` · `unique (collection_run_id)` · check ต่าง ๆ ตาม spec §9
- partial unique index บน `collection_runs ((reported_quality_summary ->> 'collection_request_id'))`
- view `collection_request_status` (`security_invoker`) · RLS select-own · column grants เฉพาะกลุ่ม user-safe
- `app_settings` `collector.*` (null/TBD · `max_export_bytes` ≤ `MAX_BYTES` · `max_concurrent = 1` · `lease_seconds = 120` · `actor` · `countries = ["TH"]` · `enabled = false`)
- down: drop ทั้งหมด **แต่ปฏิเสธถ้ามี run ที่ใช้ `apify_actor_run` แล้ว**
**Compat (ใน ticket นี้)** `tests/migrations.test.ts` (เลขลำดับ · **ตาราง 17 → 18**) · `tests/db/table-grants.test.ts` (**กฎระดับคอลัมน์สำหรับ `collection_requests`** ไม่ใช่การยกเว้น)
**Acceptance** migrate up/down/up สะอาดบน local · ทุก invariant ปฏิเสธการละเมิด · index บล็อก commit ครั้งที่สองของ request เดียวกัน
**Tests** DB: invariant ทุกตัว · RLS/grants/view (เจ้าของเห็นเฉพาะคอลัมน์ user-safe ของตัวเอง · คนอื่น viewer และ anon ไม่เห็นเลย · คอลัมน์ admin/recovery select ไม่ได้) · ใส่ `collection_runs` สองแถวที่ request id ซ้ำ → unique violation · down ปฏิเสธเมื่อมี run จาก apify
**Deps** —
**Out** โค้ดแอป, cron function (C12)

### C05 · Budget: billing window + window spend + run ceiling (pure) ⭐ milestone
**Goal** คณิตของงบทั้งหมดอยู่ที่เดียว ทดสอบได้โดยไม่ต้องมี DB
**Scope** `lib/collect/budget.ts`
**Formulas** window = `[anchor + k·L, anchor + (k+1)·L)` (clamp ปลายเดือน) · window spend = Σ final + Σ ยอดที่ถือโดย `provisional` (`max(provisional, reserved)`), `reserved`, `unreported` (= reserved) · `run_ceiling = min(max_charge_per_run_usd, budget − window spend)` · cost per 1,000 ads คำนวณจาก final เท่านั้น
**Acceptance** ceiling ≤ 0 → ปฏิเสธ · ไม่มีตัวเลขราคาใดในโค้ด
**Tests** unit: anchor วันที่ 31 · ปีอธิกสุรทิน · run ที่คร่อมขอบ window · ลำดับ reserved → provisional → final · unreported
**Deps** —
**Out** การอ่าน settings จาก DB (C07)

> **Milestone หลัง C05:** schema, adapter และคณิตงบพร้อม · collector ยังปิด · ระบบเดิมทำงานเหมือนเดิม

---

## P1 — Provider และ state machine

### C06 · Provider interface + Apify client + mock
**Goal** ติดต่อ Apify ผ่าน interface เดียว แยกผลเป็น สำเร็จ / ปฏิเสธชัดเจน / ไม่แน่นอน
**Scope** `lib/collect/provider.ts` · `apify.ts` (`fetch` · `Authorization` header · start พร้อม `build`, `timeout`, `maxTotalChargeUsd`, `restartOnError=false`, `runTag` · status · item total · fetch items แบบแบ่งหน้า · `findRunsSince` · `readRunInput` · scrub ข้อความ error) · `mock.ts` (กำหนดผลได้ รวม response หาย · ปฏิเสธถ้า `PT_GLORY_ENV` ไม่ใช่ dev/test)
**Acceptance** 2xx → สำเร็จ · 4xx ก่อนมี run → ปฏิเสธชัดเจน · timeout / 5xx / network / response พัง → **ไม่แน่นอน** · token ไม่อยู่ใน URL และข้อความ error
**Tests** unit ด้วย fake fetch ครบ matrix · scrubbing · mock ปฏิเสธนอก test · **watcher เพิ่ม `api.apify.com` เป็นปลายทางต้องห้าม** · bundle scan เพิ่ม `APIFY_TOKEN`
**Deps** C01-A (รูปแบบ API) · C01-B (พฤติกรรม ceiling)
**Out** การเรียกจริงใน test

### C07 · Admission (เริ่มเก็บ) ภายใต้ advisory lock
**Goal** เงื่อนไขทุกข้อก่อนเริ่มถูกตรวจแบบ atomic ฝั่ง server
**Scope** `lib/collect/admission.ts`: ตรวจ input (คำค้น · ประเทศใน allowlist · สถานะ · `maxRecords` ≤ cap และ ≤ 4,970 · หมวดหมู่มีอยู่จริง · ชื่อ dataset) · settings บังคับไม่เป็น null (budget · `max_charge_per_run_usd` · cap · anchor · length · `actor_build` · `enabled`) · จำนวนที่ยังไม่จบ รวม `provider_start_uncertain` < `max_concurrent` · ceiling > 0 → insert `queued` + `cost_reserved_usd = ceiling` · `request_key` ซ้ำคืน request เดิม · audit `collection.start`
**Acceptance** สอง request พร้อมกันเมื่อ `max_concurrent = 1` → ได้หนึ่ง · `requestKey` เดิมสองครั้ง → หนึ่ง
**Tests** DB/integration: เหตุผลการปฏิเสธทุกข้อ (`not_configured`, `budget_reached`, `busy`) · race สองตัว · reservation ของ request อื่นถูกนับ
**Deps** C04, C05
**Out** การเรียก provider (C08)

### C08 · State machine I: claim/lease + start + poll + uncertain
**Goal** start แบบ at-most-one automatic attempt และไม่มีทาง start ซ้ำโดยอัตโนมัติ
**Scope** `lib/collect/machine.ts`: claim (ยังไม่จบ หรือจบแล้วแต่ยังมีงานหลังจบที่ถึงเวลา) · **หนึ่ง transition ต่อการเรียก** · `queued` → commit marker → start → `running` / `failed(provider_start_failed)` / `provider_start_uncertain` · `starting` ที่ lease หมดอายุและไม่มี run id → `provider_start_uncertain` · poll → `running` / `importing` / failed ตามสถานะ provider · `next_check_at` back-off
**Acceptance** ไม่มีเส้นทางใดใน GET ที่เรียก start · response หายไม่ทำให้ start ซ้ำตลอด 50 tick
**Tests** (mock + local DB) advance ขนานกันสองตัว → start หนึ่งครั้ง · response หาย → uncertain · worker ตายหลัง marker → uncertain · GET 50 ครั้งระหว่าง running → start = 0 · 4xx → failed · TIMED-OUT / ABORTED
**Deps** C04, C06, C07
**Out** import (C09), reconcile (C11)

### C09 · State machine II: import + adoption + zero result + media
**Goal** commit แบบ exactly-once บังคับด้วย DB
**Scope** marker `import_attempted_at` · ถ้ามี `collection_run` ที่มี request id นี้แล้ว → adopt ไม่ commit ซ้ำ · fetch ≤ cap จำนวนและภายใน byte budget → adapter → **`analyzeImport` → `commitImport` (`actorId = requested_by`)** — ไม่เรียก `previewImport` เพราะต้องมี session ของผู้ใช้ · unique violation → adopt · ไม่มี item → `succeeded` ไม่สร้าง Dataset · หลังจบ: `enqueueRun` เป็นขั้นแยก (idempotent) · บันทึก result counts และ `stop_reason`
**Acceptance** จำนวน `collection_runs` ต่อ request ≤ 1 เสมอ แม้ commit ซ้ำโดยจงใจ
**Tests** crash หลัง commit ก่อนอัปเดต request → adopt · บังคับ commit สองครั้ง → rollback ทั้ง transaction · zero items · `adapter_rejected` (เกินขนาดหรือไม่ผ่าน validate) → ไม่มีอะไรถูกเขียน · media enqueue ซ้ำไม่เพิ่มแถว · **parity test**: export ที่ถูกและผิดชุดเดียวกันผ่าน `previewImport` และ `analyzeImport` ได้ canonical output, validation rejection และ reported/computed counts เท่ากัน · `created_by` ของ run และ dataset = `requested_by` ของ request (ไม่ใช่ worker) · export เกินขนาด → `export_too_large` ไม่มีอะไรถูกเขียน
**Deps** C02, C08
**Out** cost (C10)

### C10 · Cost lifecycle
**Goal** ต้นทุนมีสถานะของตัวเอง และงบใช้ตัวเลขที่ระวังที่สุดเสมอ
**Scope** ตอนจบ → อ่าน `usageTotalUsd` เป็น provisional · อ่านซ้ำใน tick ถัดไป → final เมื่ออ่านสองครั้งห่าง ≥ `cost_settle_minutes` แล้วตรงกัน · unreported เมื่อเกิน `cost_final_window_hours` · ตั้ง `ceiling_reached`
**Acceptance** provisional ไม่ถูกรายงานเป็นยอดสุดท้าย · admission ของ request ถัดไปเห็นยอดตามสถานะ
**Tests** provisional → เปลี่ยน → คงที่ → final · ไม่รายงานเลย → unreported · ใช้ร่วมกับ C05
**Deps** C05, C08 · ค่า settle เริ่มต้นจาก C01-B
**Out** UI

### C11 · Uncertain-start reconciliation + admin recovery
**Goal** start ที่ผลไม่แน่นอนถูกคลี่คลายด้วยหลักฐาน หรือส่งให้ admin ตัดสิน ไม่มีทางเดาเอง
**Scope** reconcile ครั้งละหนึ่งหน้า (`reconcile_page_size`) ภายใน `reconcile_window_minutes` · match ทั้ง `runTag = request id` **และ** URL ใน input = `source_url` · เจอหนึ่ง → `running` · ไม่เจอหรือเจอเกินหนึ่ง → `requires_admin` · `lib/collect/recovery.ts`: แนบ run id (ตรวจว่าตรงก่อน) · ยืนยันว่าไม่มี run → failed · อนุญาต start ใหม่ (บันทึกว่าอาจเสียเงินซ้ำ) — audit ทุกอย่าง · uncertain ถือ reservation และนับใน `max_concurrent`
**Acceptance** ไม่มี start ใหม่โดยอัตโนมัติจากสถานะ uncertain ในทุกกรณี
**Tests** match หนึ่ง · ศูนย์ · สอง → admin · แนบ run ที่ tag ไม่ตรง → ปฏิเสธ · อนุญาต start ใหม่ → audit + attempt ใหม่ · uncertain บล็อก admission เมื่อ `max_concurrent = 1`
**Deps** C06, C08 · C01-B (ยืนยันว่า `runTag` อ่านกลับได้)
**Out** UI (C15)

### C12 · Advance route + scheduler + maxDuration ที่ทดสอบได้ ⭐ milestone
**Goal** backend เดินได้ครบวงจรด้วย mock provider โดย collector ยังปิดสำหรับผู้ใช้
**Scope** `app/api/collections/advance/route.ts` (machine auth ด้วย token ของตัวเอง · claim ≤ `tick_batch` · ตอบ `202` · หนึ่ง step ต่อ request ใน `after()`) · `export const maxDuration = 300` · migration: `run_collection_advance()` (security definer อ่าน Vault · ไม่ยิง HTTP ถ้าไม่มีงาน) + cron · `scripts/collection-schedule-config.mjs`
**Compat (ใน ticket นี้)** **`tests/db/foundation-audit.test.ts` ใส่ฟังก์ชันใน machine-only + definer list** · `tests/migrations.test.ts` (รายการฟังก์ชัน) · **`scripts/check-privileged-imports.mjs` เพิ่ม `ALLOWED`** สำหรับ route และโมดูล privileged · bundle scan เพิ่ม advance token
**Acceptance** route ประกาศ `maxDuration` ชัดเจน · เวลา import ที่วัดบน local ที่ขีดจำกัดที่ตั้งไว้ < 80% ของค่านั้น · เวลาจริงบน production วัดใน C16 และไม่ใช้ค่าประมาณเป็นเงื่อนไขความถูกต้อง · ไม่มี invocation ใดรอ run จนจบ
**Tests** test อ่าน export `maxDuration` + ขอบเขตจากการวัด (แบบเดียวกับ 0034) · 401 เมื่อไม่มี token · 202 เร็ว · SQL function ไม่เรียก `net.http_post` เมื่อว่าง · function เรียกจาก app role ไม่ได้ · ฆ่ากลางขั้น → tick ถัดไปทำต่อได้ถูกต้อง
**Deps** C08, C09, C10, C11
**Out** UI

> **Milestone หลัง C12:** เก็บข้อมูลได้ครบวงจรกับ mock provider ผ่าน scheduler จริง · ผู้ใช้ยังไม่เห็นอะไร

---

## P1 — API และหน้าจอ

### C13 · Collections API: user DTO + admin endpoints
**Goal** ผู้ใช้ทั่วไปได้ข้อมูลเฉพาะ DTO ที่ปลอดภัยเท่านั้น โดยที่ server ไม่โหลดฟิลด์ admin บนเส้นทางนั้นเลย
**Scope** `POST /api/collections` (admission + advance ครั้งแรก) · `GET /api/collections/:id` (DTO จาก view · nudge เพื่อ poll เท่านั้น) · `GET /api/collections` · `GET …/:id/diagnostics` (admin) · `POST …/:id/recovery` (admin) · `GET /api/collector/usage` (admin · provisional มีป้ายชัดเจน) · `PATCH /api/collector/settings` (admin · audit) · `lib/collect/dto.ts`
**Acceptance** response ของ analyst ตรงกับชุด key ของ DTO ทุกสถานะ (รวม failed / uncertain / zero) · viewer ได้ 403 ทุก route · analyst ได้ 403 ที่ diagnostics / recovery / usage / settings
**Tests** exact key set · ไม่มีสตริง provider, token หรือ cost ใน JSON ของผู้ใช้ทั่วไป · POST ซ้ำด้วย `requestKey` เดิม → 200 request เดิม · 409 ตามเหตุผล
**Deps** C07–C11
**Out** หน้าจอ

### C14 · Manual import → admin + navigation ตาม role — **release unit เดียวกับ C15**
**Goal** Extension และ manual import ไม่อยู่ใน UX ปกติอีกต่อไป
**Scope** `/import` + `/api/imports/preview` + `/api/imports/commit` → `requireRole("admin")` · ป้าย `นำเข้าไฟล์ (กู้คืนระบบ)` · `NavItem.minRole` กรองฝั่ง server · เมนู `เก็บข้อมูลใหม่` (analyst+) · `ค่าเก็บข้อมูล` (admin) · Extension ยังใช้ได้ครบในฐานะ fallback ของ admin
**Compat (ใน ticket นี้)** **`e2e/global.setup.ts` เพิ่มบัญชี admin** · **p2 spec ทั้งเจ็ดไฟล์ที่ import ผ่าน UI ย้ายไปใช้ session admin**
**Acceptance** analyst ได้ 403 ทั้งสอง route และหน้า `/import` · HTML ของ viewer และ analyst ไม่มีเมนูของ admin · p2 ผ่านด้วยการ import แบบ admin · import ไฟล์จาก Extension ผ่าน admin ได้เหมือนเดิม
**Tests** role matrix ของสาม route · สแกนเมนูใน HTML · Playwright p2 ทั้งชุด
**Deps** — implement ได้ก่อน แต่ **ปล่อยเป็นหน่วยเดียวกับ C15 เท่านั้น** เพื่อไม่ให้มีช่วงที่ analyst เก็บข้อมูลไม่ได้เลย
**Out** หน้าเก็บข้อมูล (C15)

### C15 · หน้าเก็บข้อมูล + หน้า admin ⭐ milestone — **release unit เดียวกับ C14**
**Goal** เส้นทางผู้ใช้ครบ: ฟอร์ม → ความคืบหน้า → ผลลัพธ์
**Scope** `app/(app)/collect` (สร้าง `requestKey` ตอน render · หมวดหมู่บังคับเลือก · ชื่อ dataset เติมให้และแก้ได้ · ประเทศตาม allowlist · สถานะ · `maxRecords` ≤ cap) · `collect/[id]` (poll · สถานะ failed / uncertain / zero / partial พร้อมข้อความตาม spec) · `app/(app)/collector` (admin: window แสดงเวลากรุงเทพ · ป้าย provisional · ฟอร์ม settings · รายการที่รอ recovery พร้อมปุ่มดำเนินการ)
**Acceptance** analyst ไปถึง Dataset โดยไม่เห็นชื่อ provider · **refresh หน้าความคืบหน้ากี่ครั้งก็ได้ provider start = 1 เสมอ** · ปิด browser ระหว่างรัน แล้วงานยังเดินจนจบ
**Tests** Playwright (project ใหม่ `collect`, mock provider): เส้นทางเต็มของ analyst · refresh 20 ครั้ง → ตัวนับ start ของ mock = 1 · ปิด context ระหว่าง running → scheduler ทำต่อจนจบ · viewer ไม่มีเมนูและได้ 403 · admin usage + recovery · validation ของฟอร์ม · ข้อความ `not_configured` / `budget_reached` / `busy`
**Deps** C13, C14
**Out** การเปิดใช้จริงกับ Apify (C16)

> **Milestone หลัง C15:** ใช้งานครบบน mock · collector ยังปิดจนกว่า C16 จะผ่าน

---

## P2 — Release

### C16 · Production activation gate — ประตูเปิดใช้งานจริงเพียงประตูเดียว
**Goal** พิสูจน์ทั้งระบบตามเงื่อนไขของเจ้าของ แล้วเปิด collector ตามลำดับที่ปลอดภัย
**Scope** regression เต็มบน local (npm test · DB · Playwright chromium / p2 / c3 / collect · build) · watcher: 0 การเชื่อมต่อไป Supabase Cloud และ `api.apify.com` ระหว่าง test · guard scanner · เอกสาร (`PILOT_OPERATIONS.md`: การตั้งค่า collector, recovery · `PILOT_USER_GUIDE.md`: `เก็บข้อมูลใหม่` แทนการ import) · ลำดับเปิดใช้: migration → deploy (`enabled = false`) → Vault + settings → run แรกจริงที่เจ้าของอนุมัติ → `enabled = true`

**Production activation requirements (เจ้าของกำหนด — ต้องผ่านครบทุกข้อพร้อมหลักฐาน):**
1. ไม่มี provider start ซ้ำใน test แบบ retry และ race
2. ไม่มี canonical commit ซ้ำ
3. ผู้ใช้ที่ไม่ใช่ admin ไม่เห็นข้อมูลภายในของ provider
4. analyst เก็บข้อมูลผ่าน Apify ได้ครบวงจร
5. viewer เริ่มการเก็บข้อมูลไม่ได้
6. analyst ใช้ manual import ไม่ได้
7. admin ใช้ recovery และ manual import ได้
8. งบรายเดือนและเพดานต่อ run ถูกบังคับฝั่ง server
9. run ที่ไม่พบโฆษณาไม่สร้าง Dataset แต่เก็บประวัติ run ไว้
10. โฆษณาที่ active มี canonical `end_date = null` เสมอ
11. metrics การเมืองของ Meta ที่ต้องห้ามไม่ไปถึงการ validate และการจัดเก็บ
12. ปิด browser แล้วการเก็บข้อมูลไม่หยุด
13. refresh หน้าความคืบหน้าไม่ทำให้เกิดค่าใช้จ่าย Apify เพิ่ม
14. การกระทบยอดต้นทุนแยก provisional กับ final
15. Extension ยังทำงานได้ในฐานะ fallback ที่ซ่อนอยู่

**Acceptance** requirement 1–15 ผ่านครบ · acceptance criteria 1–17 ของ spec ผ่าน (ตามถ้อยคำที่ review ปรับแล้ว) · run จริงครั้งแรกไหลผ่านครบทุกสถานะ · เก็บรูปได้จริงจาก CDN ของ provider
**Tests** ทุกชุดข้างบน
**Deps** C01-A–C15 + ค่าจากเจ้าของ (budget · per-run ceiling · billing anchor/length · cap จำนวนและขนาด (provisional จาก C01-A จนกว่าจะมีข้อมูลงานจริง) · token · build pin)
**Out** Phase ถัดไป

---

## ลำดับและ milestone

```
C01-A ──► C01-B (อนุมัติแยก)
  │         │
C02 ────────┼──────────────► C09
C03 ⭐ (ส่งได้ทันที) │
C04 ──┬── C07 ──┼── C08 ──┬── C09 ──┐
C05 ⭐┘         │         ├── C10 ──┼── C12 ⭐ ── C13 ──┐
C06 ◄── C01-A/B ┘         └── C11 ──┘                  ├── [C14 + C15] ⭐ ── C16 (เปิดใช้จริง)
```

- ทำขนานได้ตั้งแต่ต้น: C01-A, C02, C03, C04, C05
- C03 ส่งขึ้นระบบได้ทันที (ปิดช่องที่ชื่อ Extension หลุดไปถึง viewer)
- C14 และ C15 ปล่อยพร้อมกันเป็นหน่วยเดียว
- ระบบเดิมทำงานได้ตามปกติหลังทุก ticket เพราะ `collector.enabled = false` จนถึง C16

## หมายเหตุก่อนเริ่ม

- **ไม่มี run ที่เสียเงินโดยไม่ได้รับอนุมัติจากเจ้าของทันทีก่อนรัน** — มีเพียง C01-B และ run แรกจริงใน C16
- token ของ Apify เจ้าของใส่ใน `.env.local` เอง · ไม่ขอ ไม่แสดง ไม่บันทึก token ในแชท เอกสาร หรือ log
- test ทุกตัวใช้ mock หรือ fake fetch · watcher และ bundle scan เป็นเกณฑ์ผ่าน ไม่ใช่ข้อแนะนำ
- ค่า TBD ทั้งหมดอยู่ใน `app_settings` และค่าเริ่มต้นเป็น null · ระบบปฏิเสธการเริ่มจนกว่าจะตั้งค่า
- เมื่อ spec กับ architecture review ขัดกัน ให้ยึด review (ตาราง "Where this review supersedes the approved spec")
- `schema_migrations` exposure (เสนอเป็น migration แยก) ไม่อยู่ในแผนนี้
