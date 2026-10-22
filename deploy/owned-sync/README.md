# ดึงข้อมูล "แอดของเรา" อัตโนมัติบน VPS

ตัวนี้ทำให้หน้า **แอดของเรา** ในเว็บส่องแอด (pt-glory-intelligence) อัปเดตเองวันละ 3 รอบ (09:00 / 13:00 / 18:00 เวลาไทย) โดยไม่ต้องมีคนกด "อัปเดตข้อมูล" และไม่ต้องเปิดคอมเครื่องไหน

ทำงานบน VPS เครื่องเดียวกับ worker ของ Ads Management แต่เป็น Docker คนละชุด แต่ละรอบ:

1. อ่านข้อมูลแอดจากฐานข้อมูล Ads Management (อ่านอย่างเดียว ไม่เขียนกลับ)
2. เขียนลงฐานข้อมูลของส่องแอด (แทนชุดเดิม เก็บแค่ชุดล่าสุด)
3. เก็บภาพย่อของแอดใหม่เข้า storage ของส่องแอด (ภาพที่เคยเก็บแล้วใช้ซ้ำ)

ใช้เวลารอบละไม่กี่นาที ถ้ารอบไหนล้มเหลว ข้อมูลชุดเดิมยังใช้งานได้ และรอบถัดไปจะลองใหม่เอง

## ต้องมีก่อน

- Docker และ Docker Compose (มีอยู่แล้ว เพราะ worker ของ Ads Management ใช้)
- โค้ด Ads Management บนเครื่องนี้ (โฟลเดอร์ที่มี `src/lib/workspace-insights.ts`) — ระบบจะเปิดแบบอ่านอย่างเดียว
- ค่าลับตามตารางด้านล่าง

## ติดตั้ง (ครั้งเดียว)

```bash
# 1) เอาโค้ดส่องแอดลงเครื่อง (เลือกโฟลเดอร์ได้ตามสะดวก)
git clone https://github.com/PtGloryDevelop/pt-glory-intelligence.git /opt/pt-glory-intelligence
cd /opt/pt-glory-intelligence
git checkout ui-v2

# 2) สร้างไฟล์ค่าลับ แล้วเติมค่าให้ครบ (ดูตารางด้านล่าง)
cp deploy/owned-sync/env.example deploy/owned-sync/.env
nano deploy/owned-sync/.env
chmod 600 deploy/owned-sync/.env

# 3) ลองรัน 1 รอบทันที เพื่อเช็กว่าค่าถูก
docker compose -f deploy/owned-sync/docker-compose.yml run --rm --build owned-sync node scripts/owned-sync-loop.mjs --once
```

รอบทดสอบที่สำเร็จ บรรทัดท้าย ๆ จะมี `"status":"completed"` และ `"event":"cycle_end","sync":0,"thumbs":0`
หลังจากนั้นเปิดหน้าแอดของเราในเว็บ ป้ายมุมขวาบน "แอดเรา ข้อมูลถึง …" จะเป็นวันล่าสุด

```bash
# 4) เปิดให้ทำงานตามเวลา (รันค้างไว้ และเปิดเองหลังรีสตาร์ตเครื่อง)
docker compose -f deploy/owned-sync/docker-compose.yml up -d --build
```

## ค่าใน `deploy/owned-sync/.env`

