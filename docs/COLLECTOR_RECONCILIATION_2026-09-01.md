# Collector Version Reconciliation

วันที่: 1 กันยายน 2569
เทียบ: local Extension repo ↔ production export ที่อนุมัติเป็น source ของ Phase 1

---

## คำตอบตรงคำถาม

> local repo ที่ audit คือ collector version ไหน

**`D:\Project\PT-Glory-Meta-Ad-Library-Extension` คือ v1.0.0 — DOM-only — และ *ไม่ใช่* collector ที่สร้าง export ที่อนุมัติ**

หลักฐาน:

| หลักฐาน | ค่า |
|---|---|
| `package.json` version | `1.0.0` |
| `package.json` description | *"No-build Chrome Extension for **user-initiated DOM capture** from Meta Ad Library."* |
| `manifest.json` version | `1.0.0` |
| `manifest.json` description | *"...โดยอ่าน**เฉพาะ DOM**และส่งออกในเครื่อง"* |
| permissions | `activeTab, scripting, sidePanel, storage, downloads` — **ไม่มี `webRequest` / `declarativeNetRequest`** |
| grep `network_response` ทั้ง repo | **0 ผลลัพธ์** |
| grep `graphql` ทั้ง repo | **0 ผลลัพธ์** |
| `core.js:559` | `collection_method: 'user_initiated_dom_observation'` (hard-coded) |

**สรุป: repo นี้ทำ network capture ไม่ได้ในเชิงเทคนิค** ไม่มีสิทธิ์ที่จำเป็นและไม่มีโค้ดที่เกี่ยวข้องเลย

**คุณพูดถูก** — export ที่ให้มาไม่ได้มาจาก build นี้

---

## Export ที่อนุมัติ — มาจาก build ที่ยังไม่มีในเครื่อง

ไฟล์: `pt-glory-meta-ads-th-ว-ตาม-นผ-ก-2026-08-28T09-57-53-687Z.json` (4.2 MB, 28 ส.ค. 2569)

```
schema_version   : pt-glory-meta-ad-library-export.v1     ← เหมือน v1.0.0 เป๊ะ
collection_method: network_response_observation            ← ต่าง
_pt_glory.request_url: https://www.facebook.com/api/graphql/  ← GraphQL จริง
source_rows      : 500 · unique_ads 500 · unique_pages 309
unresolved_count : 0
scope            : {country: TH, query: "วิตามินผัก", active_status: active, ad_type: all, media_type: all}
stop_reason      : limit_reached
```

`completeness_claim` ก็เปลี่ยนไปแล้ว:
- v1.0.0: *"Only records loaded and readable in the user session are included."*
- production: *"Only **structured ad records observed in network responses** already loaded by the Meta Ads Library page during this user-initiated session are included."*

### 🔴 ปัญหาที่ต้องแก้ก่อนอย่างอื่น — schema_version ไม่ขยับ

**contract เปลี่ยนไปมาก แต่ `schema_version` ยังเป็น `...v1` เท่าเดิม**

แปลว่า **importer แยกไม่ออกว่าไฟล์มาจาก build ไหน** ทั้งที่โครงต่างกันจริง นี่คือความเสี่ยงระดับข้อมูลเสียหาย ไม่ใช่เรื่องความเรียบร้อย

---

## Diff ระดับ ad row

### ✅ มีใน production ไม่มีใน v1.0.0

| field | coverage | ความหมาย |
|---|---|---|
| **`meta_page_id`** | **100%** | Master Spec §4 ขอไว้ — มีจริง |
| **`page_profile_numeric_id`** | **44%** (221/500) | Data Contract ขอไว้ — มีจริง |
| **`network_end_date_raw`** | **100%** | Master Spec §4 ตั้งชื่อนี้ไว้เป๊ะ |
| `raw_evidence` (top level) | 0% | ประกาศไว้ ยังไม่มีค่า |
| `quality_summary.detail_attempted / detail_succeeded / detail_failed / detail_skipped` | — | 4 คีย์ใหม่ระดับไฟล์ |

