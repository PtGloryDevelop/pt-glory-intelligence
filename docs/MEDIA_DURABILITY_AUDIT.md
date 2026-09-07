# Media Durability Audit — C1.5

**สถานะ:** audit only · ไม่มี migration · ไม่มี Storage bucket · ไม่มี production implementation
**Audited commit:** `dab0faa` (หลัง C1)
**วันที่ตรวจ:** 2026-09-07
**หลักฐาน:** `tests/fixtures/golden-500.json` (export จริง 2026-08-28) + การยิงจริงไปที่ CDN
**เครื่องมือที่ทำซ้ำได้:** `scripts/measure-media.mjs`

---

## บทสรุปสำหรับผู้ตัดสินใจ

ไม่ใช่ความเสี่ยงในอนาคต — **มันพังไปแล้ว และมันจะพังทุกครั้งภายในไม่ถึงสัปดาห์หลังเก็บข้อมูล**

URL ของสื่อทุกตัวที่ collector เก็บมาเป็น **signed URL ที่พกวันหมดอายุมาในตัวเอง**
(พารามิเตอร์ `oe` เป็น unix timestamp ฐานสิบหก) วัดจาก export จริง:

| ตัววัด | ค่า |
| --- | --- |
| signed URL ทั้งหมดใน export | **3,799** |
| อายุใช้งานนับจากเวลา export — p10 / median / p90 | **104.4 / 105.9 / 107.6 ชั่วโมง** |
| หมดอายุแล้ว ณ วันตรวจ | **3,789 / 3,799 = 99.7%** |
| ผลการยิงจริง 15 URL คละชนิด | **403 ทั้ง 15 ตัว** (body 21 bytes, `text/plain`) |

**median TTL ≈ 4.4 วัน** หลังจากนั้น dataset ที่เก็บไว้จะไม่มีครีเอทีฟให้ดูอีกเลย
เหลือแต่ metadata

ข้อ 403 นี้ไม่ใช่ปัญหาเครือข่าย — DNS resolve ได้ TLS ผ่าน เซิร์ฟเวอร์ตอบกลับจริง
เป็นการปฏิเสธสิทธิ์ ไม่ใช่ transport failure

---

## 1. Media lifecycle ปัจจุบัน

```
Collector (Chrome Extension)
  → export JSON            ads[].images[] / videos[] / cards[]   ← มีแต่ URL
  → validate()             ตรวจ schema/forbidden key · ไม่แตะ media
  → normalize()            คัด allowlist · media ผ่านไปทั้งก้อนเป็น jsonb
  → commitImport()         transaction เดียว เขียน ad_observations.media
  → ad_observations.media  jsonb — เก็บ URL เท่านั้น
  → dataset_ads_page /     project media ออกมา pin ที่ collection_run_id
    ad_detail
  → mediaPresentation()    เลือก URL + กรอง scheme (C1)
  → <img> / <video>        เบราว์เซอร์ผู้ใช้ยิงตรงไปที่ fbcdn
```

**จุดที่เก็บแค่ URL:** `ad_observations.media` คือปลายทางเดียว และเก็บ JSON ดิบจาก
collector ตรง ๆ

**ไม่มี binary persistence ใด ๆ ในระบบตอนนี้** — ไม่มี Storage bucket ไม่มี blob column
ไม่มี proxy/cache ไม่มี worker ที่ดาวน์โหลดอะไรเลย เบราว์เซอร์ของผู้ใช้คือผู้ยิงคำขอ

### โครงสร้างที่พบจริง

| ชนิด | คีย์ที่มีจริง | จำนวน entry |
| --- | --- | --- |
| images | `original_image_url` · `resized_image_url` · `image_crops` | 1,491 |
| videos | `video_hd_url` · `video_sd_url` · `video_preview_image_url` | 261 |
| cards (carousel) | `title` `body` `link_url` `link_description` `cta_type` `cta_text` `video_hd_url` `video_sd_url` | 116 |

หมายเหตุจากหลักฐาน:

