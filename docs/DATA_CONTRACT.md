# Data Contract — PT Glory Meta Ads

## Canonical Ad Input

The normalizer should accept collector variants and map them to a canonical internal structure.

### Identity

- `ad_archive_id` — required stable ad identity
- `collation_id` — optional
- `collation_count` — integer >= 0 when available

### Page

- `page_id`
- `meta_page_id`
- `page_name`
- `page_profile_uri`
- `page_profile_numeric_id`
- `page_like_count`
- `page_categories[]`

Keep `meta_page_id` and `page_profile_numeric_id` separate.

### State and dates

- `is_active`
- `start_date`
- `end_date` — normalized business meaning only
- `network_end_date_raw` — preserve upstream raw date separately

Rule: when `is_active = true`, do not treat raw upstream end-like date as confirmed stop date.

### Creative and messaging

- `display_format`
- `cta_type`
- `cta_text`
- `title`
- `body_text`
- `caption`
- `link_url`
- `link_description`

### Distribution

- `publisher_platform[]`

This is multi-value.

### Media

- `images[]`
  - `original_image_url`
  - `resized_image_url`
  - optional crops/metadata
- `videos[]`
  - `video_hd_url`
  - `video_sd_url`
  - `video_preview_image_url`
- `cards[]`
  - title/body/link/cta/media fields when available

### Collection metadata

- `source`
- `collector_version`
- `collection_run_id`
- `collected_at`
- `query`
- `country`
- `active_status`
- `media_type`
- `stop_reason`

## Canonical Storage Principles

- Master ad identity: `ad_archive_id`
- Many datasets can reference one ad
- Observations preserve historical states
- Source provenance is retained
- Raw/debug/session-sensitive data is not stored in normal business tables

## Forbidden Derived Assumptions

Do not derive:

- performance
- engagement
- conversions
- sales
- spend
- reach
- impressions

from ad age, reuse, page likes, copy, or ad count.