### ✅ มีใน v1.0.0 หายไปจาก production — ข่าวดี

| field | สถานะใน v1.0.0 |
|---|---|
| **`likes` `spend` `reach` `impressions`** | **ถูกลบออกแล้ว** — placeholder ต้องห้าม 4 ตัวไม่อยู่ใน export จริง |
| `product_ids` `product_names` `target_ids` `target_labels` | ลบแล้ว |
| `running_seconds` `is_new_7d` `is_new_30d` `region_flags` | ลบแล้ว |
| `extra_texts` `media_types` | ลบแล้ว |
| `first_seen_at` `last_seen_at` `first_seen_run_id` `last_seen_run_id` `last_seen_run_ids` `updated_at` | ลบแล้ว — **สอดคล้องกับคำตัดสิน D: DB เป็นเจ้าของ** |

**ฟิลด์ผี 15 ตัวที่ผมรายงานใน grill — 13 ตัวหายไปแล้วใน build ใหม่** เหลือ `page_aliases` (0%) และ `end_date_raw` (0%)

### ⚠️ ยังอยู่ทั้งคู่แต่ว่างเปล่า

`page_aliases[]` 0% · `end_date_raw` 0% · `raw_evidence` 0%

---

## Coverage จริง — ตัวเลขสำหรับ Phase 1

ads 500 · 32 คีย์

| tier | fields |
|---|---|
| **100%** | `ad_archive_id` `record_key` `page_id` `meta_page_id` `page_name` `page_profile_uri` `page_categories` `page_like_count` `is_active` `start_date` `start_date_raw` `network_end_date_raw` `display_format` `collation_count` `publisher_platform` `_pt_glory` |
| **98%** | `collation_id` (490) |
| **93%** | `cta_text` `cta_type` (463) |
| **99.6%** | `body_text` (498) |
| **52%** | `videos` (261) |
| **45%** | `images` (223) |
| **44%** | `page_profile_numeric_id` (221) |
| **36%** | `title` (180) |
| **9%** | `link_url` (45) |
| **8%** | `caption` (41) |
| **4%** | `link_description` (21) |
| **3%** | `cards` (17) |
| **0%** | `end_date` `end_date_raw` `page_aliases` `raw_evidence` |

**เกณฑ์ §13:** `title` 36% · `link_url` 9% · `caption` 8% · `link_description` 4% · `cards` 3% → **ต่ำกว่า 50% ทั้งหมด ต้อง scope เป็น readable subset เสมอ**

---

## ข้อค้นพบเชิงความหมาย

### 1. Master Spec §4 ถูก implement แล้วใน build ใหม่ ✅

```
is_active = true : 500/500
end_date         : 0/500      ← normalize เป็น null แล้ว
network_end_date_raw : 500/500 ← raw ถูกเก็บแยก
```

กฎ "active → end_date = null, เก็บ raw แยก" **collector ทำให้แล้ว** ไม่ใช่ภาระของ normalizer ฝั่งเรา — แต่ยังต้อง assert ไว้กันถอยหลัง

### 2. `meta_page_id` = `page_id` ทุกแถว → คำตัดสิน 6A ถูกต้อง ✅

```
meta_page_id === page_id : 500/500
```

ซ้ำซ้อนจริง **ยืนยันให้ตัดตามที่ตัดสินไว้** (คนละเหตุผลกับที่ผมเขียนใน audit — ตอนนั้นบอกว่า "ไม่มีฟิลด์นี้" ซึ่งผิด เพราะวัดจาก Collector V2)

### 3. `page_profile_numeric_id` เป็น identifier คนละตัวจริง ✅

```
มีค่า 221/500 · และเมื่อมีค่า ต่างจาก page_id 221/221 (100%)
```

ไม่เคยเท่ากันเลย → Data Contract ที่ให้เก็บแยก **ถูกต้อง**