- `image_crops` เป็น array ว่างทั้ง **1,491/1,491 entry** — ไม่ใช่แหล่ง URL
  (C1 ข้ามฟิลด์นี้ถูกต้องแล้ว)
- `resized_image_url` เป็น rendition `stp=dst-jpg_s600x600_tt6` **เหมือนกันทั้ง 1,491 ตัว**
  → เป็น JPEG ขนาดคลาส 600×600 ที่ Meta เรนเดอร์ให้ เหมาะกับการ์ดโดยตรง
- `original_image_url` ไม่มี `stp` → เป็นไฟล์เต็มขนาด
- cards ใน export นี้ **ไม่มีคีย์รูปภาพของตัวเอง** มีแต่ฟิลด์วิดีโอ ซึ่ง 10 ad เป็น null ทั้งคู่
  (คือกรณี `unusable` ที่ C1 แยกออกมา)

---

## 2. Host inventory (จากหลักฐาน ไม่ใช่การเดา)

| host | จำนวน URL |
| --- | --- |
| `scontent.fphs2-1.fna.fbcdn.net` | **3,799 (100%)** |

**ข้อควรระวังที่สำคัญกว่าตัวเลข** — export ชุดเดียวนี้ให้ host เดียว เพราะ Meta เสิร์ฟจาก
edge ที่ผูกกับตำแหน่งของเครื่องที่เก็บข้อมูล (`fphs2` = edge ภูมิภาคหนึ่ง)
**ห้ามสร้าง allowlist จาก host เดียวนี้** เครื่องอื่น/เวลาอื่นจะได้ `scontent-*.xx.fbcdn.net`,
`video-*.xx.fbcdn.net` และรูปแบบอื่นอีกมาก

แนวทางที่ปลอดภัยกว่า: allowlist ที่ระดับ **domain suffix `.fbcdn.net`** บวกการยืนยัน
ว่า URL นั้นมาจากฟิลด์ media ที่รู้จักเท่านั้น แล้วเก็บ log ของ host ที่พบจริง
เพื่อยืนยันสมมติฐานนี้จาก export ชุดถัดไป

---

## 3. หลักฐานเรื่องการหมดอายุ

### 3.1 จาก URL เอง

ทุก URL มี `oe` = unix timestamp ฐานสิบหก ถอดออกมาได้ตรง ๆ:

| ฟิลด์ | n | TTL ต่ำสุด | median | สูงสุด |
| --- | --- | --- | --- | --- |
| `video_sd_url` | 259 | 32.0 ชม. | 106.0 ชม. | 108.0 ชม. |
| `video_hd_url` | 256 | 32.0 ชม. | 105.9 ชม. | 108.0 ชม. |
| `video_preview_image_url` | 261 | 104.0 ชม. | 105.8 ชม. | 108.0 ชม. |
| `resized_image_url` | 1,491 | 104.0 ชม. | 105.9 ชม. | 719.7 ชม. |
| `original_image_url` | 1,491 | 104.0 ชม. | 106.0 ชม. | 108.0 ชม. |

**99.7% หมดอายุภายใน 5 วันหลัง export** มีเพียง 10 URL (0.3%) ที่อายุยาวกว่า

### 3.2 จากการยิงจริง

สุ่ม 15 URL คละชนิด (4 resized, 3 original, 3 poster, 3 sd, 2 hd):

| ผลลัพธ์ | จำนวน |
| --- | --- |
| fetch succeeds | 0 |
| **expired/forbidden (HTTP 403)** | **15** |
| network failure | 0 |
| invalid URL | 0 |

จำแนกได้ชัดเจนตามที่โจทย์ขอ: ไม่ใช่ network failure และไม่ใช่ URL เสีย — เป็น
**การปฏิเสธสิทธิ์** ซึ่งตรงกับ `oe` ที่หมดไปแล้วประมาณ 6 วัน

### 3.3 ไม่มี fresh fixture ให้เทียบ

