# Gate A — Final Verification Runbook

ทุกอย่างเขียนเสร็จแล้ว เหลือแค่รันกับฐานข้อมูลจริง เอกสารนี้คือขั้นตอนที่รันได้เลย

---

## ต้องมีก่อน

**Supabase CLI ติดตั้งแล้ว** (v2.107.0 ตรวจแล้ว) แต่ **Docker Desktop ยังไม่มี** ซึ่ง `supabase start` ต้องใช้

เลือกทางใดทางหนึ่ง:

### ทาง A — local stack (แนะนำ)

ติดตั้ง Docker Desktop แล้ว:

```bash
supabase start
```

CLI จะพิมพ์ `API URL`, `DB URL`, `anon key`, `service_role key` ออกมา

ข้อดี: ฟรี · แยกจากของจริงสนิท · ไม่ต้องเอา credential ของ production มาเสี่ยง · ลบทิ้งได้ด้วย `supabase stop --no-backup`

### ทาง B — Supabase cloud DEV project

สร้าง project ใหม่ที่ตั้งใจให้เป็น DEV เท่านั้น แล้วเอาค่าจาก Project Settings → API และ Database

> ⚠️ `SUPABASE_SERVICE_ROLE_KEY` มีสิทธิ์เต็ม และเทสต์จะ **สร้างและลบ user จริง** ห้ามชี้ไปที่ project ที่มีข้อมูลจริงเด็ดขาด

---

## ตั้งค่า env

```bash
export DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres'
export SUPABASE_URL='http://127.0.0.1:54321'
export SUPABASE_ANON_KEY='<anon key>'
export SUPABASE_SERVICE_ROLE_KEY='<service_role key>'
```

(ค่าตัวอย่างเป็นของ local stack · ทาง B ใช้ค่าจาก dashboard)

---

## รัน

```bash
npm run verify:gate-a
```

ทำตามลำดับที่ review กำหนด:

| ขั้น | คำสั่ง | ตรวจอะไร |
|---|---|---|
| 1 | `migrate up` | 0001–0016 ขึ้นบน DB สะอาด · แต่ละไฟล์อยู่ใน transaction ของตัวเอง |
| 2 | `test:db` | RLS matrix + auth chain |
| 3 | `migrate down --all` | ย้อนทุก migration จากใหม่ไปเก่า |
| 4 | ตรวจ rollback | **ไม่เหลือ table / function / policy ของโปรเจกต์เลย** — ขั้นนี้จับ down-migration ที่เขียนลวก |
| 5 | `migrate up` | ขึ้นใหม่ได้จากสภาพว่าง |
| 6 | `test:db` | ผลเหมือนรอบแรก |

รันแยกก็ได้:

```bash
npm run migrate up
npm run test:db
npm run migrate down --all
npm run migrate up
```

---

## สิ่งที่เทสต์พิสูจน์

### `tests/db/rls.test.ts` — 14 เคส ระดับฐานข้อมูล

เลียนแบบ PostgREST ด้วย `set local role` + `request.jwt.claims` ทุกเคสอยู่ใน transaction ที่ rollback ทิ้ง

| เคส | คาดหวัง |
|---|---|
| unauthenticated (`anon`) อ่าน | ไม่เห็นอะไรเลยทั้ง 10 ตาราง |
| unauthenticated เขียน | ถูกปฏิเสธ |
| **authenticated แต่ไม่มี `user_roles` row** | **อ่านไม่ได้ เขียนไม่ได้** |
| viewer อ่าน | ได้ทุกตาราง business |
| viewer insert/update/delete | ถูกปฏิเสธ / กระทบ 0 แถว |
| analyst insert | ได้ |
| analyst delete | กระทบ 0 แถว (delete เป็นของ admin) |
| analyst อ่าน `app_settings` / `audit_logs` | ไม่เห็น |
| admin อ่าน `app_settings` · ลบ business row | ได้ |
| **viewer / analyst / admin แก้ role ตัวเอง** | **กระทบ 0 แถวทั้งสาม** |
| admin แก้ role คนอื่น | ได้ |
| analyst แก้ role คนอื่น | กระทบ 0 แถว |
| soft-deleted row | หายจาก read |
| **`current_user_role()` รับ argument ไม่ได้** | `pg_proc.pronargs = 0` |
| `current_user_role()` ตาม JWT | viewer→`viewer` · admin→`admin` · ไม่มี role→`null` |
| privileged connection | **bypass RLS ได้จริง** (พิสูจน์ว่า `requireRole()` ฝั่ง Node คือด่านเดียวของ write path) |

### `tests/db/auth-chain.test.ts` — 7 เคส ผ่าน stack จริง

**ไม่แตะ `request.jwt.claims` เลย** — ล็อกอินจริงผ่าน GoTrue แล้วให้ PostgREST ถอด claim เอง จึงพิสูจน์ทั้งสาย

```
Supabase Auth → JWT → auth.uid() → current_user_role() → RLS
```

| เคส | คาดหวัง |
|---|---|
| anon key เปล่า ๆ | อ่านไม่ได้ |
| viewer ที่ล็อกอินจริง | อ่านได้ |
| ล็อกอินได้แต่ไม่มี role row | อ่านไม่ได้ |
| viewer insert | error `42501` / row-level security |
| analyst insert | สำเร็จ |
| **`auth.uid()` ตรงกับผู้ใช้ที่ล็อกอิน** | `user_roles` คืนแถวของตัวเองแถวเดียว |
| analyst vs admin กับ `app_settings` | ปิด / เปิด |
| ทุก role อัปเดต role ตัวเองผ่าน PostgREST | กระทบ 0 แถว |

---

## ผลที่ต้องรายงานกลับ

1. output ของ `npm run verify:gate-a` ทั้ง 6 ขั้น
2. จำนวนเทสต์: unit + rls + auth-chain
3. `lint` / `typecheck` / `build`
4. ปัญหาที่เจอและวิธีแก้

---

## หมายเหตุ

- `supabase init` สร้าง `supabase/config.toml` ไว้แล้ว
- migration ขับด้วย `scripts/migrate.mjs` ไม่ใช่ `supabase db push` เพราะเราต้องการคู่ `.down.sql` ที่ CLI ไม่รองรับ · CLI ใช้แค่ยกสแตกขึ้นมา
- ถ้า Supabase เวอร์ชันใหม่เปลี่ยนวิธีส่ง claim เข้ามา `asUser()` ใน `rls.test.ts` อาจต้องปรับ — `auth-chain.test.ts` จะจับได้ก่อนเพราะไม่ได้ตั้ง claim เอง