### 4. `display_format` และ `cta_type` เป็น source field ไม่ใช่ derived ❗

แก้สิ่งที่ผมเขียนใน grill §3.3

```
display_format: VIDEO, IMAGE, MULTI_IMAGES, CAROUSEL, DCO, MULTI_MEDIAS   (6 ค่า)
cta_type      : ...LIKE_PAGE, VISIT_PROFILE, GET_PROMOTIONS               (นอกตาราง 26 คู่ของ v1.0.0)
```

v1.0.0 คำนวณเองได้แค่ CAROUSEL/VIDEO/IMAGE/null และ map CTA ได้ 26 คู่ — **build ใหม่รับค่ามาจาก GraphQL ตรงๆ** ดังนั้น KPI Format/CTA distribution เป็น **source-based** ไม่ต้องติดป้าย derived

### 5. `publisher_platform` มี `WHATSAPP`

v1.0.0 ตรวจได้แค่ FACEBOOK / INSTAGRAM / AUDIENCE_NETWORK / MESSENGER / THREADS
production มี **WHATSAPP** เพิ่ม → enum ฝั่ง DB ห้าม hard-code 5 ค่า

### 6. `page_categories` ใช้ได้จริง — 84 ค่าไม่ซ้ำ ✅

คำตัดสิน C ยืนได้ multi-value ตาม CLAUDE.md ข้อ 8

### 7. `page_like_count` ใช้ได้จริง 100% ✅

```
min 0 · median 9,126 · max 1,781,478
```

ช่วงกว้างมาก → **ยืนยันว่าห้ามทำ Sum KPI** (ตามคำตัดสิน C) median/top เท่านั้น

### 8. `_pt_glory` เปลี่ยนโครงทั้งก้อน ❗

| v1.0.0 | production |
|---|---|
| `source_level` (card/detail) | `source_level: "network"` |
| `observed_at` ✅ | **ไม่มี** ❗ |
| `content_hash` ✅ | **ไม่มี** |
| `field_sources` ✅ | **ไม่มี** |
| `raw_evidence` ✅ | **ไม่มี** (ย้ายไป top level, ว่าง) |
| `source_position` | `source_position` |
| `parse_warnings` | `parse_warnings` |
| `change_flags` | `change_flags` |
| — | `collection_method` ใหม่ |
| — | `request_url` ใหม่ |

**ผลสำคัญ: ไม่มี timestamp ระดับแถวอีกแล้ว** เวลาที่มีคือ `generated_at` ระดับไฟล์เท่านั้น

→ **บังคับให้คำตัดสิน D เป็นทางเดียวที่เป็นไปได้** — `first_seen_at = MIN(collection_run.collected_at)` เพราะไม่มีเวลาอื่นให้ใช้ และ `collected_at` ต้องมาจาก `generated_at` ของไฟล์

### 9. `start_date_raw` === `start_date` ทุกแถว

ทั้งคู่เป็น ISO เหมือนกัน ไม่ใช่ raw string แบบ v1.0.0 (ซึ่งเก็บข้อความไทยที่ parse มา) → ในบริบท network capture `*_raw` แทบไม่มีข้อมูลเพิ่ม แต่**เก็บไว้ตามสัญญา** ที่ provenance layer

### 10. คำตัดสิน B ไม่มีต้นทุนกับไฟล์นี้ ✅

```
unresolved_count: 0 · unresolved_ads: []
```

record_key ทุกตัวขึ้นต้น `ad:` ไม่มี `fingerprint:` เลย → `ad_archive_id NOT NULL UNIQUE` ใช้ได้ทันที

---

## สรุป: คำตัดสิน A–D หลัง reconcile