repo มี export ชุดเดียวคือ `golden-500.json` (2026-08-28) · ไฟล์ใน `e2e/.tmp` สร้างมาจาก
ชุดเดียวกันจึงมี URL เดิม **จึงเทียบ fresh vs historical ไม่ได้ในรอบนี้**

---

## 4. Storage POC

### 4.1 สิ่งที่วัดได้จริง — จำนวนสินทรัพย์

| ตัววัด | ค่า (500 ads) |
| --- | --- |
| ad ที่มีรูปอย่างน้อย 1 | 223 |
| ad ที่มีวิดีโออย่างน้อย 1 | 261 |
| ad ที่มี carousel card อย่างน้อย 1 | 17 |
| image entry | 1,491 |
| video entry | 261 |
| poster | 261 |
| **ad ที่มีสินทรัพย์เพียง 1 ชิ้น** | **395 / 500 (79%)** |
| ad ที่มีมากที่สุด | 81 ชิ้น |

จำนวนไฟล์ที่ต้องเก็บต่อ 500 ads:

| กลยุทธ์ | ไฟล์ | ต่อ ad |
| --- | --- | --- |
| **B — preview อย่างเดียว** (1 ต่อ ad) | **500** | 1.00 |
| **C — เก็บครบ** (1 rendition/รูป + วิดีโอ + poster) | **2,013** | 4.03 |

### 4.2 สิ่งที่วัดไม่ได้ — ขนาดไฟล์จริง

**ยิงได้ 0/15 (403 ทั้งหมด) จึงไม่มีตัวเลข byte จริงให้รายงาน**

ตามคำสั่ง "do not invent file-size assumptions if a fresh sample can provide them" —
ในรอบนี้ไม่มี fresh sample จึง **ไม่ตั้งตัวเลขขนาดไฟล์เป็นข้อเท็จจริง** แต่เสนอเป็น
สูตรที่มีตัวแปรเปิด พร้อมเครื่องมือที่รันซ้ำได้ทันทีที่มี export ใหม่:

```bash
node scripts/measure-media.mjs <fresh-export.json> 40
```

สคริปต์รายงาน median/p90/total ต่อชนิด และจำแนก 403 / network failure / invalid ให้เอง

### 4.3 การประมาณการ (ตัวคูณเป็น ASSUMPTION ที่ยังไม่ได้วัด)

จำนวนไฟล์คือของจริง · **ขนาดต่อไฟล์คือสมมติฐานล้วน ๆ รอการวัด**

**A. preview/poster อย่างเดียว — 1 ไฟล์ต่อ ad**

| ขนาดต่อไฟล์ (สมมติ) | 500 ads | 5,000 ads | 50,000 ads |
| --- | --- | --- | --- |
| 40 KB | 20 MB | 195 MB | 1.9 GB |
| 80 KB | 39 MB | 391 MB | 3.8 GB |
| 150 KB | 73 MB | 732 MB | 7.2 GB |

**B. เก็บครบรวมวิดีโอ — 4.03 ไฟล์ต่อ ad (รูป 2.98 · วิดีโอ 0.52 · poster 0.52)**

| สมมติฐาน | 500 ads | 5,000 ads | 50,000 ads |
| --- | --- | --- | --- |
| รูป 80 KB · วิดีโอ 2 MB · poster 40 KB | 0.63 GB | 6.3 GB | **63 GB** |
| รูป 80 KB · วิดีโอ 5 MB | 1.4 GB | 14 GB | **140 GB** |
| รูป 150 KB · วิดีโอ 10 MB | 2.8 GB | 28 GB | **277 GB** |

**สิ่งที่ตัวเลขนี้บอกได้แม้ยังไม่ได้วัด:** ค่าใช้จ่ายทั้งหมดถูกกำหนดโดยวิดีโอ
รูปภาพ/poster อยู่ในหลัก **GB หน่วยเดียว** แม้ที่ 50,000 ads ส่วนวิดีโอกระโดดไปหลัก
**สิบถึงร้อย GB** ข้อสรุปนี้ทนต่อความคลาดเคลื่อนของสมมติฐานได้ทุกช่วงที่ลองใส่

