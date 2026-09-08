# Media Archive — Operations

คู่มือปฏิบัติการของระบบเก็บภาพตัวอย่างถาวร (durable preview archive)
· C1.7 สร้างท่อ · C1.8 ทำให้มันเดินเองโดยไม่ต้องมีคนกด

**หลักการเดียวที่ต้องจำ:** URL ของสื่อจาก collector มีอายุประมาณ **105 ชั่วโมง**
ถ้าไม่มีอะไรดึงมาเก็บภายในหน้าต่างนั้น ครีเอทีฟจะหายถาวร กู้ไม่ได้


> ## ⚠️ สถานะจริงของ DEV ตอนนี้ (2026-09-08)
>
> **ตารางเวลาถูกปิดอยู่ · ยังไม่มี deployment ที่เข้าถึงได้จากภายนอก**
>
> โปรเจกต์นี้ยังไม่มี URL HTTPS สาธารณะ — ไม่มี git remote, ไม่มี config ของ
> Vercel/Netlify/Docker, ไม่มีตัวแปร base URL ใน env — Supabase Cloud จึงยิงเข้ามา
> ที่แอปไม่ได้
>
> ระหว่าง 2026-09-07 10:20 ถึง 2026-09-08 02:20 job ทำงานไป **109 ครั้ง** และ pg_net
> ล้มเหลวทุกครั้งด้วย `Couldn't connect to server` เพราะ Vault ชี้ไปที่ `127.0.0.1:3000`
>
> จึงจัดการดังนี้ใน C1.9:
>
> - `cron.unschedule('media-archive-drain')` — หยุด noise ทุก 10 นาที
> - ลบ secret `media_archive_url` และ `media_archive_token` ออกจาก Vault
> - **migration 0025 ไม่ถูกแตะ** · ฟังก์ชัน `run_media_archive_drain()` ยังอยู่ครบ
>   และยัง inert อยู่แล้วเมื่อไม่มี config
>
> **ผลคือ: การเก็บภาพตัวอย่างใน DEV ต้องสั่งเองตามข้อ 6** จนกว่าจะมี deployment จริง
>
> ### เปิดใช้อีกครั้งเมื่อมี URL จริง
>
> ```bash
> # 1. ตั้ง MEDIA_ARCHIVE_TOKEN ใน env ของแอปที่ deploy แล้ว (แอปก่อน)
> # 2. ใส่ค่าลง Vault (Vault ทีหลัง)
> MEDIA_ARCHIVE_URL=https://<แอปจริง> MEDIA_ARCHIVE_TOKEN=<ค่าเดียวกัน> \
>   node --env-file-if-exists=.env.local scripts/archive-schedule-config.mjs
>
> # 3. เปิดตารางเวลาใหม่
> psql "$DATABASE_URL" -c "select cron.schedule('media-archive-drain','*/10 * * * *', \$\$select public.run_media_archive_drain()\$\$)"
> ```
>
> จากนั้นตรวจว่า `net._http_response` ได้ `status_code = 200` จริง ไม่ใช่ error

---

## 1. อะไรเป็นตัวสั่งให้ทำงาน

```
pg_cron  (ในฐานข้อมูล Supabase)
   │  ทุก 10 นาที
   ▼
public.run_media_archive_drain()      SECURITY DEFINER · revoke จากทุก role ของแอป
   │  อ่าน media_archive_url + media_archive_token จาก Vault
   ▼
pg_net  net.http_post
   │  POST <url>/api/media/archive/run   ·  Authorization: Bearer <token>
   ▼
Next.js route  →  drainArchiveQueue()  →  fbcdn  →  private bucket  →  media_assets
```

**ทำไมเลือกแบบนี้** — คิวอยู่ใน Postgres อยู่แล้ว และ Supabase มี pg_cron/pg_net/Vault
พร้อมใช้ในโปรเจกต์นี้ จึงไม่ต้องเพิ่มผู้ให้บริการใหม่ ไม่ต้องพึ่ง cron ของแพลตฟอร์ม
โฮสต์ และไม่ผูกกับแพ็กเกจของผู้ให้บริการโฮสต์ ถ้าย้ายที่รันแอป ตารางเวลาย้ายตามข้อมูลไปเอง

pg_cron รัน Node ไม่ได้ และงานนี้ต้องยิง HTTP ออกไป CDN กับเขียน object storage
หน้าที่ของ cron จึงมีอย่างเดียวคือ **เขี่ยแอปผ่าน HTTP**

---

## 2. ค่าที่ตั้งไว้

