# ตัวแกะคลิปแอดคู่แข่ง (video reader) บน VPS

ลิงก์วิดีโอที่ได้จากการเก็บข้อมูลคู่แข่งจะหมดอายุภายใน 32–108 ชั่วโมง ตัวนี้จะดึงคลิปก่อนหมดอายุ แล้วเก็บไว้ใน storage ของเรา (bucket แบบ private `pt-glory-video-readings` รับเฉพาะ jpeg กับ mp3 ตัวแกะคลิปสร้างเองตอนเริ่มทำงาน) ได้แก่ ภาพนิ่งตามเวลา 8 ภาพ เสียงช่วง 2 นาทีแรก และเสียง 5 วินาทีแรก

งานนี้**ไม่เรียก AI** การถอดเสียงจะทำบนเว็บตอนทีมกดเทียบแอด

รายละเอียดอยู่ในสเปก `docs/superpowers/specs/2026-11-23-ad-video-reading.md`

## ติดตั้ง (ครั้งเดียว)

ใช้เครื่องเดียวกับ `deploy/owned-sync` และใช้ไฟล์ `deploy/owned-sync/.env` เดิม ไม่ต้องสร้างค่าลับใหม่

```bash
cd ~/pt-glory-intelligence
git pull
# ลองรอบเดียวก่อน: ใส่คลิปจากรอบเก็บข้อมูล 3 วันล่าสุดเข้าคิว แล้วแกะ 1 รอบ
docker compose -f deploy/video-reader/docker-compose.yml run --rm --build video-reader \
  node --conditions=react-server --experimental-strip-types scripts/video-reader.mjs --enqueue-since-hours 72 --once
# เปิดให้ทำงานค้างไว้ (ทุก 10 นาที และเปิดเองหลังรีสตาร์ตเครื่อง)
docker compose -f deploy/video-reader/docker-compose.yml up -d --build
```

รอบที่สำเร็จจะมีบรรทัด `"event":"video","status":"ready"` ต่อคลิป และปิดรอบด้วย `"event":"pass_end"`

## ใช้งานประจำ

```bash
cd ~/pt-glory-intelligence
docker compose -f deploy/video-reader/docker-compose.yml logs --tail 30   # ดูว่าทำงานอยู่ไหม
git pull && docker compose -f deploy/video-reader/docker-compose.yml up -d --build   # อัปเดตโค้ด
docker compose -f deploy/video-reader/docker-compose.yml down   # หยุด
```

## สถานะในตาราง `ad_video_readings`

| สถานะ | ความหมาย |
|---|---|
| `pending` | รอแกะ (ถ้าครั้งก่อนล้ม จะมี `failure_reason` บอกไว้ และลองใหม่ได้สูงสุด 3 ครั้ง) |
| `ready` | เก็บภาพ (และเสียง ถ้าคลิปมีเสียง) แล้ว |
| `expired` | ลิงก์หมดอายุก่อนแกะ |
| `no_video` | ไม่มีลิงก์วิดีโอ หรือไฟล์ไม่มีภาพวิดีโอ |
| `too_large` | ไฟล์ใหญ่เกิน 150 MB |
| `failed` | ล้มเหลวครบ 3 ครั้ง หรือถูกปฏิเสธตามกฎความปลอดภัย (เช่น host ไม่ใช่ fbcdn) |

ถ้าสถานะ `expired` เกิน 5% ในหนึ่งวัน แปลว่าแกะไม่ทัน ให้เพิ่ม `VIDEO_READER_BATCH` หรือลด `VIDEO_READER_INTERVAL_MINUTES`

log ไม่มีลิงก์วิดีโอ มีแค่เลข observation ขนาดไฟล์ และเวลาที่ใช้
