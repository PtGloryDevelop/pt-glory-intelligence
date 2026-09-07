-- Rolls back the durable-media archive TABLE only.
--
-- What this does NOT do, deliberately: it does not touch the storage bucket.
-- Object storage is outside the database transaction, a DROP cannot un-delete
-- bytes, and deleting a bucket's contents from a schema rollback would be a
-- destructive side effect nobody asked for. After this migration is reverted the
-- objects remain in `pt-glory-media-previews`, orphaned but intact, and
-- re-applying 0023 leaves them recoverable by re-running the archival drain
-- (deterministic storage paths make that converge).
--
-- Clearing the bucket, if that is ever wanted, is a separate deliberate action.
drop index if exists public.media_assets_status_idx;
drop index if exists public.media_assets_observation_idx;
drop index if exists public.media_assets_queue_idx;
drop table if exists public.media_assets;
