# Owned Page names — 3 October 2026

## Observed blocker

After the user showed Gaba assigned to ADS_INSIGHTS under **Facebook Pages**, the 15:15 Bangkok recheck successfully read Page `1357831550737744` (HTTP 200): `Gaba Biozen - บำรุงสมองและระบบประสาท`. The existing name-only worker propagated that verified name to 300 destination daily records and 73 destination inventory ads, retaining all financial fields and IDs. Counts are now **4 named / 142 inventory Pages** and **3 named / 73 daily Pages**. Other 138 unnamed directory Pages still returned code 10. No source writes, Meta permission changes or paid collection were made. The `/me` response named ADS_INSIGHTS; its returned ID was not treated as a direct equality check against the Business Settings UI ID, since this check did not establish their ID scopes.

Live recheck on 3 October 2026 at 14:56 Bangkok time used the configured Facebook token directly. All 139 unnamed Pages in the authorized selected-account directory returned Graph error 10; no new names were resolved. A separate control read of Page `1229305836930818` returned HTTP 200 and its actual name, while Pages `1024657330738044` and `1053692204505218` returned HTTP 400 / code 10. This proves the token works for the control Page, not that it can read the remaining assets. Stored totals remain 3 named / 142 inventory Pages and 2 named / 73 daily Pages. This was GET-only verification; no permission grants, source writes or destination name changes were made. Secret-free evidence is in ignored `test-artifacts/page-names/facebook-live-check.json`.

The latest imported snapshot has 73 Pages in the daily-performance picker and 142 Pages in inventory. Only 2 daily Pages / 3 inventory Pages have stored names. The selected-account directory in Management contains 165 account/Page pairs and the same 3 named Pages. The missing labels are also missing at source; they are not a browser rendering issue.

The supplied Facebook token is valid, is a `SYSTEM_USER` token, and identifies the System User as **ADS_INSIGHTS**. `pages_read_engagement` and `pages_show_list` are already granted. Reads of `1024657330738044` and `1053692204505218` with `fields=id,name` returned Graph error **10**; Page `1229305836930818` returned its actual name. Selected-account `promote_pages` probes returned either an empty list or an already-known Page.

These observations support checking assignment of the missing Page assets to ADS_INSIGHTS. They do not prove that every missing Page has the same cause. No Meta access grants, Business ownership changes, or source database writes were made.

## Operator steps

1. A Business Portfolio administrator opens Meta Business Settings and selects the portfolio associated with the System User/token.
2. In Users → System users, select **ADS_INSIGHTS** and assign the relevant **Page** assets. Having an ad account assigned alone does not demonstrate that the Page node can be read.
3. If a Page is absent from that portfolio, verify the Page owner and obtain the appropriate Page access/partner assignment through its administrator. Do not transfer ownership just to populate a label. Enable the Page access needed to read its information/insights; no publishing or deletion rights are needed by this name reader.
4. Return to the owned-performance filter and click **อัปเดตชื่อเพจ**. A successful `/{page_id}?fields=id,name` read is the acceptance check. Existing token scopes are already granted; test asset assignment before replacing the token.

## Implementation

- `ownedPageChoices` displays real known names first. Missing labels explicitly say `ยังไม่มีชื่อเพจ`; duplicate names carry their distinct IDs. Option values remain Page IDs.
- The separate name-only refresh is guarded by the analyst/admin route, validates the active source administrator and selected account scope, and uses a sync advisory lock before any provider work. It reads Page names with a server-only Bearer token, bounded concurrency and a timeout. Mismatched response IDs are rejected; provider denials never erase an existing name.
- The refresh changes only `page_name` in the latest destination daily/inventory snapshot and its inventory JSON, with an audit entry for changed rows. It does not import ads, modify metrics, Page IDs or dated UNIT assignments, or write to Management. Search text follows its generated `page_name` column.
- Normal owned-library imports also resolve and propagate known names per Page ID. Optional metadata failure does not stop the financial/inventory import.
- The local source-project bridge still requires its configured files on this host. Moving it to another host requires the source-owned authenticated export described in the existing ADR.

For a local operator, the same name-only refresh is available as:

```powershell
node --env-file=.env.local --experimental-strip-types scripts/refresh-owned-page-names.mjs
```

## Validation

- Focused tests cover explicit missing names, duplicate-name identity, Page-scoped metadata enrichment, provider denial, returned-ID mismatch, selected-account scope and retained known names. Existing source-row/performance tests pass.
- Production build and privileged-import check pass. Browser check uses real stored Page choices and filters; its partial-refresh result is an explicit fixture to avoid another batch of Graph calls before Page access is assigned. No claim that the missing names have already been resolved.
