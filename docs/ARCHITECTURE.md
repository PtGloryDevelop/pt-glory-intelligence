# Architecture

## Logical Flow

Collector
→ Import/API ingestion
→ Validation
→ Normalization
→ Master entities
→ Dataset membership
→ Historical observations
→ Deterministic metrics
→ AI interpretation
→ Evidence layer
→ Dashboard / Deep Search / Reports

## Recommended Platform

- PostgreSQL / Supabase
- server-side API or server functions for secrets and business logic
- frontend web app
- background-job worker/queue pattern for long-running work
- object storage only where long-term media retention is explicitly required

## Database Domains

### Research organization

- categories
- datasets
- collection_runs

### Master entities

- ads
- pages
- brands
- creatives

### Relationships/history

- dataset_ads
- brand_pages
- ad_observations
- page_observations
- ad_creatives

### Intelligence

- tags/taxonomies
- ad_tags
- ai_analysis_runs
- ai_insights
- ai_evidence

### Operations

- background_jobs
- saved_views
- watchlists
- audit_logs

## Media Strategy

Meta CDN URLs may expire. Do not automatically mirror every image/video without a storage policy.

Recommended staged policy:

- always store media metadata/URLs when legal and available
- optionally preserve thumbnails/previews for watched/high-value creatives
- make full-media archival a separate configurable feature with storage/cost controls

## Source Capability Model

Different collectors can support different fields.

Maintain a source capability map so the UI can know whether a metric is:

- supported
- partially supported
- unavailable

Never expose a metric merely because another source type could theoretically provide it.
