# /ptg-grill — Phase 1 Vertical Slice

วันที่: 1 กันยายน 2569
Scope: Extension JSON → Import → Validate → Preview → Dedup → Save → Dataset → Ads Explorer → Ad Detail Drawer

**สถานะ: หยุดที่ grill — พบ conflict ระหว่าง Source of Truth ที่ต้องให้เจ้าของตัดสิน 4 ข้อ ก่อนไป `/ptg-spec`**

---

## 0. สิ่งที่เปลี่ยนไปจาก audit ฉบับก่อน

audit เมื่อเช้าวัดจาก **Collector V2** (`PT-Glory-Ads-Plan-Standalone`) เพราะตอนนั้นยังไม่ทราบว่ามี Extension อยู่

หลังคุณอนุมัติข้อ 4 (Phase 1 = Chrome Extension) ผมค้นเจอและ**อ่านโค้ด Extension จริงแล้ว**ที่ `D:\Project\PT-Glory-Meta-Ad-Library-Extension`

ไฟล์ที่อ่าน: `lib/core.js` (629 บรรทัด), `content-runner.js`, `lib/scan.js`, `lib/db.js`, `service-worker.js`, `manifest.json`

**ผลคือ ตัวเลข field coverage ในเอกสาร audit ใช้กับ Phase 1 ไม่ได้** เพราะเป็นคนละ collector คนละวิธีเก็บ ต้องวัดใหม่จาก export จริงของ Extension

---

## 1. Goal

ให้ทีม PT Glory นำไฟล์ JSON ที่ได้จาก PT Glory Chrome Extension เข้าระบบได้อย่างปลอดภัยและตรวจสอบได้ โดยที่ ad หนึ่งตัวมี master เดียวไม่ว่าจะนำเข้าซ้ำกี่ครั้ง ประวัติการสังเกตทุกครั้งถูกเก็บไว้ไม่ถูกทับ และผู้ใช้เปิดดู/กรอง/เจาะรายละเอียดโฆษณาได้จากข้อมูลจริงเท่านั้น โดยไม่มีตัวเลข performance ใดๆ ที่ source ไม่ได้ให้มา

## 2. User Journey

```
login (viewer/analyst/admin)
→ analyst สร้างหรือเลือก Category
→ อัปโหลดไฟล์ JSON จาก Extension
→ ระบบ validate schema_version + โครงสร้าง
→ Preview: จำนวน ads / unresolved / pages / ซ้ำกับที่มีอยู่ / coverage แต่ละฟิลด์
→ analyst กดยืนยัน
→ บันทึกใน transaction เดียว: collection_run + upsert master + append observation + dataset membership + quality
→ เปิด Dataset เห็น quality strip จริง
→ Ads Explorer: กรอง active / format / CTA / platform / ค้นหา copy
→ คลิกแถว → Ad Detail Drawer เปิดขวา ไม่เปลี่ยนหน้า
→ เห็น creative, metadata จริง, copy, ประวัติการสังเกต
```

## 3. Real Data Sources — จากโค้ด Extension ไม่ใช่จากเอกสาร

Schema version: **`pt-glory-meta-ad-library-export.v1`** (`core.js:8`)

### 3.1 ระดับไฟล์ (`buildExportContract`, `core.js:541`)

| field | ที่มา |
|---|---|
| `schema_version` | คงที่ |
| `generated_at` | เวลา export |
| `source_rows` · `unique_ads` · `unique_pages` · `unresolved_count` | นับจาก rows |
| `scope{country, query, active_status, ad_type, media_type}` | **สกัดจาก query string ของ Ad Library URL** (`parseScope`) |
| `source{product, collection_method, url, completeness_claim}` | คงที่ + URL ที่ผู้ใช้เปิด |
| `stop_reason` | เหตุที่หยุด scan |
| `quality_summary{warning_records, resolved_records, unresolved_records}` | นับจาก rows |
| **`ads[]`** | rows ที่มี `ad_archive_id` |
| **`unresolved_ads[]`** | rows ที่ **ไม่มี** `ad_archive_id` |

→ map ตรงเข้า `collection_runs` ได้เกือบ 1:1 **ดีกว่าที่ผมเสนอไว้ใน audit**