| ชื่อ | เอามาจาก |
|---|---|
| `ADS_MANAGEMENT_DIR` | path ของโค้ด Ads Management บนเครื่องนี้ เช่น `/opt/pt-glory-ads-management` |
| `DATABASE_URL` | Supabase โปรเจกต์ **pt-glory-intelligence-dev** → Connect → **Session pooler** (ลงท้าย `pooler.supabase.com:5432`) |
| `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase โปรเจกต์ **pt-glory-intelligence-dev** → Project Settings → API |
| `OWNED_SYNC_ACTOR_ID`, `OWNED_MANAGEMENT_AUTHORIZED_EMAIL` | ขอจากเจ้าของระบบส่องแอด (ค่าเดียวกับที่เครื่องหลักใช้อยู่) |
| `ADS_SUPABASE_URL`, `ADS_SUPABASE_SERVICE_ROLE_KEY`, `ADS_TOKEN_ENCRYPTION_KEY` | ค่า `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `TOKEN_ENCRYPTION_KEY` ตัวเดียวกับที่ระบบ Ads Management **ตัวที่ใช้งานจริง** บนเครื่องนี้ใช้ (`TOKEN_ENCRYPTION_KEY` ต้องเป็นตัวที่ถอดรหัส Facebook token ในฐานข้อมูลได้ — ค่าในไฟล์ `.env.local` ของเครื่องหลักเป็นคนละตัว ใช้แทนไม่ได้) |
| `OWNED_SYNC_TIMES` (ไม่บังคับ) | เวลาไทยคั่นด้วยจุลภาค ค่าเริ่มต้น `09:00,13:00,18:00` |

ไฟล์ `.env` มีกุญแจเข้าฐานข้อมูล อย่าส่งต่อหรือ commit (`.gitignore` กันไว้แล้ว)

## ใช้งานประจำ

```bash
cd /opt/pt-glory-intelligence
# ดูว่าทำงานอยู่ไหม และรอบถัดไปกี่โมง (บรรทัด "next_run" เป็นเวลา UTC = ไทย −7 ชม.)
docker compose -f deploy/owned-sync/docker-compose.yml logs --tail 30
# สั่งดึงทันที 1 รอบ (ไม่ต้องรอเวลา)
docker compose -f deploy/owned-sync/docker-compose.yml exec owned-sync node scripts/owned-sync-loop.mjs --once
# อัปเดตโค้ดเมื่อมีการแก้
git pull && docker compose -f deploy/owned-sync/docker-compose.yml up -d --build
# หยุด
docker compose -f deploy/owned-sync/docker-compose.yml down
```

ถ้ามีคนกด "อัปเดตข้อมูล" จากเครื่องหลักพร้อมกับรอบอัตโนมัติ ระบบจะรันแค่ตัวเดียว อีกตัวจะขึ้นว่า `An owned library sync is already running` แล้วข้ามไป

## เมื่อมีปัญหา

| อาการใน log | แก้ |
|---|---|
| `Set ADS_MANAGEMENT_DIR …` (ตอนสั่ง docker compose) | ยังไม่ได้ใส่ `ADS_MANAGEMENT_DIR` ใน `.env` |
| `Management source connection is not configured` | ยังไม่ได้ตั้ง `OWNED_MANAGEMENT_AUTHORIZED_EMAIL` |
| `Cannot find module '/ads-management/src/lib/…'` | `ADS_MANAGEMENT_DIR` ชี้ผิดโฟลเดอร์ ต้องเป็นโฟลเดอร์ที่มี `src/lib/workspace-insights.ts` |
| `Configured source administrator is not active` | อีเมลใน `OWNED_MANAGEMENT_AUTHORIZED_EMAIL` ไม่ใช่แอดมินที่ active ใน Ads Management |
| `Analyst authorization required` | `OWNED_SYNC_ACTOR_ID` ไม่ใช่ผู้ใช้ที่เป็น admin/analyst ในส่องแอด |
| `Owned sync failed` + `errorClass` | ดูชื่อ errorClass แล้วส่งให้ทีมพัฒนา (log ไม่มีค่าลับ) |
| `"thumbs":1` | ข้อมูลอัปเดตแล้ว แต่ภาพย่อบางส่วนยังไม่ครบ รอบถัดไปจะเก็บต่อ |
| `Page names unavailable; retaining stored source names` หรือผลภาพย่อมี `"sharp":0` | ถอดรหัส Facebook token ไม่ได้: `ADS_TOKEN_ENCRYPTION_KEY` ไม่ตรงกับตัวที่ Ads Management ใช้งานจริง ข้อมูลยังอัปเดตได้ แต่ชื่อเพจใหม่และภาพคมชัดจะไม่มา |
