/**
 * Archive queue health, for an operator at a terminal.
 *
 * Read-only. The number that matters is `expiringWithin24h`: a large queue is
 * fine, a queue with deadlines close is not.
 */
import { closePool } from "../lib/db/privileged.ts";
import { archiveHealth, videoReadingHealth, videoReadingWarnings } from "../lib/media/health.ts";

const health = await archiveHealth();
const rows = Object.entries(health).map(([key, value]) => ({ metric: key, value: value ?? "—" }));
console.table(rows);

// One line an operator can act on without reading the table.
if (health.pending === 0 && health.failedRetryable === 0) {
  console.log("queue is empty");
} else if (health.expiringWithin24h > 0) {
  console.log(
    `WARNING ${health.expiringWithin24h} source(s) expire within 24h · earliest ${health.earliestExpiry}`,
  );
} else {
  console.log(`${health.pending} pending, nothing urgent`);
}

// The video reading queue (deploy/video-reader on the VPS).
const video = await videoReadingHealth();
console.log("\nvideo readings");
console.table(Object.entries(video).map(([key, value]) => ({ metric: key, value: value ?? "—" })));
const warnings = videoReadingWarnings(video);
for (const warning of warnings) console.log(`WARNING ${warning}`);
if (warnings.length === 0) console.log(`${video.pending} clip(s) pending, nothing urgent`);
await closePool();
