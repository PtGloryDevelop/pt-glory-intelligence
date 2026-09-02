# T09 — Transaction Design Note

วันที่: 1 กันยายน 2569 · เขียนก่อน implement ตามที่ Gate C กำหนด
Frozen baseline: `10bc89a` (collector contract)

---

## Invariants ที่ T09 ต้องรักษา

| | |
|---|---|
| **I1** | Dataset read ผูกกับ `dataset.collection_run_id` |
| **I2** | run เก่าต่อ observation ได้ · ดัน `first_seen_at` ย้อนหลังได้ · **ห้ามทับ current state ที่ใหม่กว่า** |
| **I3** | `computed_*` คือค่าจริงของระบบ · `reported_*` เป็น provenance |
| **I4** | อ่าน ad ในบริบท dataset ต้องเป็นสมาชิก `dataset_ads` |
| **I5** | import ทั้งก้อน commit หรือไม่เขียนอะไรเลย |

T09 รับผิดชอบ I2 I3 I5 โดยตรง · I1 I4 เป็นเรื่องของ T15/T16 แต่ schema ที่ T09 เขียนต้องรองรับ

---

## Transaction boundary

```
requireRole('analyst')          ← ก่อน BEGIN เสมอ · ยังไม่แตะ DB
        ↓
pool.connect()                  ← client เดียว
BEGIN
  1  collection_runs            insert
  2  datasets                   insert
  3  pages                      upsert (monotonic)
  4  page_observations          insert
  5  ads                        upsert (monotonic)
  6  ad_observations            insert
  7  dataset_ads                insert
  8  dataset_quality            insert
  9  import_quarantine          insert
 10  audit_logs                 insert
COMMIT / ROLLBACK
client.release()                ← finally
```

**ห้าม `pool.query()` แยกกัน** — pool แจก connection คนละตัวได้ ทำให้ `BEGIN` อยู่คนละ session กับ statement และ `ROLLBACK` ไม่มีผล

authorization อยู่นอก transaction เพราะ connection นี้ **bypass RLS** ถ้าตรวจสิทธิ์ทีหลังจะเปิด connection ให้คนที่ไม่มีสิทธิ์ไปแล้ว

---

## Master ad semantics

```sql
insert into ads (...) values (...)
on conflict (ad_archive_id) do update set
  first_seen_at = LEAST   (ads.first_seen_at, excluded.first_seen_at),
  last_seen_at  = GREATEST(ads.last_seen_at,  excluded.last_seen_at),

  page_ref           = case when excluded.last_seen_at >= ads.last_seen_at
                            then excluded.page_ref           else ads.page_ref           end,
  collation_id       = case when excluded.last_seen_at >= ads.last_seen_at
                            then excluded.collation_id       else ads.collation_id       end,
  is_active          = case when excluded.last_seen_at >= ads.last_seen_at
                            then excluded.is_active          else ads.is_active          end,
  display_format     = case when excluded.last_seen_at >= ads.last_seen_at
                            then excluded.display_format     else ads.display_format     end,
  publisher_platform = case when excluded.last_seen_at >= ads.last_seen_at
                            then excluded.publisher_platform else ads.publisher_platform end,
  start_date  = case when excluded.last_seen_at >= ads.last_seen_at
                     then excluded.start_date  else ads.start_date  end,
  end_date    = case when excluded.last_seen_at >= ads.last_seen_at
                     then excluded.end_date    else ads.end_date    end,
  updated_at  = now()
```

ใน `do update` ฝั่ง `ads.*` คือค่า**ก่อน**อัปเดต จึงใช้เป็น guard ได้ · `excluded.last_seen_at` = `run.collected_at` ของไฟล์ที่กำลัง import

### null ของ current-state = UNKNOWN ต้องเก็บไว้

ถ้า observation ล่าสุดอ่าน `is_active` ไม่ได้ ค่าที่ถูกต้องคือ **null** ไม่ใช่ค่าเก่าจากรอบก่อน

การ `coalesce(excluded.is_active, ads.is_active)` จะเอาความจริงของอดีตมาสวมเป็นความจริงปัจจุบัน ซึ่งเป็นการโกหก — จึงใช้ `case when` ล้วน **ไม่มี coalesce** สำหรับ current-state ของ ad

---

## Master page semantics — ตั้งใจให้ต่างจาก ad

`pages.last_seen_at` เป็น guard เดียวกัน แต่ **identity metadata ใช้ latest non-null**

