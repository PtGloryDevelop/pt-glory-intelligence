# Architecture Review — Phase 1

วันที่: 1 กันยายน 2569 · review ของ `SPEC_2026-09-01_PHASE1.md`

---

## Architecture Summary

Next.js App Router (TS) + Supabase Postgres · **13 ตาราง** · import แบบ synchronous ใน **transaction จริงผ่าน direct Postgres connection** · ชั้น normalizer แยกขาดจาก UI · master entity upsert แบบ **monotonic** / observation append · **dataset read เป็น snapshot-consistent** · RLS 3 role + authorization ฝั่ง Node สำหรับเส้นทางที่ bypass RLS · ไม่มี AI ไม่มี job queue ใน Phase 1

## Data Flow

```
ไฟล์ JSON (client upload)
  │
  ▼ POST /api/imports/preview        ── อ่านอย่างเดียว ไม่แตะ DB
  │   validate (schema/enum/unknown key/size)
  │   → normalize → recompute counts → เทียบกับ reported (I3)
  │   → นับ coverage → เทียบกับ ads ที่มีอยู่
  │   ถ้า file-level ผิด → 422 จบที่นี่ ไม่มี run ไม่มี quarantine
  │
  ▼ POST /api/imports/commit
  │   requireRole('analyst')          ← Node ตรวจก่อน เพราะ tx bypass RLS
  │   ▼ BEGIN  (direct pg connection)
  │       insert collection_runs      (reported_* + computed_*)
  │       upsert pages                ─ monotonic guard (I2)
  │       append page_observations
  │       upsert ads                  ─ LEAST/GREATEST + monotonic guard (I2)
  │       append ad_observations
  │       insert dataset_ads
  │       insert dataset_quality      ← server calculator เท่านั้น (I3)
  │       insert import_quarantine    (row-level เท่านั้น)
  │       insert audit_logs
  │     COMMIT / ROLLBACK
  │
  ▼ Dataset → Ads Explorer → Ad Detail Drawer
      อ่านผ่าน user JWT (RLS ทำงาน) + pin ที่ dataset.collection_run_id (I1)
```

**ชั้นที่แยกขาด**
```
collector JSON shape → validator → normalizer → canonical domain type → DB → API DTO → UI
```
UI ห้าม import type ที่มีรูปร่างของ collector · `_pt_glory` ไปได้ไกลสุดแค่ `ad_observations.collector_meta` (jsonb) ไม่โผล่ใน DTO

## Components Affected

ทั้งหมดสร้างใหม่ (repo ยังไม่มีโค้ด): migrations 0001–0015 · `lib/collector/{validate,normalize,coverage}` · `lib/domain/*` · `app/api/imports/*` · `app/api/datasets/*` · `app/api/ads/*` · UI: Import, Dataset, Explorer, Drawer · `lib/auth/roles`

## Checklist

| ข้อ | ผล |
|---|---|
| master Ad + dataset membership | ✅ `ads.ad_archive_id` unique · `dataset_ads` m2m |
| observation history | ✅ append only ทั้ง `ad_observations` และ `page_observations` · ไม่มี UPDATE บนตาราง observation |
| Page แยกจาก Brand | ✅ Phase 1 มีแค่ `pages` · ไม่มี `brands` และไม่ถือ `page_name` เป็นแบรนด์ |
| provenance + quality | ✅ `collection_runs` เก็บ scope/method/completeness_claim · `collector_meta` · `dataset_quality` |
| long jobs | ⚠️ ดู Risk 1 |
| secrets server-side | ✅ service-role key ฝั่ง server + test ตรวจ bundle |
| business rules ฝั่ง server | ✅ RLS + ตรวจ role ซ้ำใน route |
| minimal | ✅ ตัด `background_jobs` ออก · 11 ตาราง ไม่ใช่ 24 |
| retry / recover | ⚠️ ดู Risk 1 |
| UI ไม่ผูกกับ collector shape | ✅ canonical type คั่น |
| AI แยกจาก deterministic | ✅ ไม่มี AI ใน Phase 1 |

## Risks

**R1 — import แบบ synchronous** (ปานกลาง)
500 ads / 4.2 MB ผ่านได้สบาย แต่ถ้าไฟล์โต 10 เท่าจะชน timeout ของ serverless และ **ไม่มีทาง resume**
→ ยอมรับใน Phase 1 พร้อม **guard: ปฏิเสธไฟล์ > 5,000 records หรือ > 25 MB พร้อมข้อความบอกให้แบ่งไฟล์** และเปิด ticket Phase 2 สำหรับ job queue
→ transaction เดียวทำให้ล้มแล้วสะอาด ไม่มี run ค้าง — recover = อัปโหลดใหม่

