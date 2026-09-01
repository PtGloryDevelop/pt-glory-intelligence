# UX Specification

## Visual Direction

- Light theme
- warm cream/off-white background
- gold accent
- dark readable typography
- rounded cards with restrained borders/shadows
- dense analytical layout without decorative clutter
- Thai-first labels
- English for technical terms where clearer

## Global Layout

### Left Sidebar

Main:
- หน้าหลัก
- Deep Search

Data:
- หมวดหมู่
- Dataset
- Ads Explorer
- เพจ / แบรนด์
- Creatives

Intelligence:
- ภาพรวมตลาด
- คู่แข่ง
- Creative Intelligence
- Pain Point / Hook / Offer
- ราคา & Promotion
- แนวโน้ม
- Compare
- Watchlist

System:
- นำเข้าข้อมูล
- Collection Runs
- Data Quality
- AI Analysis History
- Unmapped Pages
- Settings

### Context Bar

Always show relevant current context:

- Category
- Dataset
- Source
- Collected At
- Data Quality

## Home / Overview

### Deep Search input

Primary top search prompt:

`วันนี้อยากรู้อะไรเกี่ยวกับตลาดนี้?`

### KPI cards

Allowed examples:

- Ads ทั้งหมด
- Pages ที่พบ
- Ads ใหม่ 30 วัน
- Ads รันนาน >= threshold
- Creative Reuse

### Core content

- Ads Started Timeline
- Format
- CTA
- Platform coverage
- Top Pages / Brands
- Price / Promotion
- Creative signals
- AI Intelligence + evidence
- Recent Ads
- Recent Collection Runs

## Ad Detail Drawer

Open on the right without navigating away.

Include:

- creative preview
- real metadata
- copy/headline
- history tab
- AI tags tab
- evidence links
- watchlist action

## Data Quality UI

Show field coverage as a dedicated strip/card.

Examples:

`CTA 97% | Copy 99% | Title 46% | Destination 17% | Platform 100%`

Warnings must propagate into charts/AI sections that depend on low-coverage fields.

## Chart Rules

- Do not use pie/donut for multi-select fields as if categories are mutually exclusive.
- For `publisher_platform`, label as `% of ads observed on each platform`.
- For page categories, prefer bars/table coverage rather than exclusive-share charts.
- Always show denominator and scope.

## AI UX

Each insight should expose:

- label
- count
- denominator
- percentage
- coverage
- confidence when appropriate
- `ดูหลักฐาน` action

Do not show unsupported "winner" or "performance" badges.
