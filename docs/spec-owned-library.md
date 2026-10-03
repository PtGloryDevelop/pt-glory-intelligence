# Complete owned-ad library

## Problem Statement
The trial report contains only 30 ads from one account. Marketing and management need the company's complete accessible inventory, alongside competitor research, without opening Ads Management.

## Solution
An explicitly triggered server sync reads the source workspace's selected accounts and stored creative inventory/performance. The library shows the last completed sync through server pagination; a failed refresh cannot replace usable data.

## User Stories
1. As a marketer, I want ads from every selected source account so I can inspect the company's actual inventory.
2. As a marketer, I want ads without delivery to remain visible so creative inventory is complete.
3. As an executive, I want unknown metrics to stay unknown so I do not interpret missing data as zero.
4. As a marketer, I want search and account/status filters across the entire library, not just the current page.
5. As a marketer, I want pages of results so thousands of ads do not load into my browser at once.
6. As an executive, I want source dates and sync progress so I know what the numbers cover.
7. As a marketer, I want refresh to be repeatable without duplicate visible ads.
8. As a team member, I want the previous completed library available if a refresh fails.
9. As an administrator, I want financial data restricted to analysts/admins and source credentials kept on the server.
10. As an operator, I want concurrent sync requests to share one job instead of racing.
11. As an executive, I want each account's currency retained without combining unlike money.
12. As a marketer, I want thumbnails, creative copy and identity available for subsequent competitor comparison.

## Implementation Decisions
- Keep uploaded reports as a separate fallback. Store synced inventory as one row per snapshot/account/ad with indexed filters.
- Use the source's authorized snapshot loader and primary connection; a configured, existing active source administrator grants company-wide access to selected accounts. No Meta mutation or page-render provider call.
- Initial local server connection uses the existing sibling source project. Replace this local bridge with a source-owned authenticated export API before deployment on a separate host.
- Publish a snapshot only after every selected account has been read and counted. Keep the previous completed snapshot on failure. One worker holds a database advisory lock.
- Store totals and compute ratios from them. Record the latest 30-day stored-data window and current source snapshot time. Creative inventory may be older than that window.
- Preserve Page identity as metadata. Effective Page/UNIT authorization remains in the source loader; current product classification and product filtering are deferred.

## Testing Decisions
Test source aggregation with incomplete metrics and orphan delivery rows; use real source/destination ID counts per account, authenticated API pagination/search, repeat-sync deduplication and browser opening of thousands of results. Viewer reads/writes must be rejected.

## Out of Scope
Visual redesign, new Meta credentials or actions, scheduled unattended refresh, deployed cross-site export, competitor ROAS and CRM-derived profit.
