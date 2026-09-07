# V2 / V3 Visual Regression Audit

**สถานะ:** audit only — ไม่มีการแก้ไข code ใด ๆ ในงานนี้
**Audited commit:** `a295fad` (V1 baseline `b4551c8` + layout patch)
**วันที่:** 2026-09-02
**Screenshots:** `test-artifacts/visual/v23-audit/` — 55 ไฟล์
**Server integrity:** port 3000 ว่างก่อนรัน · `.next` ลบทิ้ง · build ใหม่จาก HEAD ·
ทุก capture มี guard ที่ fail ถ้า stylesheet ตัวใดตอบไม่ใช่ 200 (ดู §Infrastructure)

เกณฑ์ที่ใช้ตัดสินคือ V1 ที่ freeze แล้วเท่านั้น — Kanit = display voice ·
IBM Plex Sans Thai = UI/data · cream L0 / warm-white L1 / soft-pink L2 ·
orange = primary interaction · charcoal บน orange · focus ring น้ำเงิน ·
icon 24px stroke 1.75 · active nav = tint ไม่ใช่บล็อกทึบ · Thai ห้ามถูกตัดบน-ล่าง ·
mobile ต้อง recompose ไม่ใช่แค่ย่อ

---

## Findings

### P0 — blocks use

#### V23-01 · Media ไม่เคย resolve ได้เลย แม้ข้อมูลมีครบ

| | |
| --- | --- |
| **Surface** | Ads Explorer grid, Ad Detail Drawer |
| **Viewport** | ทุกขนาด |
| **Severity** | **P0** |
| **Owner** | `lib/media.ts` → `mediaUrls()` |
| **Screenshot** | `explorer-grid-1440.png`, `explorer-grid-375.png`, `drawer-dataset-1440.png` |
| **Correction scope** | **shared-system** (กระทบทั้ง V1 drawer และ V3 card) |

**Observed** — การ์ดทั้ง 500 ใบขึ้น placeholder ว่าง พร้อมข้อความ **"ไม่มีสื่อที่บันทึกไว้"**

**หลักฐานจากฐานข้อมูลจริง:**

```
ad_observations: {"n":"500","with_media":"500"}
dataset_ads_page returns media? true
image keys stored: original_image_url, resized_image_url, image_crops
video keys stored: video_hd_url, video_preview_image_url, video_sd_url
```

`mediaUrls()` มองหา key ชื่อ `url` / `previewUrl` / `thumbnailUrl` ซึ่ง**ไม่มีอยู่จริง**
ในข้อมูลที่ collector เก็บมา → คืน array ว่างเสมอ → ทุกการ์ดตกไปที่ placeholder

**Expected** — creative ต้องเป็นองค์ประกอบหลักของการ์ด และเมื่อโหลดไม่ได้จริง
ต้องขึ้น "สื่อโหลดไม่ได้ (ลิงก์ต้นทางหมดอายุ)" ไม่ใช่ "ไม่มีสื่อที่บันทึกไว้"

**ทำไมถึงเป็น P0 ไม่ใช่แค่ P1** — นี่ไม่ใช่แค่ปัญหาความสวย ระบบกำลัง**พูดสิ่งที่ไม่จริง
เกี่ยวกับข้อมูลของตัวเอง**: บอกว่าไม่มีสื่อบันทึกไว้ ทั้งที่บันทึกไว้ครบ 500/500
ขัดกับกฎข้อ 2 และข้อ 7 ของโปรเจกต์โดยตรง

**Recommended correction** — map key ให้ตรงกับ contract จริง (images:
`resized_image_url` → `original_image_url`, videos: `video_preview_image_url` เป็น
poster) · แยกกรณี "ไม่มี URL" ออกจาก "มี URL แต่โหลดไม่ได้" · เพิ่ม unit test ที่
ยิงกับ `tests/fixtures/golden-500.json` จริง ซึ่งจะจับ regression นี้ได้ทันที

---

### P1 — major visual / responsive defect

#### V23-02 · Explorer grid กลายเป็นกำแพงกล่องเปล่า

| | |
| --- | --- |
| **Surface** | Ads Explorer grid | **Viewport** ทุกขนาด | **Severity** P1 |
| **Owner** | `components/AdCard.module.css` `.hit` (`aspect-ratio: 4/5`) |
| **Screenshot** | `explorer-grid-1440.png` |
| **Correction scope** | V3-only |