| รายการ | ค่า | ตั้งที่ไหน |
| --- | --- | --- |
| Cadence | `*/10 * * * *` (ทุก 10 นาที) | `cron.job` ชื่อ `media-archive-drain` |
| Batch ต่อรอบ | **200** (endpoint จำกัดสูงสุด 500) | body ของ cron job |
| Concurrency | **1** | `drainArchiveQueue` วนทีละแถว |
| Lease | **300 วินาที** | `LEASE_SECONDS` |
| Max attempts | **3** | `MAX_ATTEMPTS` |
| HTTP timeout (ฝั่ง pg_net) | 120 วินาที | migration 0025 |
| Fetch timeout (ต่อไฟล์) | 20 วินาที | `FETCH_TIMEOUT_MS` |
| Preview size cap | 8 MB | `MAX_PREVIEW_BYTES` |

**ทำไม 10 นาที** — หน้าต่างที่กำลังแข่งด้วยคืออายุ signed URL ที่วัดได้ median ~105 ชม.
และสั้นสุดที่เคยเจอในไฟล์สดคือ **28 ชม.** ดังนั้นรายวันไม่พอ ส่วน 10 นาทีเหลือเฟือ

**ทำไม concurrency 1** — 611 ภาพใช้เวลา ~200 วินาที ซึ่งพอดีกับ batch 200 ต่อรอบ
และไม่ต้องไปเร่ง CDN ของคนอื่น ถ้าจะเพิ่มควรเพิ่มทีละน้อยและวัดผลจริงก่อน

---

## 3. Lease — สิ่งที่กันไม่ให้ทำงานซ้ำ

transaction ที่จองงาน **commit ก่อน** ที่จะเริ่มดาวน์โหลด ล็อกจึงหลุดตั้งแต่ตอนนั้น
ถ้าไม่มี lease รอบถัดไปที่เริ่มทับกันจะจองแถวเดิมแล้วโหลดซ้ำ

`last_attempt_at` ทำหน้าที่เป็น lease: แถว `pending` ที่ถูกแตะภายใน 5 นาทีถือว่ามีคนทำอยู่
ส่วนแถว `failed` ไม่ติด lease เพราะมันไม่ได้กำลังทำงาน — รอบถัดไป retry ได้ทันที

ผลพลอยได้ที่สำคัญ: process ที่ตายกลางคัน **ปล่อยงานคืนเองเมื่อ lease หมด**
ไม่ต้องมีขั้นตอน cleanup

---

## 4. สถานะและกฎการ retry

| สถานะ | ความหมาย | ถูกหยิบมาทำอีกไหม |
| --- | --- | --- |
| `pending` | มี candidate รอเก็บ | ใช่ (ถ้าไม่ติด lease) |
| `archived` | ไฟล์อยู่ใน bucket แล้ว | ไม่ |
| `none` | observation ไม่มี media entry เลยจริง ๆ | ไม่ |
| `unusable` | มี entry แต่นโยบายหา still ที่ใช้ได้ไม่ได้ | ไม่ |
| `failed` + `failure_retryable = true` | ล้มเหลวชั่วคราว | ใช่ จนกว่า `attempt_count` ถึง 3 |
| `failed` + `failure_retryable = false` | ล้มเหลวถาวร | **ไม่มีวัน** |

**Terminal** — `source_expired` · `http_403` · `host_rejected` · `scheme_rejected` ·
`dns_rejected` · `redirect_rejected` · `mime_rejected` · `magic_rejected` · `too_large`

**Retryable** — `timeout` · `http_error` · `empty_response` · `unknown_fetch_failure` ·
`storage_upload_failed`

จำแนกตอนที่ล้มเหลวและ **บันทึกลงคอลัมน์** ไม่ได้เดาใหม่จากสตริงทีหลัง
`http_403` บน signed URL คือลายเซ็นหมดอายุ จึงเป็น terminal — ไม่ลองซ้ำไปเรื่อย ๆ

---

## 5. ดูสุขภาพคิว

**ผ่าน API** (ต้องเป็น analyst ขึ้นไป):

```bash
curl -s http://localhost:3000/api/media/archive --cookie "<session>"
```

**ผ่าน CLI:**

```bash
node --env-file-if-exists=.env.local --conditions=react-server \
  --experimental-strip-types scripts/archive-health.mjs
```

ค่าที่คืนมา:

| ฟิลด์ | อ่านยังไง |
| --- | --- |
| `pending` | รอเก็บอยู่ |
| `archived` | เก็บสำเร็จแล้ว |
| `none` / `unusable` | ไม่มีอะไรให้ทำ (จบแล้ว ไม่ใช่ปัญหา) |
| `failedRetryable` | ยังลองใหม่ได้ |
| `failedTerminal` | จบแล้ว กู้ไม่ได้ |
| `oldestPendingAgeMinutes` | งานเก่าสุดค้างมากี่นาที |
| `earliestExpiry` | **เส้นตายที่ใกล้ที่สุด** |
| `expiringWithin24h` | **ตัวเลขที่ต้องดูจริง ๆ** |
| `lastAttemptAt` | รอบล่าสุดที่มีการพยายาม |