### 3.2 ระดับ ad — ฟิลด์ที่ Extension เก็บได้จริง

จาก `parseElement` (`content-runner.js:216`) → `parseCardEvidence` (`core.js:265`):

| field | ที่มา | หมายเหตุ |
|---|---|---|
| `record_key` | `ad:<id>` หรือ `fingerprint:<sha256>` | **identity จริงของระบบ** |
| `ad_archive_id` | regex จากข้อความ "Library ID / รหัสคลังโฆษณา" | **nullable** |
| `collation_id` | DOM | |
| `collation_count` | parse "N ads use this creative / โฆษณา N รายการ" | default 1 ถ้าไม่เจอ |
| `page_id` `page_name` `page_profile_uri` | DOM identity | |
| `is_active` | parse "กำลังใช้งาน/Active/ไม่ได้ใช้งาน" | **nullable** เมื่ออ่านไม่ได้ |
| `start_date` + `start_date_raw` | parse ข้อความหลัง "Started running on / เริ่มเผยแพร่เมื่อ" | รองรับเดือนไทย + **แปลง พ.ศ. → ค.ศ.** (`core.js:81`) |
| `end_date` + `end_date_raw` | parse หลัง "Ended on / สิ้นสุดเมื่อ" | |
| `cta_text` | ข้อความบนปุ่ม | |
| `title` `body_text` `caption` `link_description` | DOM | |
| `link_url` | **normalize แล้ว** — แกะ `l.facebook.com/l.php?u=` + ตัด utm/fbclid/gclid ฯลฯ | raw เก็บใน `raw_evidence` |
| `publisher_platform[]` | regex หา FACEBOOK/INSTAGRAM/AUDIENCE_NETWORK/MESSENGER/THREADS | |
| `images[]` `videos[]` `cards[]` | DOM media | image มีแค่ `resized_image_url` — **`original_image_url` เป็น null เสมอ** |
| `first_seen_at` `last_seen_at` | `observedAt` ของ Extension | |
| `_pt_glory{}` | source_level, observed_at, content_hash, change_flags, field_sources, parse_warnings, source_position, raw_evidence | metadata ตรวจสอบย้อนกลับได้ |

### 3.3 ฟิลด์ที่เป็น derived ไม่ใช่ source — ต้องติดป้ายตาม CLAUDE.md ข้อ 2

| field | สูตร |
|---|---|
| `cta_type` | `mapCta()` — ตาราง 26 คู่ ไทย/อังกฤษ (`core.js:17`) **ไม่ตรงตาราง → null** |
| `display_format` | `deriveDisplayFormat()` — cards>1→CAROUSEL, videos→VIDEO, images→IMAGE, else null |
| `media_types[]` | มาจาก display_format |
| `record_key` | sha256 ของ (page, body, link, media path, start_date) เมื่อไม่มี ad_archive_id |
| `content_hash` | sha256 ของ 20 CONTENT_FIELDS |
| `change_flags[]` | diff CONTENT_FIELDS ระหว่างรอบ |

**`display_format` และ `cta_type` เป็นค่าที่เราคำนวณเอง ไม่ใช่ค่าที่ Meta ส่งมา** — KPI "Format distribution" และ "CTA distribution" ต้องระบุว่าเป็น derived

---

## 4. Unsupported Requests — ตรวจแล้วพบว่าหนักกว่าที่คิด

### 4.1 ฟิลด์ผี 15 ตัวใน export ที่ไม่มีใครเขียนค่าเลย

`createAdDefaults` (`core.js:203`) ประกาศฟิลด์ไว้ แต่ `grep` ทั้ง codebase แล้ว **ไม่มีจุดไหนเขียนค่าลงไปเลย** มีแค่บรรทัดที่ประกาศ:

| field | ค่าที่ออกมาเสมอ | ความเสี่ยง |
|---|---|---|
| `likes` `spend` `reach` `impressions` | `null` | **ตรงกับรายการต้องห้าม CLAUDE.md ข้อ 3 เป๊ะ** |
| `page_like_count` | `null` | audit เดิมบอกมี 100% — **นั่นคือ Collector V2 ไม่ใช่ Extension** |
| `page_categories[]` | `[]` | เดิมคิดว่าใช้ทำ category coverage ได้ |
| `page_aliases[]` | `[]` | |
| `extra_texts[]` | `[]` | |
| `product_ids[]` `product_names[]` `target_ids[]` `target_labels[]` | `[]` | taxonomy ที่ Extension ยังไม่ implement |
| `running_seconds` | `null` | ใช้คำนวณ ad age ไม่ได้ |
| `is_new_7d` `is_new_30d` | `false` | **อันตราย — ค่า false ดูเหมือนคำตอบ ไม่ใช่ "ไม่มีข้อมูล"** |
| `region_flags[]` | `[]` | |

**ผลกระทบต่อ KPI ที่อนุมัติไปแล้ว:**

- ❌ **Page likes KPI ต้องตัดออกจาก Phase 1 ทั้งหมด** — Extension ไม่เก็บ ทั้ง median ทั้ง top ทั้ง per-page ทำไม่ได้เลย
- ❌ **Category coverage ทำไม่ได้** — `page_categories` ว่างเสมอ
- ⚠️ **CLAUDE.md ข้อ 8** พูดถึง multi-value 2 ฟิลด์ — Phase 1 ใช้ได้แค่ `publisher_platform` ฟิลด์เดียว
- ⚠️ `is_new_7d/30d` ต้อง**ทิ้งแล้วคำนวณเองฝั่ง server** จาก `first_seen_at` ห้าม import ค่า false เข้ามา

### 4.2 ยังห้ามเหมือนเดิม

engagement · reactions · comments · shares · reach · impressions · spend · CTR · CPC · CPA · ROAS · sales · conversion · market share
และห้ามอนุมานจาก ad count / ad age / collation / page likes / creative reuse

---

## 5. Derived Rules ที่ต้องนิยามใน Phase 1

| rule | นิยาม |
|---|---|
| `ad_age_days` | `current_date − start_date` (`running_seconds` ใช้ไม่ได้) |
| Evergreen | `is_active = true AND ad_age_days >= threshold` · **default 90** · อ่านจาก config ที่เดียว |
| Ads ใหม่ 30 วัน | `first_seen_at >= now() − 30 วัน` (ตามคำตัดสินข้อ 1) |
| Creative Reuse | `collation_count > 1` · denominator = rows ที่ `collation_count is not null` |
| Format / CTA distribution | group by ค่า **derived** พร้อม denominator ของ rows ที่อ่านได้ |
| Platform coverage | `unnest(publisher_platform)` — **multi-value รวมเกิน 100% ได้** |

---

## 6. Architecture Impact — schema ที่อนุมัติไปมี 4 จุดที่พังกับข้อมูลจริง

| # | ใน audit ที่อนุมัติ | ความจริงจาก Extension | ต้องแก้เป็น |
|---|---|---|---|
| 1 | `ads.ad_archive_id text not null unique` | `ad_archive_id` **เป็น null ได้** และ `unresolved_ads[]` เป็น output ชั้นหนึ่ง | `record_key text not null unique` เป็น identity หลัก · `ad_archive_id text null` |
| 2 | `ads.is_active boolean not null` | `parseStatus` คืน **null** เมื่ออ่านข้อความไม่ได้ | `is_active boolean null` + นับ null เข้า data quality |
| 3 | ไม่มีเรื่อง identity เปลี่ยน | `reconcileDetailRecord` (`core.js:448`) **เลื่อน fingerprint row ขึ้นเป็น ad จริงได้** เมื่อเจอ Library ID ทีหลัง | ต้องมี `record_key_history` หรือคอลัมน์ `resolved_from_record_key` + migration path |
| 4 | `network_end_date_raw` | Extension ใช้ชื่อ `end_date_raw` และ `start_date_raw` (มีทั้งคู่) | ใช้ชื่อ `start_date_raw` / `end_date_raw` ให้ตรงกับ source |

**ข้อดีที่พบ:** `collection_runs` ที่เสนอไว้รับ `buildExportContract` ได้เกือบครบ ไม่ต้องแก้

---

## 7. Edge Cases