---

## 5. เปรียบเทียบสามกลยุทธ์

| หัวข้อ | A — Remote only (ปัจจุบัน) | B — Durable preview | C — Full archive |
| --- | --- | --- | --- |
| Storage | 0 | ต่ำ (หลัก GB) | สูง (หลักสิบ–ร้อย GB) |
| Bandwidth ขาเข้า | 0 | 1 ไฟล์/ad ครั้งเดียว | ทุกไฟล์ ครั้งเดียว |
| Bandwidth ขาออก | 0 (ผู้ใช้ยิงตรง) | เสิร์ฟเอง | เสิร์ฟเอง รวมวิดีโอ |
| ความซับซ้อนของ import | ไม่มี | worker หลัง commit | worker + คิว + retry |
| Failure handling | ไม่มีอะไรให้พลาด | พลาดได้ ต้องบันทึกสถานะ | พลาดได้บ่อยกว่า ไฟล์ใหญ่ |
| Security | ไม่มี SSRF (client ยิง) | มี SSRF ต้องกัน | มี SSRF + ไฟล์ใหญ่ |
| **ความคงทนของประวัติ** | **≈4.4 วัน** | ถาวร (ภาพนิ่ง) | ถาวร (รวมเล่นวิดีโอ) |
| ค่าดำเนินการ | 0 | ต่ำ | ต้องดูแลจริงจัง |
| **โหมดพังในอดีต** | **dataset เก่าไม่มีครีเอทีฟให้ดูเลย** | เล่นวิดีโอย้อนหลังไม่ได้ | — |

**A พังอย่างไรจริง ๆ:** ทุกอย่างที่ Phase 2 วางไว้ — Competitor Timeline,
Creative Intelligence, Watchlist, evidence review, การเทียบระยะยาว — ตั้งอยู่บนสมมติฐานว่า
"เปิด dataset เก่าแล้วเห็นครีเอทีฟ" ซึ่งเป็นเท็จหลังผ่านไป ~4.4 วัน

---

## 6. สถาปัตยกรรมที่แนะนำ (แนวคิด ยังไม่อนุมัติ schema)

**หลักการที่ห้ามละเมิด:** `ad_observations.media` คือความจริงจากต้นทาง **ห้ามแก้ไข
เพื่อสลับ URL เป็น path ของเราเอง** ชั้นเก็บถาวรต้องเป็นชั้นแยก

```
ad_observations.media          (source truth — ไม่แตะ)
        ↓  อ้างอิง
media archival worker          (นอก transaction)
        ↓  เขียน
durable media asset            (ตารางใหม่ + object storage)
        ↓  อ่าน
presentation resolver          (ต่อยอดจาก mediaPresentation ของ C1)
```

`mediaPresentation()` จาก C1 คือจุดต่อที่เตรียมไว้พอดี: resolver จะเลือก
"ไฟล์ที่เก็บถาวรถ้ามี ไม่งั้นค่อยใช้ URL ต้นทาง" โดย consumer ทั้งหมดไม่ต้องรู้เรื่อง

แนวคิดฟิลด์ที่ *อาจ* ต้องใช้ในอนาคต (ยังไม่สร้างในรอบนี้): `media_asset` ·
observation linkage · `source_url` · `archive_path` · `media_kind` · `mime_type` ·
`byte_size` · `checksum` · `archive_status` · `archived_at` · `failure_reason`

---

## 7. ขอบเขต transaction ของ import

**ห้ามดาวน์โหลดสื่อภายใน transaction ที่มีอยู่** — transaction นั้นคือสิ่งที่รับประกัน
ความถูกต้องของ canonical import (invariant I5) การเอา network I/O ที่ช้าและล้มเหลวได้
เข้าไปอยู่ในนั้นแปลว่า CDN ล่ม = import ทั้งก้อน rollback ทั้งที่ข้อมูลถูกต้องครบ

flow ที่เสนอ:

