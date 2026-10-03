# Implementation update — executive direction, 2026-10-02

Later same-day direction: the team's handwritten flow replaces the market-first home with the owned library and date/Unit/Page KPIs; market overview remains available separately. See [TEAM_FLOW_2026-10-02.md](TEAM_FLOW_2026-10-02.md). CRM integration was explicitly deferred by the user.

The attached GRILL_2026-10-02_EXEC-DIRECTION.md is business context and contains proposals, open questions, and decisions from another interview. This iteration adopts its confirmed priorities without treating every proposal as an approved paid operation.

Delivered:
- Home begins with ads first observed in the preceding 7 × 24 hours. The count comes from the complete authorized catalog; previews retain their observed run and dataset provenance.
- Current verified data: 10 first-found ads in the window; 892 unique catalog ads. This is not evidence that those advertisers launched ads this week: their Meta start dates are older.
- Competitor library defaults to the entire catalog. Stored search and comparison do not start a provider collection.
- Own library defaults to spend > 0 in the report period: 11,847 ads. All 73,218 ads remain accessible by clearing the checkbox.
- Global pages, trends and page-comparison entries default to the full stored catalog; invalid explicit scopes do not silently widen.
- Both own/rival drawers lead into a pinned comparison. The current selected pair remains visible while browsing.
- Manual drafts are bounded team-entered text, namespaced by authenticated user and exact pair, stored in this browser session. They are not shared team plans and do not change live campaigns.
- Added reversible destination-only migration 0047_owned_library_spend_filter.sql; source database not modified.

Next data work from the document, not claimed complete:
1. Import Unit identities and temporal page memberships from the source, alongside creative/video mediaKey. Historical attribution must follow the date, not current membership.
2. Define and persist team plans with access controls, revisions and before/after measurements; replace browser-only draft storage once that model exists.
3. Confirm tracked competitor pages and a collection cap before enabling scheduled paid collection. Collection currently remains disabled; no new Apify/AI cost was incurred by browsing or verification.
4. Validate Thai AI classification on a labelled dataset before using provider labels in executive summaries. No automatic offer/angle/product-match inference is shown.
5. Exact media groups before approximate cross-page deduplication; never sum rates or erase retained ad-level evidence.
6. Confirm automatic source refresh cadence and hosting; the current local sibling-project bridge still requires source-backed export/authentication for a separate deployment.

Verification:
- Runnable checks: dashboard flow, library flow, catalog read and business comparison pass.
- 36 focused unit checks pass; typecheck and privileged-import boundary pass; lint has only the existing collector-service warnings after the new warning was fixed.
- Final production build passes. All 11 security checks pass against the real client bundle, including credential isolation and the single server-only Apify token reader. Dashboard flow was rerun against the final production server after both mobile fixes and passes.
- Full unit sweep: 514 / 526 pass, 12 fail. Six failures concern the existing destructive-script guard and migration/rollback contracts (including expectations fixed at migration 0042); six concern the old palette contract and module color-token coverage. Those contracts still need reconciliation with the newer owned-ad schema and accepted neutral design. They were not skipped, weakened or relabelled as passed; see .scratch/unit-result.log. This is not a full release-gate pass. No broad destructive DB fixture suite was run against production.
- Visual evidence and accepted deviations are in design-qa.md.

The previous UI_DIRECTION document's Settle/Foreplay direction was accepted, and the executive document now governs which evidence comes first.

