# First Prompt for Claude Code

ใช้ข้อความนี้เป็นคำสั่งแรกหลังวางชุดไฟล์ลง root โปรเจกต์

```text
อ่าน CLAUDE.md, PT_GLORY_MASTER_SPEC.md และ docs ทั้งหมดก่อน

จากนั้นตรวจ repository ปัจจุบันโดยยังไม่แก้โค้ด และทำตามลำดับนี้:

1. สรุปว่า codebase ปัจจุบันมีอะไรแล้วบ้าง
2. เปรียบเทียบกับ PT Glory Master Spec
3. ระบุ gaps และสิ่งที่ขัดกับ Data Contract
4. ห้ามเพิ่ม metric ที่ source ไม่มี
5. เสนอ Production Architecture สำหรับ Phase 0-1
6. เสนอ Supabase/PostgreSQL schema พร้อม relationships, indexes, RLS concept และ migration order
7. map ทุก KPI ของ Overview ไปยัง source field / deterministic formula
8. ระบุสิ่งที่ยังทำไม่ได้จาก source ปัจจุบัน
9. เสนอ vertical slice แรก: JSON Import → Database → Dataset → Ads Explorer → Ad Detail Drawer
10. แตกเป็น tickets แต่ยังไม่ implement จนกว่าจะ approve

ถ้าพบไฟล์หรือ logic เดิม ให้เปิดอ่านก่อนอ้างอิง ห้ามเดาจากชื่อไฟล์
```

หลัง approve architecture/spec ให้ใช้ skills ตามลำดับ:

`/ptg-grill` → `/ptg-spec` → `/ptg-architecture` → `/ptg-tickets`