```
1. import transaction          (เหมือนเดิมทุกประการ) → commit
2. dataset ใช้งานได้ทันที        ← ผู้ใช้ไม่ต้องรอสื่อ
3. archival stage แยกต่างหาก     อ่าน observation ที่เพิ่ง commit
4. เขียนสถานะราย asset          pending → archived / failed(reason)
5. resolver เลือกไฟล์ถาวรถ้ามี   ไม่มีก็ใช้ URL ต้นทางไปก่อน
```

**คุณสมบัติที่ต้องเป็นจริง:** สื่อดาวน์โหลดไม่สำเร็จ **ต้องไม่** ทำให้ dataset ที่ถูกต้อง
เสียหายหรือ rollback · สถานะ archive เป็นข้อมูลของตัวเอง ไม่ใช่เงื่อนไขความสำเร็จของ import ·
ต้อง retry ได้โดยไม่ต้อง import ใหม่

**ข้อจำกัดด้านเวลาที่ต้องรู้ล่วงหน้า:** median TTL 4.4 ชม.×24 = ~106 ชม. เท่านั้น
งาน archival ต้องทำงานภายในไม่กี่ชั่วโมงหลัง import ไม่ใช่ batch รายสัปดาห์
ถ้าคิวค้างเกิน ~4 วัน ก็เก็บอะไรไม่ได้เลย

---

## 8. SSRF และความปลอดภัยของ URL

การให้เซิร์ฟเวอร์ยิง URL จากไฟล์ที่ผู้ใช้อัปโหลดคือ SSRF โดยนิยาม ต้องออกแบบก่อนเขียนโค้ด

| ข้อกำหนด | รายละเอียด |
| --- | --- |
| Scheme | `https:` เท่านั้น (ปัจจุบัน C1 ยอม http ด้วยสำหรับการแสดงผล ชั้น fetch ควรเข้มกว่า) |
| Host allowlist | suffix `.fbcdn.net` — **ห้าม** derive จาก host เดียวที่พบ · log host จริงเพื่อยืนยัน |
| แหล่งที่มาของ URL | **เฉพาะฟิลด์ media ที่รู้จัก** (`original_image_url`, `resized_image_url`, `video_hd_url`, `video_sd_url`, `video_preview_image_url`) · **`link_url` / `link_description` ห้ามเข้าเส้นทางนี้เด็ดขาด** — เป็น URL ปลายทางที่ผู้ลงโฆษณาควบคุม |
| DNS / private IP | resolve เองแล้วปฏิเสธ RFC1918, loopback, link-local, IPv6 ULA, `.internal` · ตรวจ**หลัง** resolve เพื่อกัน DNS rebinding |
| Redirect | ปฏิเสธ redirect ทั้งหมด หรือจำกัด ≤1 และตรวจ host ปลายทางซ้ำ |
| Timeout | ต่อคำขอ เช่น 20 วินาที |
| Size cap | ปฏิเสธเมื่อเกินเพดาน ทั้งจาก `content-length` และระหว่างสตรีม (header โกหกได้) |
| MIME | ยอมเฉพาะ `image/*` และ `video/*` ที่กำหนด · ตรวจ magic bytes ไม่ใช่เชื่อ header |
| Decompression | ห้าม auto-decompress แบบไม่จำกัด — กัน zip bomb |
| Response ที่ไม่ใช่สื่อ | HTML/JS/ไฟล์รันได้ = ปฏิเสธและบันทึก `failure_reason` |
| Rate | จำกัด concurrency ต่อ host เพื่อไม่ให้ถูกมองว่าเป็นการโจมตี |

---

## 9. Deduplication

วัดจากหลักฐาน (เทียบ pathname ของ URL ซึ่งมี content id ของ Meta):

| ชนิด | entry | path ไม่ซ้ำ | ประหยัดได้ |
| --- | --- | --- | --- |
| images | 1,491 | 1,484 | **0.5%** |
| videos | 259 | 243 | **6.2%** |
| posters | 261 | 253 | **3.1%** |