**Observed** — เมื่อรวมกับ V23-01 แต่ละการ์ดสงวนพื้นที่ 4:5 ให้ creative ที่ไม่เคยขึ้น
ผลคือช่องว่างสูงประมาณ 340px ต่อการ์ด ตารางทั้งหน้าจึงเป็นกล่องเปล่าเรียงกัน
ห่างกันมาก และ metadata ที่อ่านได้จริงถูกดันไปอยู่แถบล่างบาง ๆ

**Expected** — ถ้า creative มี ต้อง dominate · ถ้าไม่มี การ์ดต้องยุบให้กระชับ
ไม่ใช่คงพื้นที่ว่างขนาดเดิมไว้

**คำตอบต่อคำถามของ audit** — *"รู้สึกเหมือน creative research product หรือยัง?"*
**ยัง** ตอนนี้คือ database record ที่ถูกวางในการ์ด เพราะองค์ประกอบที่ควรเป็นพระเอกว่างเปล่า
ทั้งหมด แก้ V23-01 ก่อนแล้วค่อยตัดสินข้อนี้ใหม่

**Recommended correction** — placeholder ควรมี aspect-ratio ที่เตี้ยกว่า (เช่น 16:9)
หรือยุบเป็นแถบ เมื่อไม่มี URL จริง

#### V23-03 · Table Mode ไม่มีคอลัมน์ creative

| | |
| --- | --- |
| **Surface** | Ads Explorer table | **Viewport** ทุกขนาด | **Severity** P1 |
| **Owner** | `app/(app)/datasets/[id]/explorer.tsx` (ตาราง) |
| **Screenshot** | `explorer-table-1440.png` |
| **Correction scope** | V3-only |

**Observed** — คอลัมน์เป็น `รหัสโฆษณา · เพจ · ข้อความ · รูปแบบ · CTA · แพลตฟอร์ม · เริ่มแสดง`
ไม่มี thumbnail ทั้งที่ media ถูก project มาแล้วใน 0022

**Expected** — spec §7 ระบุคอลัมน์แรกเป็น Creative · analyst สแกนด้วยภาพก่อนเสมอ

#### V23-04 · Explorer ถูกดันต่ำกว่า fold มาก

| | |
| --- | --- |
| **Surface** | Dataset Detail | **Viewport** 1440 / 1280 | **Severity** P1 |
| **Owner** | `app/(app)/datasets/[id]/page.tsx` (ลำดับ section) |
| **Screenshot** | `dataset-completed-1440.png` |
| **Correction scope** | V2-only |

**Observed** — วัดจาก capture: PageHeader + ContextBar + KPIRow + QualityStrip 6 แถว
กินพื้นที่ประมาณ **880px** ก่อนถึงหัวข้อ "Ads Explorer" ที่ 1440×1000 ผู้ใช้ต้องเลื่อน
ก่อนจะเห็นการ์ดใบแรก

**Expected** — ContextBar กับ KPIRow บอกเรื่องเดียวกันซ้ำสองชั้น (Ads / Pages /
เก็บเมื่อ / สถานะรอบ / คุณภาพ อยู่ครบทั้งสองที่) · handoff §6 ห้ามไว้ตรง ๆ ว่า
"Do not duplicate the same metadata again in a large card immediately below"

**Recommended correction** — ยุบ KPIRow หรือ ContextBar ให้เหลือชั้นเดียว ·
QualityStrip ควรพับเป็น summary + ปุ่มขยาย ไม่ใช่ 6 แถวเปิดค้าง

#### V23-05 · 375px คือการ stack ไม่ใช่การ recompose

| | |
| --- | --- |
| **Surface** | Ads Explorer | **Viewport** 375 | **Severity** P1 |
| **Owner** | `explorer.module.css` `.grid`, `AdCard.module.css` |
| **Screenshot** | `explorer-advanced-375.png` (สูง **23,598px**), `explorer-grid-375.png` |
| **Correction scope** | V3-only |

**Observed** — หนึ่งคอลัมน์ × 30 การ์ด × ~700px ทำให้หน้าเดียวสูงเกือบ 24,000px
ไม่มีการเปลี่ยนรูปแบบการ์ดให้เหมาะกับมือถือเลย

**Expected** — mobile ต้อง recompose: การ์ดแนวนอนแบบแถว (thumbnail ซ้าย + metadata ขวา)
หรือลด page size ลงเมื่อจอแคบ

#### V23-06 · Sticky toolbar ชนกับ topbar ของ shell ที่ 641–900px

