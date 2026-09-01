# PT Glory Intelligence — Claude Code System

ชุดไฟล์นี้ใช้เป็น Project Rules + Product Spec + Workflow Skills สำหรับสร้าง **PT Glory Intelligence** บน Claude Code แบบเป็นขั้นตอนและตรวจสอบได้

## วิธีติดตั้ง

1. แตกโฟลเดอร์นี้ไว้ที่ root ของโปรเจกต์
2. ให้ `CLAUDE.md` อยู่ที่ root
3. ให้ `.claude/skills/*/SKILL.md` อยู่ตามโครงสร้างเดิม
4. เริ่ม Claude Code จาก root ของโปรเจกต์
5. เริ่มงานใหญ่ด้วย `/ptg-grill` และเดินตาม workflow ที่กำหนด

## Source of Truth

เรียงลำดับความน่าเชื่อถือจากสูงสุดลงมา:

1. JSON จริงจาก Collector / Database จริง
2. `docs/DATA_CONTRACT.md`
3. `docs/PRODUCT_SPEC.md`
4. `docs/ARCHITECTURE.md`
5. `docs/UX_SPEC.md`
6. Mockup/ภาพอ้างอิง
7. AI interpretation

ถ้าข้อมูลขัดกัน ให้ยึดข้อมูลจริงก่อนเสมอ

## Workflow หลัก

### งานเล็ก

`/ptg-grill` → implement → test → `/ptg-code-review`

### งานใหญ่

`/ptg-grill` → `/ptg-spec` → `/ptg-architecture` → `/ptg-tickets` → implement ทีละ ticket → `/ptg-edgecase` → test → `/ptg-code-review` → `/ptg-security` → `/ptg-playwright` → `/ptg-release-gate` → `/ptg-golive`

### Bug

`/ptg-debug` → reproduce → failing regression test → fix → regression → review

### Database Change

`/ptg-db-change` → migration → test DB → rollback plan → review → deploy

### AI Change

`/ptg-ai-change` → golden dataset → evaluation → evidence check → cost check → deploy

## กฎใหญ่ที่สุดของโปรเจกต์

> **ไม่มี field จริง = ห้ามแสดงเป็นตัวเลขจริง**

PT Glory Intelligence ต้องไม่สร้าง Engagement, CTR, Spend, ROAS, Sales, Conversion หรือ Performance metric ที่ Collector ไม่มีจริง
