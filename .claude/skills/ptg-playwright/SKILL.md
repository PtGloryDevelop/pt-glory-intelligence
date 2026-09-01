---
name: ptg-playwright
description: Use for browser-level Playwright QA of PT Glory critical user journeys, persistence, data accuracy, error states, and role restrictions.
---

# PT Glory Playwright QA

Validate the real user journey in a browser.

Do not limit QA to component rendering.

## Typical Journey

Login
→ choose/create Category
→ import JSON
→ preview
→ save
→ open Dataset
→ filter Ads Explorer
→ open Ad Detail Drawer
→ inspect evidence/history
→ return Overview
→ run AI Analysis if in scope
→ open AI Evidence

## Verify

- loading states
- partial/error states
- filters and URL/state behavior
- drawer/modal close/back behavior
- no fake data fallback
- real database persistence
- reload persistence
- role restrictions
- responsive usability for supported desktop sizes

Capture reproducible failures and create regression tests for fixed defects.
