# Real source integration test — 1 October 2026

The owner requested real-data testing before further UI redesign.

## Company ads

- Source: Ads Management's Supabase stored snapshots. No Meta call or source database write.
- Operator: existing active source workspace administrator `ptglory.develop@gmail.com`.
- Authorization: reused `loadWorkspaceInsights` and its primary-connection, selected-account and effective Page/UNIT scope; one selected THB account.
- Period: 25 September–1 October 2026. Latest source snapshot at 1 October 2026 09:17:41 UTC.
- Read 506 authorized ad-day rows; imported the top 30 ads by spend as one test report.
- Verified source/destination ad IDs, spend, impressions and purchase value match. Missing values stay null; no rates were averaged.
- Report: `24949352-71f9-4efc-93a6-de9b6a9ccd88`.
- Uses the existing authenticated report import and RLS. This is an operator-run snapshot test, **not** a deployed website-to-website export API or recurring sync. The existing report source label is the generic team report label; the report name identifies Ads Management.

## Apify

- Real Actor: `curious_coder~facebook-ads-library-scraper`, build `2.7.26`.
- Query: วิตามิน, Thailand, active, requested/import cap 10.
- One admission through `/api/collections`, authenticated as the requested trial analyst.
- Request: `6b9ad7f7-0ec3-4ef9-b14b-0b58dd6a85c9`; run: `p2NMwcX2LL9oMyuiH`.
- Provider returned 28 items (Actor per-source limits can overshoot); the existing importer capped the persisted result to 10 ads / 6 pages, no quarantine.
- Dataset: `99cad727-2ecf-4cb7-b572-8fbcd9f4c7aa`.
- Final reconciled cost: USD 0.021050. Two agreeing observations, separated by the configured settlement window, after normalization to PostgreSQL numeric(12,6).
- Test budget/month: USD 1, one run ceiling: USD 1, concurrency 1. New admission disabled immediately after acceptance. No recurring scheduler deployed or enabled.
- Applied missing migrations 0037–0040 and company report migration 0042. Migration 0037 now preserves preconfigured settings with `ON CONFLICT DO NOTHING`.
- Found and fixed settlement comparing raw sub-micro floating-point noise against six-decimal stored cost. Regression checks cover noise, rounding, overflow and invalid figures; budget admission arithmetic remains unchanged.

## Verification

- Both authenticated report/dataset APIs returned 200 with 30 and 10 rows.
- Browser checks confirmed company grid/pagination (24 first-page cards) and 10 competitor cards in the same application.
- 75 focused tests passed, including budget, cost precision, actual Actor adapter and company import.
- Typecheck and targeted lint passed. Browser evidence/results are under ignored `test-artifacts/integration/`; no source credentials or provider tokens are stored there.
- Production build and privileged-import boundary check passed.

Repeatable checks: `scripts/test-management-import.mjs`, `scripts/test-apify-live.mjs` (start once, tick/status thereafter), `scripts/check-integration-ui.mjs`. The live-run script stores its request key before sending and refuses another start while that artifact exists. Do not delete the artifact to retry an ambiguous start; use the saved key to reconcile it.