| | |
| --- | --- |
| **Surface** | Ads Explorer toolbar | **Viewport** 768 | **Severity** P1 |
| **Owner** | `explorer.module.css` `.toolbar` vs `AppShell.module.css` `.topbar` |
| **Screenshot** | `explorer-grid-768.png` |
| **Correction scope** | shared-system |

**Observed** — `.topbar` เป็น sticky `top: 0; z-index: 30` เมื่อ ≤900px ส่วน `.toolbar`
เป็น sticky `top: 0; z-index: 10` และกลับเป็น static เฉพาะ ≤640px
ช่วง **641–900px** ทั้งคู่จึง stick ที่ 0 พร้อมกัน toolbar ลอดใต้ topbar

**Expected** — toolbar ควร stick ที่ `top: var(--topbar-h)` ในช่วงที่ topbar ปรากฏ

#### V23-07 · หน้า `/datasets` แบบไม่ล็อกอินยิง query ก่อน redirect

| | |
| --- | --- |
| **Surface** | ทุกหน้าใน `app/(app)` | **Viewport** — | **Severity** P1 |
| **Owner** | `app/(app)/layout.tsx` + page components |
| **Screenshot** | — (server log) |
| **Correction scope** | shared-system |

**Observed** — reproduce ได้ตรง ๆ:

```
curl /datasets (ไม่มี cookie)  → status=307   (redirect ทำงานถูก)
server log                     → ⨯ Error: {"code":"42501",
                                  "message":"permission denied for function dataset_list"}
```

layout กับ page render พร้อมกัน `listDatasets()` จึงถูกเรียกไปแล้วก่อนที่ `redirect()`
ใน layout จะ throw

**ไม่ใช่ช่องโหว่ข้อมูล** — grant ถูกต้องทุกตัว (ตรวจแล้ว: `dataset_list` auth=true
anon=false, search_path pin ครบ, `dataset_context` / `dataset_ads_page` /
`dataset_ads_facets` / `ad_detail` / `ad_observation_history` เหมือนกัน) RLS/grant
ปฏิเสธถูกต้อง ผู้ใช้ไม่เห็นอะไรผิด แต่ทุก request ที่ไม่ล็อกอินสร้าง unhandled
rejection ใน log และ page component เองไม่ได้ authorize — พึ่ง layout อย่างเดียว

---

### P2 — noticeable inconsistency / hierarchy

| ID | Surface | Viewport | Observed | Expected | Owner | Scope |
| --- | --- | --- | --- | --- | --- | --- |
| **V23-08** | Explorer table, Import preview | ทุกขนาด | วันที่ดิบ `2026-08-26T07:00:00.000Z` | Thai locale เหมือนที่อื่นทั้งแอป | `explorer.tsx`, `import-client.tsx` | shared |
| **V23-09** | Explorer table | ทุกขนาด | ตารางลอยบน canvas ไม่มี panel L1 ขณะที่ตาราง Dataset List อยู่ใน `Panel` | ตารางทุกใบเป็น surface L1 เดียวกัน | `explorer.tsx` | V3 |
| **V23-10** | Explorer table | 1440 | คอลัมน์แรกคือ ad id 16 หลัก · สถานะ/อายุ/ใช้ซ้ำ หลุดขอบขวาต้อง scroll ตั้งแต่ 1440 | นำด้วย creative + เพจ · ตัดคอลัมน์ที่ไม่ scan | `explorer.tsx` | V3 |
| **V23-11** | ทั้งแอป | ทุกขนาด | label เล็กมี 3 ขนาด: 10.5px (`KPIStat`, `ContextBar`, explorer `.label`) · 11px (`[data-eyebrow]`) · 11.5px (`th`) | scale เดียว | shared CSS | shared |
| **V23-12** | KPIStat | ทุกขนาด | `.value` 22px/700 แต่ไม่ได้ใช้ `--display` และไม่มี `data-numeral` → ตัวเลขใหญ่หลุดจาก display voice ของ V1 | ตัวเลขใหญ่ = Kanit + tabular-nums | `KPIStat.module.css` | V2 |
| **V23-13** | ทั้งแอป | ทุกขนาด | chip/badge 3 ภาษา: `Badge` (4px 10px, lh 1.9) · explorer `.chip` (min-height 30, ขอบ brand) · AdCard `.tag` (2px 8px, 11px — เสี่ยง Thai ถูกตัดถ้ามีค่าไทย) | badge ตัวเดียวทั้งระบบ | shared | shared |
| **V23-14** | AdCard | ทุกขนาด | `.tag` `.platforms` `.foot` = 11px ทั้งที่เป็นข้อมูลจริง (format, CTA, platform, วันที่, ใช้ซ้ำ) | handoff §4.3 ห้ามข้อมูลสำคัญพึ่ง 10–11px | `AdCard.module.css` | V3 |
| **V23-15** | AdCard | ทุกขนาด | คลิกได้เฉพาะรูป — ชื่อเพจ/copy/metadata ไม่ใช่ hit target | ทั้งการ์ดควรเปิด drawer | `AdCard.tsx` | V3 |
| **V23-16** | AdCard | ทุกขนาด | `object-fit: cover` ครอบรูป | งาน ad research ต้องเห็น hook/ข้อความบนภาพครบ | `AdCard.module.css` | V3 |
| **V23-17** | Import preview | 375 | ตาราง reported-vs-computed ล้นขอบ หัวคอลัมน์ "เซิร์ฟเวอร์นับเอง" ถูกตัด | ห่อ scroll container หรือเปลี่ยนเป็น row treatment แบบ QualityStrip | `import-client.tsx` | V2 |
| **V23-18** | Explorer chips | 375 | `.chip` / `.clearAll` สูง 30px ต่ำกว่าเป้าสัมผัส 44px | ≥44px บนมือถือ | `explorer.module.css` | V3 |

