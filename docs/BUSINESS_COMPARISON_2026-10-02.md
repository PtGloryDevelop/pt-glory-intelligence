# Company / competitor comparison

`/compare/ads` is restricted to analysts/admins and linked from the company library and navigation. It reuses the company library and dataset read endpoints under the user's JWT/RLS. No new provider collection or Meta mutation is triggered by comparing.

Select a company ad from the full searchable inventory and a competitor observation from a chosen dataset. Each side shows its recorded creative, copy, identity and provenance. Company metrics include actual spend, conversations, conversation cost and Meta-attributed ROAS. Competitor spend/sales/ROAS remain unavailable. Selection survives filters and pagination; changing competitor datasets clears that competitor selection.

The business brief is manually authored: product/need, both offers, chosen response, hypothesis and evaluation window. Download exports a Markdown brief with source IDs, dates, copy and company metrics. It is not an automated effectiveness verdict and does not change real ads. Page tracking links reuse the existing page/watchlist workflow.

`node scripts/check-business-comparison.mjs` verifies real company and Apify selections, retained evidence after filtering, brief export, mobile overflow and anonymous redirect. Production build, TypeScript and targeted lint passed.

## Image latency correction

Large Marketing creative thumbnails are requested first, skipping Page/video requests when unnecessary. The company grid updates in batches of four instead of waiting for all 24. The library read endpoint now embeds cached large URLs in both unfiltered and filtered results, so repeat visits need not flash old thumbnails. Cache remains bounded and process-local: first-time images still need a Meta round trip and restarting the server resets it.

`scripts/check-owned-media.mjs` checks all 24 first-page large images, warm library URL reuse and actual browser replacement. Current images resolve at 362–1080 pixels wide; missing/denied creatives retain the original fallback.