- สินทรัพย์ที่ ad มากกว่าหนึ่งตัวใช้ร่วมกัน: **15 ชิ้น** · มากสุด 4 ad ใช้ร่วมกัน 1 ชิ้น
- ad ที่มี `collation_count > 1`: **170** — แต่แชร์ไฟล์กันจริงแค่ 15
  **ยืนยันว่า `collation_count` ไม่ได้แปลว่าไฟล์เหมือนกัน** ตามที่เตือนไว้

**ข้อเสนอแนะ:** ยังไม่คุ้มที่จะทำ dedup ในเฟสแรก ประหยัดได้ 0.5–6% แลกกับความซับซ้อน
ของ checksum + reference counting ไม่คุ้ม

ถ้าจะทำในอนาคต ให้ใช้ **content checksum (SHA-256 ของ byte)** ไม่ใช่ URL identity —
CDN เปลี่ยน path/พารามิเตอร์ได้โดยที่ byte เหมือนเดิม และ URL ที่ต่างกันอาจชี้ไฟล์เดียวกัน
เก็บ checksum ตั้งแต่เฟสแรกได้ (ราคาถูกมาก) แล้วค่อยเปิดใช้ dedup ทีหลังโดยไม่ต้อง
ดาวน์โหลดซ้ำ

---

## 10. ผลกระทบต่อ snapshot semantics

**กฎที่ห้ามละเมิด:** dataset เก่า → observation ของรอบนั้น → สื่อที่เป็นของ observation นั้น

การเก็บถาวรต้องผูกกับ **observation** (ซึ่งผูกกับ `collection_run_id` อยู่แล้ว)
ไม่ใช่ผูกกับ `ad_archive_id` ถ้าผูกกับ ad การ import รอบใหม่จะทับสื่อของ dataset เก่า —
คือ invariant I1 พังโดยผ่านทางสื่อแทนที่จะผ่านทาง observation

ถ้าใช้ dedup ด้วย checksum ในอนาคต: byte ใช้ร่วมกันได้ แต่ **linkage ต้องยังเป็นราย
observation** เสมอ — observation A ชี้ไป blob X และ observation B ก็ชี้ไป blob X ได้
แต่ห้ามให้ observation A ถูกเปลี่ยนให้ชี้ blob ใหม่เพราะ B มาทีหลัง

การอ่านผ่าน `dataset_ads_page` / `ad_detail` ยังต้อง pin ที่ `collection_run_id` เหมือนเดิม
ไม่มีข้อยกเว้นให้สื่อ

---

## 11. กฎการเลือกสื่อในอนาคต (บันทึกไว้ ยังไม่แก้)

C1 เลือก **รูปก่อนวิดีโอ** เพื่อให้การ์ดได้ภาพนิ่งที่โหลดเบา
**ยังไม่เปลี่ยนในรอบนี้** แต่บันทึกไว้ว่ากฎที่ถูกต้องต้องอิง `display_format`:

| `display_format` | ตัวแทนที่ควรเป็น |
| --- | --- |
| `VIDEO` | เป็นวิดีโอ · แสดง poster เป็นภาพนำ · playback จาก video source |
| `IMAGE` / `MULTI_IMAGES` | รูป |
| carousel / `DCO` | การ์ดใบแรกแบบ deterministic |

**ประเด็นสำคัญ:** การมี poster อยู่ **ต้องไม่** ทำให้โฆษณาวิดีโอถูกนำเสนอว่าเป็นโฆษณารูปภาพ
ตอนนี้ `mediaPresentation()` คืน `kind` ตามไฟล์ที่เลือกได้ ไม่ได้ดู `display_format`
ซึ่งเป็นความจริงคนละชั้นกัน — ควรรวมเข้าด้วยกันในงานถัดไป (จัดเป็น C2/V23-16 ได้)

---

## 12. เฟสการทำงานที่เสนอ (ยังไม่อนุมัติ)