| # | คำตัดสิน | ผลตรวจ |
|---|---|---|
| **A** | ยังไม่เปลี่ยนเป็น DOM-only · `collection_method` เป็น run-level enum | ✅ **ถูกต้องและจำเป็น** — มี 2 build จริงที่ให้ค่าต่างกัน enum ต้องมีอย่างน้อย `network_response_observation`, `user_initiated_dom_observation`, `socialapis_api` |
| **B** | unresolved ห้ามเข้า master · `ad_archive_id NOT NULL UNIQUE` | ✅ ใช้ได้ทันที ไฟล์นี้ unresolved = 0 |
| **C** | เก็บ `page_like_count` + `page_categories[]` ห้าม Sum KPI | ✅ ทั้งคู่ 100% ยืนยันได้ |
| **D** | `first_seen_at = MIN(run.collected_at)` | ✅ **บังคับ** — export ไม่มี timestamp ระดับแถวแล้ว |

**เพิ่มเติมที่คุณสั่งและตรวจแล้วว่าถูก:** `is_active` รองรับ NULL (ไฟล์นี้ 500/500 = true แต่ v1.0.0 คืน null ได้ และ enum ต้องรองรับทั้งสอง collector)

---

## ความเสี่ยงที่เหลือ + สิ่งที่ต้องการ

### 🔴 บล็อกระดับสูง — source ของ collector ตัวจริงไม่มีในเครื่อง

build ที่สร้าง export นี้ **ไม่อยู่ใน `D:\Project`** ผมค้นแล้วเจอแค่ v1.0.0 กับไฟล์ `.rar` ชื่อเดียวกัน

ผลที่ตามมา:
1. บอกไม่ได้ว่าฟิลด์ไหน**การันตี**ว่ามีทุกครั้ง ฟิลด์ไหนบังเอิญมีใน query นี้
2. บอกไม่ได้ว่า `page_profile_numeric_id` 44% เป็นข้อจำกัดถาวรหรือแค่ชุดนี้
3. `schema_version` เท่ากันทั้งที่ contract ต่าง → **importer แยก build ไม่ออก**

**สิ่งที่ขอ:**
- source ของ collector ตัวใหม่ (repo หรือแตก `.rar` ให้ดู) เพื่อยืนยัน field guarantee
- ถ้าให้ไม่ได้ ขอ export เพิ่มอีก 2–3 ไฟล์จาก query/หมวดอื่น เพื่อแยกว่าอะไรคงที่ อะไรผันแปรตามชุดข้อมูล

**ถ้าไม่มีทั้งสองอย่าง ผมจะเดินต่อได้** โดยใช้ท่านี้ ซึ่งจะเขียนลง spec:
- pin ไฟล์ 500 ads นี้เป็น golden fixture
- validator ยอมรับเฉพาะ key ที่รู้จัก · **key แปลกหน้า → quarantine ทั้งไฟล์ ไม่ใช่เงียบๆ ข้าม**
- ตรวจ `collection_method` แทน `schema_version` เพื่อแยก build
- ทุก field ที่ไม่ใช่ 100% ถือเป็น optional ในโค้ด

### 🟡 ต้องแก้เอกสาร 3 จุด

1. **Master Spec §2** — ระบุให้ชัดว่ามี 2 collection method และ Phase 1 ใช้ `network_response_observation`
2. **DATA_CONTRACT.md** — เพิ่ม `collection_method` เป็น run-level enum · ยืนยัน `network_end_date_raw` (ไม่ใช่ `end_date_raw`) · คง `page_profile_numeric_id` · ตัด `meta_page_id` ตามคำตัดสิน 6A
3. **แจ้งทีม collector** ให้ bump `schema_version` เมื่อ contract เปลี่ยน — เป็น bug ของ collector ไม่ใช่ของระบบเรา

---

## Next

reconcile เสร็จแล้ว พร้อมไป `/ptg-spec` → `/ptg-architecture` → `/ptg-tickets` แล้วหยุดรายงาน ticket plan

ผมจะเขียน spec บนฐานนี้: export 500 ads ที่วัดจริง + คำตัดสิน A–D + ท่ารับมือความเสี่ยง schema_version ข้างบน
