# คลังแอด — UI ใหม่และ Apify

## ขอบเขตล่าสุดที่ผู้ใช้สั่ง

ออกแบบ UI ใหม่ทั้งหมดโดยไม่ใช้เว็บเดิมเป็นภาพอ้างอิง รอบนี้เชื่อมเฉพาะ Apify การเชื่อม Ads Management และ AI วิเคราะห์ธุรกิจเป็นงานภายหลัง

## งานที่ทำ

- เปลี่ยนระบบสีเป็นพื้นขาว/เทาอ่อนและเขียวเข้ม พร้อม shell, navigation, page header และหน้าเข้าสู่ระบบใหม่
- เปิดหน้าหลักที่คลังแอดโดยตรง พร้อมเลือกข้อมูลตามรอบและตรวจที่มา
- ออกแบบหน้าคลังใหม่ รวม empty state, filter toolbar, grid/table, การเลือกและเปรียบเทียบ 2–4 แอด
- ออกแบบการ์ดครีเอทีฟและรายละเอียดใหม่ โดยแสดงสถานะตามรอบที่เก็บและข้อความจริง
- ปรับหน้าค้นใหม่และเส้นทางเมื่อเก็บสำเร็จให้กลับคลังแอด
- หน้าตั้งค่าแสดง Actor, Build, วงเงิน และจำนวนแอดเป็นช่องกรอก และเก็บ JSON ขั้นสูงไว้ในส่วนพับ
- ตัดเมนูที่ยังไม่พร้อมและเมนูรายงานบริษัทออกจาก navigation รอบนี้ โดยไม่ลบข้อมูลหรือ backend เดิม

## การเชื่อมต่อ

ผู้ใช้เลือก `curious_coder/facebook-ads-library-scraper` ตรวจ Token และอ่าน metadata Actor สำเร็จ ตรึง Build `2.7.26` ใน server settings พร้อม audit ผ่าน `scripts/check-apify-connection.mjs`

ยังปิด `collector.enabled` ตามค่าเดิม ไม่เพิ่มวงเงินหรือเริ่ม paid run การเปิดค้นจริงต้องมีค่าตั้งค่าและวงเงินที่ครบตาม admission ของระบบ

## การตรวจ

- TypeScript, lint และ production build; lint ทั้งโปรเจกต์มี warning ของ collector-service เดิม 2 จุด
- Tests ของการเปรียบเทียบ เมนู/สิทธิ์ ข้อความ UI สื่อ และ collection form จำนวน 33 รายการ
- ตรวจขอบเขตการ import privileged database client
- Browser check สำหรับหน้าที่ต้องเข้าสู่ระบบยังไม่ผ่าน เพราะ session เก่าถูกปฏิเสธ และไม่พบบัญชีทดสอบเดิม ไม่สร้างผู้ใช้หรือเพิ่มสิทธิ์เพื่อข้ามข้อจำกัด
- ตรวจหน้าเข้าสู่ระบบด้วย browser บน desktop และ mobile แล้ว ไม่พบ overflow; หน้าหลังเข้าสู่ระบบยังต้องตรวจด้วย session ที่ใช้ได้
- เปิด local preview ที่ port 3188 สำหรับเข้าสู่ระบบตรวจด้วยบัญชีที่ได้รับสิทธิ์

ยังไม่ได้ deploy, เริ่ม paid collection หรือเชื่อมระบบ Ads Management
# Clarification: own-company data

The user confirmed that Ads Management remains the source of company ads. This application must display those ads and competitor ads together; opening the source website is not the intended comparison workflow. The existing CSV report screen is a fallback, not the live integration. The source currently exposes session-authenticated dashboard APIs, so a scoped read-only connection still needs implementation before company data can be described as connected.

