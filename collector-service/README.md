# PT Glory Fast Collector Prototype v0.2.14

## v0.2.14 — Long-Run Fast Pagination / Exhaustion Detection

เป้าหมายรอบนี้เปลี่ยนจาก benchmark 100 Ads เป็น workload จริง 500–1,000 Ads ต่อการค้นหา โดยยังรักษา Single-Pivot Direct จาก v0.2.13 แต่เพิ่ม long-run fast path:

- Direct response parse ครั้งเดียว (event listener ไม่ parse fetch เดิมซ้ำ)
- adaptive Direct pause: 8 ms สำหรับ Target >= 500, 12 ms สำหรับ Target >= 300
- ตรวจ `has_next_page=false`, cursor cycle และ duplicate page fingerprint
- เมื่อ Direct stall จะทำ natural pagination + DOM verification เพียง 1 รอบ
- ถ้าไม่มี unique ใหม่จะจบด้วย `source_exhausted`, `cursor_cycle_detected`, `duplicate_page_cycle` หรือ `pagination_stalled` แทน recovery loop ยาว
- ถ้ามี progress จริง จะ resume Direct แบบ bounded continuation epoch
- เก็บ diagnostics throughput เช่น Direct pages/sec และ average attempt latency

## Performance target

100 Ads เป็น smoke test เท่านั้น เป้าหมาย production candidate คือ 500 และ 1,000 Ads โดยต้องไม่ duplicate, ไม่วน cursor, และไม่เสียเวลาหลายสิบวินาทีกับ recovery ที่ไม่เพิ่มข้อมูล ความเร็วจะ benchmark เทียบ Apify จาก workload/query เดียวกัน แต่ไม่รับประกันเวลาตายตัวเพราะ latency ฝั่ง Meta และ VPS เปลี่ยนได้

เกณฑ์เทียบ Apify: ใช้ query / country / status / target เดียวกันอย่างน้อย 3 รอบ แล้วเทียบ median elapsed และ Ads/sec; เป้าหมายคือให้ Collector อยู่ใน performance class เดียวกันก่อน Production โดยไม่แลกกับ duplicate, cursor loop หรือการข้าม quality gate


ต่อยอดจาก v0.2.12 โดย **ไม่แก้ `src/extractor.js` ฝั่ง Stable DOM** และคง Stateful Ready Latch + Target-Aware Direct ไว้ รอบนี้แก้คอขวดที่พบจาก live v0.2.12: Early Direct ทำงานแล้ว แต่ Direct ถูกแบ่งเป็น 2 bursts / 8 attempts และยังมี response-pivot grace wait แบบต่ออนุกรม

## v0.2.13 — Single-Pivot Direct / No Grace Stall

Flow หลัก:

1. Warm-up Retry และจับ `AdLibrarySearchPaginationQuery` เหมือนเดิม
2. หลัง pagination trigger สร้าง **waiter เดียว** สำหรับ ready latch
3. ระหว่างรอ response จะทำ DOM bootstrap 1 ครั้งแบบ overlap; ไม่มี grace wait รอบสอง
4. เมื่อ latch พร้อม Direct จะถือ ownership ของ `template + cursor` ชั่วคราว
5. Natural pagination response ระหว่าง Direct ยัง merge rows ได้ แต่จะไม่เขียนทับ cursor/template ของ Direct
6. ถ้า Direct fetch สะดุด 1 ครั้ง จะ retry **ใน burst เดิม**; ออกจาก burst เมื่อ transport fail ซ้ำ, cursor ไม่เดิน, progress หยุดซ้ำ หรือครบ Target
7. Direct fetch timeout default 4.5s (ปรับได้ด้วย `directFetchTimeoutMs`, clamp 2.5–8s) เพื่อลด stall จาก request เดียว
8. Stable DOM fallback / late re-entry ยังอยู่ถ้า Direct มี stop condition จริง

ไม่มี proxy/fingerprint spoofing, ไม่หลบ login/checkpoint/anti-bot และไม่ export cookies, raw auth headers, raw GraphQL request body หรือ session-bound secrets

## Diagnostics ใหม่

ใน `network_diagnostics.network_dominant`:

- `single_pivot_direct`
- `direct_transient_retries`
- `direct_transport_failures`
- `direct_fetch_timeout_ms`
- `direct_elapsed_ms`
- `direct_attempt_ms_total`
- `direct_attempt_ms_max`
- `request_templates_ignored_during_direct`
- `natural_responses_ignored_during_direct`

`response_pivot_grace_wait_ms` ยังอยู่เพื่อเทียบย้อนหลัง แต่ v0.2.13 จะไม่เพิ่มค่านี้อีก

## Live baseline ก่อน v0.2.13

- v0.2.5: 100 Ads ≈ 22.84s
- v0.2.9: 100 Ads ≈ 25.83s
- v0.2.10: 100 Ads ≈ 26.38s
- v0.2.11: 100 Ads ≈ 43.72s; 2 scrolls; Direct 7 pages
- v0.2.12: 100 Ads ≈ 36.23s; Warm-up ≈ 10.58s; Early Direct 6 pages; **2 bursts / 8 attempts / 7 successes**; latch + response wakeup ทำงานแล้ว

เป้าหมาย v0.2.13 คือให้รอบปกติจบด้วย `direct_bursts = 1`, `direct_stop_reason = accepted_target_reached`, `response_pivot_grace_wait_ms = 0` และไม่กลับไป scroll/burst รอบใหม่เพราะ transport failure เพียงครั้งเดียว

## Run

```powershell
npm install
npm start
```

เปิด `http://localhost:8787` แล้วใช้ Fast Network-first, Google Chrome บนเครื่อง, Target 100

## Tests

```powershell
npm run test:network
npm run test:access
npm run test:graphql
npm run test:direct
npm run test:minscroll
npm run test:untiltarget
npm run test:reentry
npm run test:targetaware
npm run test:early
npm run test:responsepivot
npm run test:latch
npm run test:singlepivot
npm run audit:fixture -- <path-to-json>
```