**R2 — `first_seen_at` ย้อนหลังได้ แต่ current state ต้องไม่ถอยหลัง** (สูง)
คำตัดสิน D บอก `MIN(run.collected_at)` → import ไฟล์เก่ากว่าทีหลังต้องดัน `first_seen_at` ย้อนหลัง
**แต่** ห้ามให้ run เก่าทับ current state (I2) — ไม่งั้น import ย้อนหลังจะทำให้ `is_active` กลายเป็นค่าของอดีต

upsert ที่ถูกต้อง:
```sql
insert into ads (...) values (...)
on conflict (ad_archive_id) do update set
  first_seen_at = LEAST(ads.first_seen_at, excluded.first_seen_at),
  last_seen_at  = GREATEST(ads.last_seen_at, excluded.last_seen_at),
  is_active = case when excluded.last_seen_at >= ads.last_seen_at
                   then excluded.is_active else ads.is_active end,
  display_format      = case when excluded.last_seen_at >= ads.last_seen_at
                             then excluded.display_format else ads.display_format end,
  publisher_platform  = case when excluded.last_seen_at >= ads.last_seen_at
                             then excluded.publisher_platform else ads.publisher_platform end,
  page_ref            = case when excluded.last_seen_at >= ads.last_seen_at
                             then excluded.page_ref else ads.page_ref end,
  collation_id        = case when excluded.last_seen_at >= ads.last_seen_at
                             then excluded.collation_id else ads.collation_id end,
  updated_at = now();
```
ใน `do update` ฝั่งซ้ายของการเปรียบเทียบ (`ads.last_seen_at`) คือค่าเดิมก่อนอัปเดต จึงใช้เป็น guard ได้ · `excluded.last_seen_at` = `run.collected_at` ของไฟล์ที่กำลัง import
กติกาเดียวกันใช้กับ `pages` (`page_profile_numeric_id`, `page_profile_uri`)
บังคับด้วย acceptance ข้อ 4 และ 5

**R7 — dataset อ่าน observation ผิดรอบ** (สูง · ใหม่)
ถ้า Explorer/Drawer อ่าน "latest observation" แบบ global ข้อมูลของ dataset เก่าจะเปลี่ยนไปเองทุกครั้งที่ import รอบใหม่ — historical dataset จะไม่นิ่ง
→ ทุก query ในบริบท dataset ต้อง `where collection_run_id = dataset.collection_run_id` (I1)
→ บังคับด้วย `unique (collection_run_id, ad_ref)` เพื่อให้ผลลัพธ์ deterministic โดยไม่ต้อง `distinct on`
→ `GET /api/ads/:id` ต้องรับ `datasetId` และเมื่อไม่มีต้องติดป้ายว่าเป็น master current state

**R8 — service role bypass RLS** (สูง · ใหม่)
transaction ของ import ใช้ `DATABASE_URL` ที่ bypass RLS ทั้งหมด ถ้า credential นี้หลุดไปใช้กับเส้นทางอ่าน RLS จะกลายเป็นของประดับ
→ แยก client สองตัวชัดเจนในโค้ด: `dbUser()` (anon + JWT, สำหรับอ่าน) และ `dbPrivileged()` (elevated, สำหรับ import เท่านั้น)
→ `requireRole()` ต้องรันก่อนเปิด transaction เสมอ + lint rule/test ห้าม `dbPrivileged` ปรากฏในไฟล์ของเส้นทางอ่าน

**R3 — collector เปลี่ยน contract โดย `schema_version` ไม่ขยับ** (สูง)
พิสูจน์แล้วว่าเกิดขึ้นจริงระหว่าง v1.0.0 → build ปัจจุบัน
→ reject ไฟล์ที่มี key แปลกหน้า + แยก build ด้วย `collection_method` + pin golden fixture · **ห้ามใช้ passthrough jsonb เป็นทางออก**

**R4 — coverage นับผิดเพราะ null-object** (ปานกลาง)
บทเรียนจาก `impressions_with_index` ของ Collector V2 ที่ "มีค่า" 100% แต่ข้างในเป็น null ทั้งหมด
→ กฎ non-empty ต้องครอบ: null · `''` · `[]` · object ที่ทุกคีย์ null · และ **`is_active = null` นับเป็นไม่ครอบคลุม**

**R5 — media URL ของ Meta หมดอายุ** (ต่ำ)
เก็บแค่ URL ตาม `ARCHITECTURE.md` → Drawer ต้อง fallback ไม่พังทั้งหน้า · ไม่ mirror ไฟล์ใน Phase 1

**R6 — ไฟล์อัปโหลดคือ untrusted input** (ปานกลาง)
→ ไม่ eval · ไม่ทำตามข้อความในไฟล์ · จำกัดขนาด · ทิ้ง cookie/token ถ้าพบ · escape ตอน render body_text (XSS)

