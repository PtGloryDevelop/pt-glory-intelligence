# Owned video playback — 3 October 2026

## User flow

- Home and Command Center mark cards with a real stored `video_id` as **ดูวิดีโอ**. Clicking opens the existing detail dialog, keeping its reporting period and business metrics.
- The full owned library receives `creative_video_id` alongside its existing image resolution. This adds the same affordance without another Graph request or changing the source database.
- Comparison keeps the poster until the user clicks **ดูวิดีโอ** on the selected owned evidence. Rival video playback continues through the existing AdCreative player.
- Grids do not load video files, playback previews, or autoplay. Images retain responsive WebP delivery and original detail pixels for still ads.

## Resolution and observed cause

The existing worker queried the Video `source` field but returned only the poster when that read failed. The actual token returns Meta error code 10 on the tested owned video sources. An official ad preview is available through `GET /{ad_id}/previews` instead.

Use native controls when a direct source is returned. Otherwise resolve `MOBILE_FEED_STANDARD` for the selected real video and embed its preview within the site. `DESKTOP_FEED_STANDARD` left VDO 140 in a permanent skeleton during the actual browser check; the Mobile preview showed and played it.

Only a validated HTTPS iframe URL on `www.facebook.com` or `business.facebook.com`, with `/ads/api/preview_iframe.php`, is returned. Raw provider HTML is never rendered. Credentials, nonstandard ports, token query parameters, alternate hosts and paths are rejected. The iframe is sandboxed; video requests remain limited to one validated owned ad. Positive video cache lifetime is five minutes, unavailable results one minute. Loading/failure messages retain the poster when resolution fails.

Official endpoint reference: [Meta Business SDK Ad.getPreviews](https://github.com/facebook/facebook-nodejs-business-sdk/blob/main/src/objects/ad.js).

## Verification

`node scripts/check-owned-video.mjs` reads existing local data and tests visible players plus actual decoded frames. No collection, sync, source write or Apify run is performed. Signed URLs and cookies are not logged.

Observed desktop playback through the official preview:

| Ad | Decoded dimensions | Duration |
| --- | --- | --- |
| U11 | 576 × 1024 | 52.76 seconds |
| VDO 140 | 720 × 1280 | 63.78 seconds |
| VDO 36 | 720 × 1280 | 60.95 seconds |

U11 also played at a 390px mobile viewport, through the full library detail and in comparison evidence. These checks passed, including no video requests on grid entry and a clearly labeled simulated 503 provider failure that retains the poster. The real direct-file API path remains permission-limited with this token; the worker unit test covers a returned direct source. Preview availability and playback quality remain controlled by Meta, and may change for deleted or restricted ads.

Focused worker tests cover missing stored identity, still-image requests, direct source, denied source fallback and iframe URL restrictions. Focused lint, privileged import check and production build passed. The image delivery regression passed for responsive WebP, original still detail, retina, cache and failure fallback. The existing screenshot-flow check passed for actual five-step selection, full creatives, keyboard reading, mobile and rival video controls.

This is verified locally; it does not represent a production deployment or a full release gate.

## Follow-up: clipped detail action

The UP VDO 75 screenshot exposed a detail grid row that exceeded its available height. At 1280 × 720, its information viewport ended at y=724.59 while the layout ended at y=683. Scrolling that oversized viewport could leave the comparison action clipped. A visible provider iframe alone was insufficient evidence that its containing layout fit.

Bound the desktop grid row with `minmax(0,1fr)` and fit the player to that row. Put the comparison action in a fixed dialog footer outside scrolling content. Mobile uses two natural-height rows in one scrolling body, preventing a tall preview from overlapping information. The provider's own iframe scrolling remains separate.

`node scripts/check-owned-detail-layout.mjs` reproduces the original defect and the mobile overlap, then verifies UP VDO 75 at 1280 × 720, 1152 × 864, 1440 × 1000, 390 × 844 and 844 × 390. All five passed: the full action remains reachable, the dialog has no outer or horizontal overflow, previews fit their panes, Escape/focus return work, and comparison retains the selected ad and return filters. At 1280 × 720 the bounded panes now end at y=610 and the action at y=669, within the dialog ending at y=684. The video playback check, focused lint and production build also passed after the layout correction.