```sql
insert into pages (...) values (...)
on conflict (page_id) do update set
  last_seen_at = GREATEST(pages.last_seen_at, excluded.last_seen_at),

  page_profile_uri =
    case when excluded.last_seen_at >= pages.last_seen_at
         then coalesce(excluded.page_profile_uri, pages.page_profile_uri)
         else coalesce(pages.page_profile_uri, excluded.page_profile_uri) end,
  page_profile_numeric_id =
    case when excluded.last_seen_at >= pages.last_seen_at
         then coalesce(excluded.page_profile_numeric_id, pages.page_profile_numeric_id)
         else coalesce(pages.page_profile_numeric_id, excluded.page_profile_numeric_id) end,
  updated_at = now()
```

**ทำไมไม่เหมือน ad:**
`page_profile_numeric_id` มีแค่ 44% ของแถวในไฟล์จริง การที่รอบใหม่ไม่ส่งมาแปลว่า **ไม่ได้สังเกต** ไม่ใช่ว่าตัวตนหายไป ถ้าใช้ `case when` ล้วนแบบ ad ข้อมูลที่เคยรู้จะถูกลบทิ้งเพราะรอบใหม่บังเอิญไม่มี

กติกา: **ค่า non-null ล่าสุดชนะ · รอบเก่าเติมช่องว่างที่ยังว่างได้**

`is_active` ของ ad ต่างกันตรงที่มันคือ *สถานะ* ที่เปลี่ยนได้จริง ส่วน profile id คือ *ตัวตน* ที่ไม่หายไปเอง

### ค่าที่เปลี่ยนของเพจอยู่ใน observation ไม่ใช่ master

`page_name` `page_like_count` `page_categories` อยู่ใน `page_observations` เท่านั้น — ไม่ถือเป็น identity และ dataset snapshot อ่านจาก observation ของ run นั้น (I1)

---

## กติกาเมื่อ `collected_at` เท่ากัน

`>=` แปลว่า **incoming ชนะเมื่อเสมอ** ผลลัพธ์สุดท้ายจึงขึ้นกับลำดับ import เฉพาะกรณี timestamp เท่ากันเป๊ะเท่านั้น ซึ่งเป็นข้อยกเว้นที่ยอมรับไว้แล้ว

---

## Duplicate ภายใน input เดียว

`unique (collection_run_id, ad_ref)` ทำให้ ad เดียวมี observation ได้แถวเดียวต่อ run

ถ้า normalized input มี `ad_archive_id` ซ้ำ (collector dedupe พลาด) การ insert รอบสองจะชน constraint แล้วทั้ง transaction ตาย

**แก้ที่ชั้น import ไม่ใช่ที่ normalizer** เพราะ normalizer ถูก freeze ไปแล้วที่ Gate B และการ dedupe เป็นความรับผิดชอบของขั้นเขียน ไม่ใช่ขั้นแปลง

- `ads` / `ad_observations` — dedupe ตาม `ad_archive_id` **เก็บรายการสุดท้าย** (ถือว่าอยู่หลังในไฟล์ = ใหม่กว่า)
- `pages` / `page_observations` — dedupe ตาม `page_id` แบบเดียวกัน
- `dataset_ads` — dedupe ตาม `(dataset_id, ad_ref)`

---

## Rollback proof

`ROLLBACK` อย่างเดียวไม่พอเป็นหลักฐาน ต้องนับแถวจริง

ทุกเทสต์ที่บังคับให้ล้ม จะ:
1. นับแถวทั้ง 10 ตารางก่อน import
2. เรียก commit ที่ถูกฉีดให้ล้มที่ step ที่กำหนด
3. นับใหม่ **ต้องเท่าเดิมทุกตาราง**

จุดฉีดความล้มเหลว: **หลัง ads upsert** (B) และ **ที่ step สุดท้ายก่อน COMMIT** (C)

---

## สิ่งที่ T09 ไม่ทำ

ไม่มี HTTP route (T13) · ไม่มี preview endpoint (T13) · ไม่มี background job · ไม่แตะ normalizer/validator ที่ freeze แล้ว

---

## ความเสี่ยงที่รู้ตัว

**pooler DNS/network ไม่เสถียร** — เจอมาตั้งแต่ Gate A

จะ **ไม่ใส่ retry ใน application logic** ตามที่กำหนด · แยกความล้มเหลวสองแบบให้ชัด:
- connection error (`ENOTFOUND` `ETIMEDOUT`) = ปัญหา infrastructure → รายงานแยก ไม่นับเป็นผลทดสอบ
- assertion error = ปัญหาโค้ด → ต้องแก้

รายงาน Gate C จะมาจากรันที่สะอาดครบรอบเดียวเท่านั้น