| เฟส | เนื้อหา | ผลลัพธ์ |
| --- | --- | --- |
| **0** | รัน `scripts/measure-media.mjs` กับ export สดหนึ่งชุด | ได้ขนาดไฟล์จริง แทนสมมติฐานใน §4.3 |
| **1** | ตาราง `media_asset` + object storage + resolver ที่ fallback ไป URL ต้นทาง | โครงมี ยังไม่มีของ |
| **2** | archival worker นอก transaction + สถานะ + retry | preview ถูกเก็บถาวร |
| **3** | ชั้นป้องกัน SSRF ครบตาม §8 + ทดสอบด้วย URL ที่เป็นอันตราย | เปิดใช้ในโปรดักชันได้ |
| **4** | backfill dataset เดิม *เท่าที่ยังไม่หมดอายุ* | ยอมรับว่าของเก่ากู้ไม่ได้ |
| **5** | (ทางเลือก) เก็บวิดีโอเต็ม + checksum dedup | playback ย้อนหลัง |

**เรื่องที่ต้องพูดตรง ๆ:** dataset ที่มีอยู่ตอนนี้ **กู้ครีเอทีฟกลับมาไม่ได้แล้ว** 99.7%
ของ URL ตายไปแล้ว การเก็บถาวรช่วยได้เฉพาะ **การเก็บข้อมูลครั้งต่อ ๆ ไป**

---

## คำแนะนำสุดท้าย

# → HYBRID (ทำ DURABLE PREVIEW ก่อน แล้วเปิดทาง FULL ARCHIVE)

**เฟสแรกคือ Strategy B** — เก็บภาพนิ่งหนึ่งภาพต่อ observation ถาวร
(รูป → `resized_image_url` · วิดีโอ → `video_preview_image_url`) และ **เก็บ URL ต้นทางไว้
เป็น provenance ไม่ลบ**

เหตุผล:

1. **Remote-only เป็นทางเลือกที่ตายแล้ว** ไม่ใช่ความเสี่ยง — 99.7% ตายภายใน 5 วัน
   ทุกฟีเจอร์ Phase 2 ที่วางไว้ตั้งอยู่บนครีเอทีฟที่ยังดูได้
2. **ค่าใช้จ่ายอยู่ที่วิดีโอ ไม่ใช่การเก็บถาวร** ภาพนิ่งทั้งหมดที่ 50,000 ads อยู่ในหลัก
   **GB หน่วยเดียว** ส่วนวิดีโอเต็มอยู่ที่ **63–277 GB** ข้อสรุปนี้ไม่เปลี่ยนไม่ว่าจะใส่
   สมมติฐานขนาดไฟล์ค่าไหน
3. **สิ่งที่งานวิจัยต้องการคือ "เห็นครีเอทีฟ"** ไม่ใช่ "เล่นวิดีโอได้" — timeline,
   creative intelligence, evidence review, การเทียบคู่แข่ง ทำงานได้ด้วยภาพนิ่ง
4. **B ได้ความคงทน ~100% ด้วยต้นทุนไม่ถึง 5%** ของ C (500 ไฟล์เทียบกับ 2,013 และ
   ไม่มีวิดีโอซึ่งเป็นตัวกินพื้นที่)
5. **ทางไป C ยังเปิดอยู่** เพราะเก็บ `source_url` และ `checksum` ตั้งแต่แรก
   จะเพิ่ม video archive ทีหลังโดยไม่ต้อง migrate อะไรที่เจ็บ

**สิ่งที่ยอมแลก และควรพูดให้ชัด:** การเล่นวิดีโอย้อนหลังจะไม่มีในเฟสแรก
dataset ที่เกิน ~4 วันจะมี poster ให้ดูแต่กดเล่นไม่ได้ ถ้าการดูวิดีโอย้อนหลังคือ
requirement จริงของ Phase 2 ต้องข้ามไป C ตั้งแต่ต้น และรับต้นทุน 63–277 GB

**เงื่อนไขก่อนเริ่มเขียนโค้ด:** รันเฟส 0 กับ export สดก่อน ตัวเลขใน §4.3 ยังเป็น
สมมติฐาน ไม่ใช่การวัด