**Import**
- ไฟล์ `schema_version` ไม่ตรง → reject ทั้งไฟล์ บอกเวอร์ชันที่รองรับ
- `ads[]` ว่าง แต่ `unresolved_ads[]` มีของ
- ad เดียวปรากฏทั้งใน `ads[]` และ `unresolved_ads[]`
- นำเข้าไฟล์เดิมซ้ำ → ต้องไม่สร้าง master ซ้ำ แต่ต้องเพิ่ม observation
- ad เดิมอยู่ใน dataset อื่นแล้ว → เพิ่ม membership ไม่ทำ master ซ้ำ
- `page_id` เดิมแต่ `page_name` เปลี่ยน → observation ใหม่ ไม่ทับชื่อเดิมทิ้ง
- `collation_count` เปลี่ยนระหว่างรอบ
- fingerprint row ถูก resolve เป็น ad_archive_id ในรอบถัดไป → **ต้อง merge ไม่ใช่สร้างใหม่**
- fingerprint ชนกัน (คนละ ad แต่ hash เท่ากัน)
- `start_date` parse ไม่ได้ → null แต่ต้องเก็บ `start_date_raw`
- วันที่เป็น พ.ศ. → ต้องแปลงถูก (มีเทสต์ครอบ)
- ไฟล์ใหญ่ 5,000+ records
- ปิดเบราว์เซอร์ระหว่าง import
- DB ตัดกลางคัน → rollback ทั้งก้อน

**Explorer / Drawer**
- ad ที่ไม่มี media เลย
- ad ที่ `is_active = null` → แสดง `—` ไม่ใช่ "inactive"
- `title` ว่าง (coverage ต่ำ)
- `link_url` null แต่ `raw_evidence.link_url` มี
- media URL หมดอายุ (Meta CDN) → fallback ไม่พังทั้งหน้า
- dataset ว่าง
- ad ที่มี observation เดียว (ไม่มีประวัติให้เทียบ)

---

## 8. Acceptance Criteria

1. import ไฟล์ Extension จริงได้ และตัวเลขใน preview ตรงกับ `quality_summary` ในไฟล์
2. import ไฟล์เดิมซ้ำ 2 ครั้ง → master count เท่าเดิม, observation เพิ่มเป็น 2 เท่า
3. **ฟิลด์ผี 15 ตัวไม่ปรากฏใน DB schema และไม่หลุดผ่าน normalizer** — มีเทสต์ยืนยัน
4. ad ที่ไม่มี `ad_archive_id` ยังนำเข้าได้ด้วย `record_key` แบบ fingerprint (**ขึ้นกับคำตัดสิน B**)
5. fingerprint row ที่ถูก resolve ภายหลัง → merge เข้า master เดิม ไม่เกิดแถวซ้ำ
6. `is_active = null` แสดงเป็น `—` ทุกที่ ไม่ถูกนับเป็น inactive
7. data quality strip แสดง coverage จริงต่อฟิลด์ ฟิลด์ < 50% มี warning
8. viewer แก้ข้อมูลไม่ได้ บังคับที่ RLS ไม่ใช่แค่ซ่อนปุ่ม
9. service-role key ไม่อยู่ใน client bundle (มีเทสต์ตรวจ bundle)
10. Drawer เปิดขวาโดยไม่เปลี่ยน URL หลัก และแสดงเฉพาะฟิลด์ที่มีจริง

## 9. Test Plan

**Unit** — normalizer, forbidden-field stripper, `parseDateText` (รวมเคส พ.ศ.), `mapCta` (ตรง/ไม่ตรงตาราง), `deriveDisplayFormat`, record_key builder, change detection, ad_age/evergreen/new-30d
**Integration** — import transaction, upsert vs append, re-import idempotency, fingerprint→ad promotion, RLS ต่อ role, rollback เมื่อล้มกลางคัน
**Fixtures** — export จริงจาก Extension อย่างน้อย 1 ไฟล์ + ไฟล์สังเคราะห์ครอบ edge cases (ใช้ `scripts/synthetic-check.js` ของ Extension เป็นฐานได้)
**E2E (Playwright)** — journey ข้อ 2 ตั้งแต่ login ถึง Drawer
**Security** — bundle ไม่มี secret, mutation ทุกเส้นทางตรวจ role ฝั่ง server

