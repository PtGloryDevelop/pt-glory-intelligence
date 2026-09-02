# Current UI Inventory — Phase 1 baseline

สถานะ ณ commit `71577e2` (Phase 1 final) · สำรวจก่อนเริ่ม visual refactor

Phase 1 UI ถูกสร้างเพื่อ**พิสูจน์พฤติกรรมของ engine** ไม่ได้ตั้งใจให้สวย
ทั้งหมดคือ 798 บรรทัด TSX ใน 8 ไฟล์ · **ไม่มี CSS framework** · style เป็น inline object
กับ CSS custom property 9 ตัวใน `app/globals.css`

---

## 1. Route inventory

| Route | ไฟล์ | บรรทัด | สภาพปัจจุบัน |
| --- | --- | --- | --- |
| `/login` | `app/login/page.tsx` | 62 | server action form · ไม่มี style |
| `/` | `app/page.tsx` | 29 | บอก role + ลิงก์ 2 อัน |
| `/import` | `app/import/page.tsx` + `import-client.tsx` | 36 + 199 | flow ครบ · ไม่มี stepper · `<table>` เปล่า |
| `/datasets` | `app/datasets/page.tsx` | 31 | `<ul>` ของชื่อ dataset |
| `/datasets/[id]` | `app/datasets/[id]/page.tsx` | 81 | context row แบบ flex + quality table เต็ม 20 แถว |
| — Explorer | `app/datasets/[id]/explorer.tsx` | 172 | table อย่างเดียว · ไม่มี grid · ไม่ sticky |
| — Drawer | `app/datasets/[id]/drawer.tsx` | 188 | fixed 520px · `<dl>` แบน ไม่มี section |

## 2. Component inventory

**ไม่มี shared component เลย** ทุกอย่างเป็น local function ในไฟล์เดียวกัน

| Local helper | อยู่ที่ | ซ้ำกับใคร |
| --- | --- | --- |
| `Item()` | `datasets/[id]/page.tsx` | — |
| `Select()` | `datasets/[id]/explorer.tsx` | — |
| `dash()` | `explorer.tsx` (export) | ใช้ร่วมใน drawer |
| `Row()` | `drawer.tsx` | คล้าย `Item()` |
| `Media()` / `isHttpUrl()` | `drawer.tsx` | — |
| `CoverageTable()` | `import/import-client.tsx` | **ซ้ำกับ** quality table ใน dataset page |

`CoverageTable` กับ quality strip ใน dataset detail คือ pattern เดียวกันที่เขียนสองรอบ —
handoff §12 ห้ามไว้ตรง ๆ

## 3. Design token inventory

`app/globals.css` มี 9 ตัว:

`--paper #fbf8f3` · `--surface #ffffff` · `--ink #241f1a` · `--muted #6f6459`
· `--line #e6ded2` · `--gold #a9863f` · `--gold-deep #7d6229` · `--focus #1d4ed8`

จุดที่เรียกใช้จริงมีแค่:

| Token | call site |
| --- | --- |
| `--muted` | `datasets/page.tsx:24` · `explorer.tsx:86` · `datasets/[id]/page.tsx:77` · `import-client.tsx:139` · `import/page.tsx:30` |
| `--gold-deep` | `globals.css:23` (`a`) · `login/page.tsx:38` · `import-client.tsx:103` |
| `--paper` / `--ink` | `globals.css` body |
| `--gold` / `--surface` / `--line` | **ไม่ถูกใช้เลย** |

`--gold-deep` ถูกใช้เป็นสีข้อความ error ทั้งสองที่ ซึ่งความหมายผิดตั้งแต่แรก — ควรเป็นสี danger

## 4. สิ่งที่ยังไม่มีเลย

- App Shell / Sidebar / navigation ทุกชนิด
- typography scale · spacing scale · radius · elevation
- responsive rule ใด ๆ (inline style ล้วน desktop)
- loading skeleton (มีแค่ `<p role="status">กำลังโหลด…</p>`)
- semantic badge (tier แสดงเป็น text ดิบ `normal` / `low`)
- grid mode ของ Explorer
- media placeholder ตาม §10

## 5. สิ่งที่ต้องรักษาไว้ — test surface

Playwright ยึด `data-testid` เหล่านี้ · restyle ห้ามทำหาย

`ad-drawer` `ads-table` `category-select` `commit-button` `context-ads` `context-pages`
`context-quarantine` `context-status` `coverage-table` `dataset-name` `datasets-empty`
`drawer-active` `drawer-close` `drawer-context` `drawer-format` `explorer-empty`
`explorer-total` `f-active` `f-platform` `file-input` `filter-search` `import-error`
`media-placeholder` `media-unavailable` `next-page` `observation-history` `partial-banner`
`partial-warning` `prev-page` `preview-ads` `preview-button` `preview-method`
`preview-pages` `preview-panel` `preview-quarantine` `quality-strip` `reset-filters`
`viewer-notice`

selector อื่นที่ผูกไว้: `getByLabel("อีเมล")` · `getByLabel("รหัสผ่าน")` ·
`getByRole("button", { name: "เข้าสู่ระบบ" })` · `getByText("สิทธิ์ <role>")`

## 6. Read-layer surface ที่ UI มีให้ใช้

| ฟังก์ชัน | คืนอะไร | ข้อจำกัดที่กระทบ UI |
| --- | --- | --- |
| `listDatasets()` | id, name, created_at, category_id | ไม่มี counts / status / quality → **B2** |
| `dataset_context` | ครบสำหรับ ContextBar | — |
| `dataset_ads_page` | 13 คอลัมน์ + total | **ไม่มี media** → B1 · order by ตายตัว → B3 |
| `dataset_ads_facets` | 5 facet | — |
| `ad_detail` | ครบ รวม media + ad_age_days | — |
| `ad_observation_history` | ครบ | — |