**สัญญาณว่า scheduler ตาย:** `lastAttemptAt` เก่ากว่า ~15 นาที ขณะที่ `pending > 0`
· หรือ `expiringWithin24h > 0` แล้วไม่ลดลง

ตรวจตัวตารางเวลาเองได้ที่:

```sql
select jobname, schedule, active from cron.job where jobname = 'media-archive-drain';
select status, start_time, return_message from cron.job_run_details
 order by start_time desc limit 10;
```

---

## 6. กู้คืนด้วยมือ

endpoint เดิมยังอยู่ในฐานะ **เครื่องมือซ่อม ไม่ใช่หลักประกัน**:

```bash
# analyst/admin session — ใช้ตอน dev หรือเร่งงานหลัง import
curl -X POST "http://localhost:3000/api/media/archive?limit=200" --cookie "<session>"

# เฉพาะ run เดียว
curl -X POST "http://localhost:3000/api/media/archive?collectionRunId=<uuid>&limit=200" \
  --cookie "<session>"
```

รันซ้ำได้เสมอ ปลอดภัย ไม่สร้างแถวซ้ำ ไม่เขียน object ซ้ำซ้อน

---

## 7. ความลับที่ต้องตั้ง

| ชื่อ | อยู่ที่ | ใครใช้ |
| --- | --- | --- |
| `MEDIA_ARCHIVE_TOKEN` | env ของแอป (server-only) | ฝั่งตรวจสอบ |
| `media_archive_token` | Supabase Vault | ฝั่งส่ง (pg_net) |
| `media_archive_url` | Supabase Vault | base URL ของแอป |

สองตัวแรกต้องตรงกัน · ไม่มีคำนำหน้า `NEXT_PUBLIC_` จึงเข้า client bundle ไม่ได้
· มีเทสต์ยืนยันว่าไม่หลุดเข้า bundle

**ตั้งค่า / หมุนกุญแจ:**

```bash
# 1. สร้างค่าใหม่
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 2. ใส่ใน env ของแอปเป็น MEDIA_ARCHIVE_TOKEN แล้ว deploy

# 3. อัปเดต Vault ให้ตรงกัน
MEDIA_ARCHIVE_URL=https://<แอป> MEDIA_ARCHIVE_TOKEN=<ค่าใหม่> \
  node --env-file-if-exists=.env.local scripts/archive-schedule-config.mjs
```

ลำดับสำคัญ: **แอปก่อน Vault ทีหลัง** ถ้าสลับกัน รอบที่ยิงระหว่างนั้นจะได้ 401
ซึ่งไม่เสียหาย — งานยังอยู่ในคิว รอบถัดไปเก็บต่อ

หมุนกุญแจได้ทุกเมื่อ ไม่มี state ผูกกับค่าเดิม

---

## 8. ถ้า scheduler ล่ม

**ไม่มีอะไรพัง และไม่มีอะไรหาย — จนกว่าเวลาจะหมด**

- คิวอยู่ในฐานข้อมูล ไม่ได้อยู่ในหน่วยความจำ · restart ไม่ทำให้งานหาย
- import ยังทำงานปกติ · dataset ยังใช้ได้ · UI ยัง fallback ไปที่ source URL
- แถวที่ค้างจะถูกเก็บทันทีที่ scheduler กลับมา ไม่ต้อง import ใหม่

**เวลาที่มี:** นับจาก `earliestExpiry` ไม่ใช่จากตอนที่ scheduler ล่ม
โดยทั่วไป ~105 ชม. หลังการเก็บข้อมูล แต่ **เคยเจอสั้นสุด 28 ชม.**

| `expiringWithin24h` | ความหมาย |
| --- | --- |
| `0` | ยังสบาย |
| `> 0` และ scheduler ทำงาน | ปกติ เดี๋ยวก็เก็บได้ |
| `> 0` และ `lastAttemptAt` เก่า | **ต้องรีบ** — รันข้อ 6 ด้วยมือทันที |

หลังเลยเส้นตาย แถวนั้นจะกลายเป็น `failed` / `source_expired` ซึ่งเป็น terminal
**ไม่มีวิธีกู้** นอกจากเก็บข้อมูลใหม่

---

## 9. สิ่งที่ระบบนี้ *ไม่* ทำ

- ไม่เก็บวิดีโอเต็ม (ตัดสินใจไว้ตั้งแต่ C1.5 · ดู `MEDIA_DURABILITY_AUDIT.md`)
- ไม่แก้ `ad_observations.media` — ต้นทางยังเป็นความจริงเดิมเสมอ
- ไม่ทำ dedup ด้วย checksum (บันทึก sha256 ไว้แล้ว ยังไม่เปิดใช้)
- ไม่กู้ dataset เก่าที่ URL ตายไปแล้ว
- ไม่ทำให้ import ล้มเหลวเมื่อ archival ล้มเหลว
