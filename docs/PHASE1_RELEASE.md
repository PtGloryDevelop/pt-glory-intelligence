# Phase 1 — Data Vertical Slice · COMPLETE

สถานะ: **COMPLETE** · อนุมัติ 2026-09-02

Baseline commit: **`71577e2`** (tag `v0.1.0-phase1`, alias `phase1-complete`)

เอกสารนี้เป็นบันทึกการปิด Phase 1 เท่านั้น ไม่ใช่สเปก — รายละเอียดการออกแบบอยู่ที่
[SPEC_2026-09-01_PHASE1.md](SPEC_2026-09-01_PHASE1.md),
[ARCHITECTURE_REVIEW_2026-09-01_PHASE1.md](ARCHITECTURE_REVIEW_2026-09-01_PHASE1.md) และ
[TICKETS_2026-09-01_PHASE1.md](TICKETS_2026-09-01_PHASE1.md)

---

## Scope ที่ส่งมอบ

| Gate | Tickets | สิ่งที่ปิด |
| --- | --- | --- |
| A | T01–T04 | schema foundation, roles, RLS, migration harness |
| B | T05–T08 | collector contract, validation, normalization, coverage |
| C | T09–T12 | real transaction, dedup, observations, quarantine |
| D | T13–T16 | import UI, dataset page, Ads Explorer, Ad Detail Drawer |
| E | T17–T18 | golden regression suite, security review, E2E journey |

Ticket plan มีถึง **T18** — ไม่มี T19/T20

---

## Verification ณ commit `71577e2`

รันจบในรอบเดียว ไม่มี retry ไม่มี skip

| ขั้นตอน | ผล |
| --- | --- |
| `npm run lint` | pass |
| `npm run typecheck` | pass |
| `npm run check:imports` | pass |
| `npm test` (unit + DB integration + RLS + auth-chain) | **157 pass / 0 fail / 0 skipped** |
| `npx playwright test` | **22 pass** |
| `npm run build` | pass · 11 routes |

Database: Supabase Cloud **DEV** project เท่านั้น · secrets อยู่ใน `.env.local` และไม่ถูก commit

---

## Migrations

ใช้งานถึง **0019** — ทุกไฟล์มี `.down.sql` คู่กัน (`0001`–`0019`, 38 ไฟล์)

| ช่วง | เนื้อหา |
| --- | --- |
| 0001–0015 | 13 ตาราง + index |
| 0016 | RLS policies (13 ตาราง) |
| 0017 | `jsonb_text_array()` |
| 0018 | read API 5 ฟังก์ชัน — snapshot pinning (I1) |
| 0019 | read function permissions + pinned `search_path` |

---

## Core invariants ที่มี test คุ้มครอง

| Invariant | ความหมาย |
| --- | --- |
| I1 | dataset ผูกกับ `collection_run_id` — import รอบใหม่ไม่เปลี่ยนค่าที่ dataset เก่าแสดง |
| I2 | master current state เดินหน้าอย่างเดียว (monotonic) |
| I3 | ตัวเลข canonical เซิร์ฟเวอร์คำนวณเอง ไม่เชื่อ collector |
| I4 | snapshot membership — ad ที่ไม่อยู่ใน dataset คือ 404 ไม่ fallback |
| I5 | import เป็น transaction จริง — ล้มแล้ว rollback ทั้งก้อน |

Golden fixture 500 ads ถูก pin ด้วย SHA-256 ของ canonical output ทั้งก้อน + baseline
คุณภาพข้อมูล 20 ฟิลด์ — normalizer เปลี่ยนพฤติกรรมเมื่อไรจะ fail ทันที

---

## Security findings ที่แก้แล้ว (Gate E)

**1. Read functions เรียกได้โดย `anon` (medium)** — 0018 สร้างฟังก์ชันบน Postgres default
ทำให้ PUBLIC มี EXECUTE และ Supabase default privileges ยัง grant ให้ `anon` แบบระบุชื่อ
ซึ่ง `revoke ... from public` ใน 0002 ไม่ได้ลบออก · RLS ยังคืน 0 แถวจึงไม่มีข้อมูลรั่ว
แต่เป็นสิทธิ์ที่ได้มาโดยบังเอิญ · 0019 revoke ทั้งสองทาง grant เฉพาะ `authenticated`

**2. `MAX_BYTES` ไม่ถูกบังคับบนเส้นทาง HTTP (medium)** — `previewImport` parse JSON เองแล้ว
เรียก `validate()` ข้าม `validateRaw()` ซึ่งเป็นที่เดียวที่เช็ค 25 MB · เพดานจริงเหลือแค่จำนวน record
· แยก logic ไป `lib/import/analyze.ts` ที่ไม่มี DB import และเช็ค `file.size` ก่อน buffer

---

## Remaining known risks

บันทึกตามที่รายงานตอนปิด Gate E ไม่ตัดทอน

- **`alter default privileges` ผูกกับ owner** — ครอบเฉพาะฟังก์ชันที่สร้างโดย `postgres`
  ฟังก์ชันที่สร้างโดย role อื่นจะกลับไปอยู่บน default อีก · assertion block ใน 0019
  ครอบแค่ 6 ฟังก์ชันที่รู้จัก migration ใหม่ต้องเขียน grant ของตัวเอง
- **Search ใช้ `ILIKE '%…%'`** ไม่มี trigram index · พอไหวที่ 500 ads แต่จะ scan หนักขึ้นเมื่อข้อมูลโต
- **DEV pooler ไม่เสถียร** (DNS/ETIMEDOUT เป็นครั้งคราว) · รอบที่ใช้ปิด gate สะอาด ·
  `isInfrastructureError()` แยกป้ายไว้ ไม่กลบเป็น test failure
- **`e2e/.tmp` fixtures สร้างตอน setup** · E2E ต้องมี `tests/fixtures/golden-500.json` (commit ไว้แล้ว)
- **Ticket plan จบที่ T18** · Gate E scope A–F ครอบด้วย T17 + T18 ตามที่เขียนไว้

---

## สิ่งที่ Phase 1 **ไม่** รองรับ

ตามกฎข้อ 3 ของโปรเจกต์ — ไม่มี field ใดในระบบเก็บหรือแสดง: engagement, reactions,
comments, shares, reach, impressions, spend, CTR, CPC, CPA, ROAS, sales, conversion,
market share · มี migration test ยืนยันว่าไม่มีคอลัมน์เหล่านี้ในทุก schema

ยังไม่เริ่ม: AI, Deep Search, Dashboard intelligence, Brands, Competitor Intelligence,
Creative Intelligence, Compare, Watchlist, SocialAPIs, background jobs, visual redesign

---

## ขั้นต่อไป

Base44 UI reference จะถูกส่งมาภายหลังสำหรับ visual refactor · Phase 2 ยังไม่เริ่ม
