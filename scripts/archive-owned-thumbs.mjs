// Copies our ad pictures into storage after an import (local: needs the Facebook token bridge).
//   node --env-file=.env.local --conditions=react-server --experimental-strip-types scripts/archive-owned-thumbs.mjs
import { closePool } from "../lib/db/privileged.ts";
import { ensurePreviewBucket, supabaseArchiveStore } from "../lib/media/store-supabase.ts";
import { archiveOwnedThumbs } from "../lib/owned-ads/thumbs.ts";

await ensurePreviewBucket();
console.log(JSON.stringify(await archiveOwnedThumbs(supabaseArchiveStore())));
await closePool();