---

### P3 — polish

| ID | Surface | Observed | Owner | Scope |
| --- | --- | --- | --- | --- |
| **V23-19** | Import preview | ปุ่ม "ตรวจไฟล์ก่อนบันทึก" ยังค้างอยู่ด้านบนหลัง preview ขึ้นแล้ว — CTA จริงอยู่ล่างสุด | `import-client.tsx` | V2 |
| **V23-20** | Explorer toolbar | `.field select { max-width: 190px }` อาจตัดตัวเลือกไทยยาว | `explorer.module.css` | V3 |
| **V23-21** | ทั้งแอป | ปุ่ม disabled = opacity .5 → contrast 3.06 (WCAG ยกเว้น disabled ไว้ แต่ toolbar ใช้ disabled สื่อความหมาย) | `globals.css` | shared |

---

## สรุปตามหมวด

### A. Shared visual-system

V23-01 (P0 media) · V23-06 (sticky ชนกัน) · V23-07 (authorize ก่อน query) ·
V23-08 (รูปแบบวันที่) · V23-11 (label scale) · V23-13 (badge 3 ภาษา) · V23-21 (disabled)

### B. Import / V2

V23-17 (ตารางล้นที่ 375) · V23-19 (CTA ค้าง)
**Import คือส่วนที่แข็งแรงที่สุดในงานนี้** — stepper แยกสถานะด้วยรูปทรง + ✓/เลข
ไม่ได้พึ่งสีอย่างเดียว · dropzone ห่อ input จริงและยังอยู่ใน tab order ·
partial ใช้ amber แยกจาก rejected ที่ใช้แดงชัดเจน · QualityStrip ที่ 375 แปลงเป็น
row treatment ได้ดี

### C. Dataset / V2

V23-04 (Explorer ต่ำกว่า fold + ContextBar/KPIRow ซ้ำกัน) · V23-12 (ตัวเลขไม่ใช้ display font)

### D. Explorer / V3

V23-02 · V23-03 · V23-05 · V23-09 · V23-10 · V23-14 · V23-15 · V23-16 · V23-18 · V23-20

### E. Responsive

| Viewport | ผล |
| --- | --- |
| **375** | ❌ V23-05 (หน้าสูง 23.6k px) · V23-17 · V23-18 · grid 1 คอลัมน์ถูกต้อง |
| **768** | ❌ V23-06 (toolbar ลอดใต้ topbar) · grid 2 คอลัมน์ถูกต้อง |
| **1280** | ✅ grid 3 คอลัมน์ตามสเปก · ⚠️ V23-04 |
| **1440** | ✅ grid 4 คอลัมน์ตามสเปก · ⚠️ V23-04 · V23-10 (ตาราง scroll ตั้งแต่ 1440) |

### F. Accessibility (visual)

**ผ่านทั้งหมดที่วัดได้** — ทุกคู่สีที่ V2/V3 ใช้ผ่าน AA:

| คู่สี | อัตราส่วน |
| --- | --- |
| PartialBanner `--warn-ink` บน warn-tint | 5.11 |
| PartialBanner body `--ink` บน warn-tint | 13.13 |
| QualityBadge ปกติ `--ok-ink` บน ok-tint | 6.45 |
| QualityBadge ต่ำ `--danger` บน danger-tint | 5.28 |
| StatusBadge ไม่ทราบ `--muted` บน neutral-tint | 5.06 |
| AdCard `.tag` / `.platforms` | 5.06 / 5.99 |
| Filter chip / view toggle `--ink` บน brand tint | 12.98 / 12.14 |
| Table `th` `--muted` บน sunken | 5.14 |

**สิ่งที่ตรวจแล้วผ่าน:** สถานะ active/partial/error มีคำกำกับเสมอไม่ได้ใช้สีอย่างเดียว ·
stepper มี `.sr` บอกสถานะให้ screen reader · dropzone คืน focus ring ผ่าน
`:focus-within` · AdCard ปุ่มเปิดมี `aria-label` · chip มี `.sr` "ล้างตัวกรองนี้" ·
QualityStrip ที่มือถือยังเป็น `<table>` จริง

**ที่ต้องแก้:** V23-18 (เป้าสัมผัส) · V23-21 (disabled) · V23-13 (`.tag` เสี่ยงตัดวรรณยุกต์
ถ้ามีค่าไทย — ตอนนี้ค่าที่เก็บเป็นอังกฤษล้วนจึงยังไม่เห็นอาการ)

---

## Screenshot matrix

`test-artifacts/visual/v23-audit/` — 55 ไฟล์

| กลุ่ม | สถานะที่เก็บ | Viewport |
| --- | --- | --- |
| Import | idle · preview · partial · rejected | 1440 / 1280 / 768 / 375 |
| Import | committing · success · viewer | 1440 |
| Dataset Detail | completed · partial · quality expanded | 1440 / 1280 / 768 / 375 |
| Explorer | grid · filtered · advanced · table · zero-results | 1440 / 1280 / 768 / 375 |
| Explorer | no-media | 1440 / 375 |
| Drawer | dataset mode | 1440 / 375 |

---

## Infrastructure ที่เปลี่ยน (และเหตุผล)

ตาม §14 อนุญาตให้แตะ infra ได้เฉพาะเมื่อจำเป็นต่อความน่าเชื่อถือของ audit

1. **`e2e/audit.spec.ts` (ใหม่)** — capture matrix ต้องการ state เดิมที่ 4 viewport
   ขณะที่ `screenshots.spec.ts` เก็บที่ 1440 เป็นหลัก · เขียนเป็นไฟล์ใหม่เพื่อไม่แตะ
   capture ของ V1 ที่อนุมัติแล้ว
2. **`guardStyles()` ใน spec นั้น** — fail การ capture ถ้ามี `.css` ตัวใดตอบไม่ใช่ 200
   มาจากเหตุการณ์ก่อนหน้าที่ Playwright ไป attach กับ `next start` ค้างผ่าน
   `reuseExistingServer` แล้วได้ screenshot ที่ CSS หายครึ่งหนึ่ง ซึ่งดูเหมือน defect จริง
3. **`playwright.config.ts`** — เพิ่ม project `audit` (opt-in, ไม่อยู่ใน default run)

ไม่มีการแก้ CSS / JSX / migration / query / test อื่นใดในงานนี้

---

## ลำดับการแก้ที่แนะนำ

| ลำดับ | ทำอะไร | เหตุผล |
| --- | --- | --- |
| **1** | V23-01 | เป็น P0 และเป็นตัวบล็อกการตัดสิน V23-02 · จนกว่า creative จะขึ้น ยังประเมิน Explorer ไม่ได้จริง |
| **2** | V23-02 · V23-05 | ประเมินความสูงการ์ดและ mobile recompose ใหม่ **หลัง** creative ขึ้นแล้วเท่านั้น |
| **3** | V23-06 · V23-07 | ข้อบกพร่อง shared ที่แก้ครั้งเดียวจบ ไม่ต้องรอ V3 |
| **4** | V23-04 · V23-12 · V23-17 · V23-19 | ชุด V2 |
| **5** | V23-03 · V23-09 · V23-10 · V23-14 · V23-15 · V23-16 · V23-18 · V23-20 | ชุด V3 |
| **6** | V23-08 · V23-11 · V23-13 · V23-21 | เก็บกวาด shared-system รอบสุดท้าย |

**ข้อควรระวัง** — V23-03 (thumbnail ในตาราง) พึ่ง `mediaUrls()` เหมือนกัน
ถ้าแก้ก่อน V23-01 จะได้คอลัมน์ว่างเปล่าอีกคอลัมน์