---

## 10. Conflicts ที่ต้องตัดสิน — บล็อกการไป `/ptg-spec`

CLAUDE.md: *"If sources conflict, stop and report the conflict instead of guessing"*

### A. เอกสารบอก network แต่โค้ดเป็น DOM scraping

Master Spec §2 เขียนว่า `"PT Glory Chrome Extension — network-response observation from Meta Ads Library"`
โค้ดจริงเขียนว่า `collection_method: 'user_initiated_dom_observation'` (`core.js:559`) และอ่านจาก `element.innerText` (`content-runner.js:221`)

**ต่างกันเชิงสาระ** — DOM scraping ให้เฉพาะสิ่งที่ผู้ใช้เลื่อนเห็นจริง (`completeness_claim: "Only records loaded and readable in the user session are included."`) แปลว่า **ทุก dataset เป็น sample ไม่ใช่ census** และห้ามพูดว่า "ตลาดนี้มี N โฆษณา"

→ **ยืนยันให้แก้ Master Spec §2 เป็น DOM observation ใช่ไหม**

### B. `unresolved_ads[]` — เอาเข้าระบบหรือทิ้ง

Extension แยก ad ที่อ่าน Library ID ไม่ได้ไว้ต่างหาก และ resolve ทีหลังได้

- **ตัวเลือก 1** — import ทั้งคู่ ใช้ `record_key` เป็น identity (fingerprint ได้) → ข้อมูลครบ แต่ schema ซับซ้อนขึ้น ต้องรองรับการเลื่อน key
- **ตัวเลือก 2** — Phase 1 import แค่ `ads[]` เก็บ `unresolved_count` ไว้ใน quality → ง่ายกว่า ตรงกับ CLAUDE.md ข้อ 12 แต่เสียข้อมูล

→ **เลือกข้อไหน**

### C. `page_like_count` ไม่มีใน Extension

KPI ที่คุยกันไว้ (median/top page likes) **ทำไม่ได้ใน Phase 1**

→ **ยืนยันตัดออกจาก Phase 1 ใช่ไหม** (เพิ่มกลับได้ถ้า Phase 2 ใช้ SocialAPIs)

### D. `first_seen_at` — ของ Extension หรือของ server

คำตัดสินข้อ 1 บอก "เวลาที่ PT Glory Collector พบครั้งแรก" ซึ่ง Extension ใส่มาให้แล้วจาก IndexedDB ของเครื่องผู้ใช้

แต่ถ้าคนละเครื่อง/ล้าง extension แล้ว export ใหม่ ค่าจะรีเซ็ต

- **ตัวเลือก 1** — เชื่อค่าจาก Extension (ตรงตามนิยาม แต่รีเซ็ตได้)
- **ตัวเลือก 2** — server เก็บ `first_seen_at` ของตัวเอง = ครั้งแรกที่ ad นี้เข้า DB (เสถียรกว่า) แล้วเก็บของ Extension เป็น `collector_first_seen_at`

→ **เลือกข้อไหน** — กระทบ KPI "Ads ใหม่ 30 วัน" โดยตรง

---

## 11. Recommended Next Step

**Large feature** — ยืนยันตามเดิม

ลำดับที่เหลือ: `/ptg-spec` → `/ptg-architecture` → `/ptg-tickets` แล้วหยุดรายงาน

**แต่ต้องได้คำตอบ A–D ก่อน** เพราะ B และ D เปลี่ยนโครงตาราง `ads` โดยตรง และ C ตัด KPI ออกหนึ่งตัว การเขียน spec/architecture/tickets บนโครงที่รู้อยู่แล้วว่าผิด จะทำให้ต้องรื้อทั้งชุด

**สิ่งที่ควรทำคู่กัน:** ขอ **export จริงจาก Extension 1 ไฟล์** (ยิ่งเป็นชุดที่ใช้งานจริงยิ่งดี) เพื่อวัด field coverage จริงของ Phase 1 แทนตัวเลขจาก Collector V2 ที่ใช้ไม่ได้แล้ว
