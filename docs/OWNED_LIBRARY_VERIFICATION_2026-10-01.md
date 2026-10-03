# Complete company library — local verification

- Last completed inventory: **73,218 ads across 72 selected source accounts**. Includes inactive/undelivered ads; this is not an active-ad count.
- Stored performance window: **2026-09-02 through 2026-10-01**. Missing measurements remain null; currencies stay per account.
- Website-triggered repeat sync: `ab9bed06-453e-4c93-b07b-003cac178375` → `8a07fffd-5669-413c-ae50-460278fc4309`, both 73,218 ads. Source inventory and destination count were checked and audited per account. Unique snapshot/account/ad keys reject duplicates; a database advisory lock serializes workers.
- Search, account filters, pagination, detail dialog, anonymous refusal and mobile overflow passed in `node scripts/check-owned-library.mjs`. Use `--sync` for the slower real-source repeat-sync check.
- `node --env-file=.env.local scripts/check-owned-library-access.mjs` checks financial-role RLS, filtered RPC authorization and denied direct writes. Running staging rows were verified hidden.
- 15 owned aggregation/import checks passed; TypeScript, targeted lint, privileged-import check and production build passed.

Search initially hit PostgreSQL statement timeouts because non-leakproof ILIKE cannot use the trigram index behind RLS. Migration 0045 provides a narrowly scoped security-definer filtered-page RPC: it checks the caller's analyst/admin role, validates filters and requires a completed snapshot before reading. All direct reads retain RLS. Unfiltered totals reuse the immutable snapshot count. Refresh polling reads progress only, retaining the existing cards until publication.

## Current limits

This is a **local server bridge** to the existing Management project and its stored database snapshots. Source credentials stay server-side; no source data or Meta ads are changed. Before separate-host deployment, replace the bridge with an authenticated export endpoint owned by Management. No unattended collection is enabled. The migration runner also installed the pending collection schedule; that cron job was immediately unscheduled and remains disabled.

Update 2026-10-02: visible company ads now request full post images and the largest available video thumbnail server-side, using the supplied source project's `Token Facebook.txt` when present (optional override `OWNED_MANAGEMENT_ACCESS_TOKEN_FILE`). It falls back to the encrypted database connection when no direct token file exists. Source administrator membership, selected accounts and destination analyst/admin access are checked; no source or Meta data is modified. Positive media lookups are cached for 30 minutes, negative results for one minute, in a bounded local-process cache. Only a visible page is resolved, four ads concurrently.

The first resolution attempt only improved one of four tested ads: Meta returned permission code 10 for many Page post/video reads. Fixed by requesting `thumbnail_url` from the authorized Marketing creative endpoint with `thumbnail_width=1080` and `thumbnail_height=1080` when post/video media cannot be read. This asks Meta to generate the large rendition; it does not rewrite signed CDN URLs.

Real `scripts/check-owned-media.mjs` verification now covers **all 24 first-page ads**: all resolved and loaded at 362–1080 pixels wide, compared with stored 64×64 thumbnails (four old URLs failed). Examples include 1080×1080 promotional images and 720×1280 video previews. The browser was also verified to replace its card images with the larger URLs. Anonymous access and invalid IDs were rejected. Future unavailable creatives still retain the source thumbnail; this does not archive or reconstruct missing media. UX/UI redesign and own-versus-competitor comparison are subsequent work.