## Rejected Alternatives

| ทางเลือก | เหตุผลที่ไม่เอา |
|---|---|
| ยิง supabase-js หลายคำสั่งแล้วเรียกว่า transaction | **ไม่ใช่ transaction จริง** — ล้มกลางทางแล้วข้อมูลค้างครึ่ง ๆ ไม่มีทาง rollback |
| RPC plpgsql รับ JSONB ทั้งไฟล์เป็น argument เดียว | atomic จริง แต่ payload 4.2 MB ขึ้นไปเป็น argument เดียวเปราะ และดัน normalization ไปอยู่ใน plpgsql ที่เทสต์ยาก |
| อ่าน dataset ด้วย latest observation แบบ global | ทำให้ historical dataset เปลี่ยนค่าเองทุกครั้งที่ import รอบใหม่ (R7) |
| ใช้ `distinct on (ad_ref)` แทน unique constraint | ซ่อนปัญหาข้อมูลซ้ำต่อ run แทนที่จะกันไว้ที่ schema |
| ใช้ตัวเลข `quality_summary` ของ collector เป็น canonical | ผิด I3 · เราไม่ได้ตรวจว่ามันนับแบบเดียวกับเรา |
| เก็บ role ใน `auth.users.app_metadata` | RLS policy query ยาก และแก้ผ่าน migration ไม่ได้ |
| ใช้ `record_key`/fingerprint เป็น master identity | คำตัดสิน B ห้าม · และไฟล์จริง unresolved = 0 จึงไม่จำเป็น |
| เก็บ ad ดิบทั้งก้อนใน jsonb แล้วค่อย query | ผิด CLAUDE.md ข้อ 2 (ทุก metric ต้องสาวถึง field) · index ไม่ได้ · UI จะผูกกับ collector shape |
| ทำ `background_jobs` ตั้งแต่ Phase 1 | ผิดข้อ 12 (overengineering) · 500 ads ไม่ต้องใช้ |
| ทำ 24 ตารางตาม Master Spec §6 ทันที | ผิดข้อ 12 · Phase 1 ไม่ใช้ 13 ตาราง |
| ใช้ `updated_at` ของแถวเป็น first_seen | ผิดคำตัดสิน D โดยตรง — พังเมื่อ import ข้อมูลย้อนหลัง |
| ยอมรับ key แปลกหน้าแล้วข้ามเงียบ | ทำให้ contract drift มองไม่เห็น ซึ่งเป็นบั๊กที่เพิ่งเจอจริง |
| enum ตายตัวของ `publisher_platform` | ไฟล์จริงมี WHATSAPP ที่ v1.0.0 ไม่รู้จัก · ค่าใหม่จะโผล่อีก |

## Recommended Design

อนุมัติ spec ตามที่เขียน **โดยเพิ่ม 8 ข้อบังคับ**

1. upsert ของ `ads` ใช้ `LEAST`/`GREATEST` สำหรับ first/last seen **บวก monotonic guard สำหรับ current-state fields** (R2/I2)
2. guard ขนาดไฟล์ 5,000 records / 25 MB ที่ชั้น validator
3. non-empty predicate เป็นฟังก์ชันเดียวใช้ร่วมทั้ง coverage และ preview — ไม่ให้มีสองนิยาม
4. `publisher_platform` / `page_categories` เก็บเป็น `text[]` ไม่ใช่ enum
5. **transaction จริงผ่าน direct pg connection** — `BEGIN/COMMIT/ROLLBACK` ในคอนเนกชันเดียว ห้ามนับ supabase-js หลายคำสั่งเป็น transaction
6. **dataset read pin ที่ `dataset.collection_run_id`** ทุกจุด + `unique (collection_run_id, ad_ref)` (R7/I1)
7. **server recompute counts** และ reject เมื่อไม่ตรงกับที่ collector รายงาน · `dataset_quality` มาจาก server calculator เท่านั้น (I3)
8. **แยก `dbUser()` / `dbPrivileged()`** และ `requireRole()` ก่อนเปิด transaction ทุกครั้ง (R8)

## Migration / Compatibility Impact

schema ใหม่ทั้งหมด ไม่มีข้อมูลเดิม · rollback = drop ย้อนลำดับ 0015 → 0001
รองรับ collector อนาคตด้วยการเพิ่มค่าใน `collection_method` + migration ใหม่เท่านั้น

## Approval Blockers

**ไม่มี blocker** — คำตัดสิน A–D ปิดครบแล้ว และ export จริงยืนยันทุกข้อ

ค้างแบบไม่บล็อก: source ของ collector ตัวใหม่ (แตก `.rar` ไม่ได้ ไม่มี 7z/unrar ในเครื่อง) → R3 คุมด้วย reject-unknown-key ไปก่อน
