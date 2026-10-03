import { after, NextResponse, type NextRequest } from "next/server";
import { providerFromSettings } from "@/lib/collect/provider-factory";
import { processOneWork, selectOneDueWork, type AdvanceWorkItem } from "@/lib/collect/advance-scheduler";
import { reconcileCost } from "@/lib/collect/cost";
import { authenticateCollectionAdvance } from "@/lib/collect/machine-auth";
import { advance } from "@/lib/collect/machine";
import { scrubProviderMessage } from "@/lib/collect/provider";
import { withTransaction } from "@/lib/db/privileged";

export const runtime = "nodejs";
export const maxDuration = 300;

type SchedulerConfig = {
  work: AdvanceWorkItem | null;
  actor: string | null;
  actorBuild: string;
};

const safeError = (error: unknown) => scrubProviderMessage(
  error instanceof Error ? error.message : String(error),
);

// A bad setting must not turn one cron tick into an unbounded invocation.
const MAX_TICK_BATCH = 100;
const ADVANCE_DUE = `(
  (
    r.status in ('queued', 'starting', 'provider_start_uncertain', 'running', 'settling', 'importing')
    and r.requires_admin = false
  )
  or (r.status = 'succeeded' and r.media_enqueued_at is null)
) and (r.lease_expires_at is null or r.lease_expires_at < now())
  and (r.next_check_at is null or r.next_check_at <= now())`;
const COST_DUE = `
  r.provider_run_id is not null
  and r.cost_status in ('reserved', 'provisional', 'unreported')
  and r.cost_next_check_at is not null
  and r.cost_next_check_at <= now()`;

/** Select one due item; the state machine and cost reconciler claim again. */
async function dueWork(): Promise<SchedulerConfig> {
  return withTransaction(async (client) => {
    const { rows: settingRows } = await client.query<{ key: string; value: unknown }>(
      "select key, value from public.app_settings where key in ('collector.tick_batch', 'collector.actor', 'collector.actor_build')",
    );
    const settings = new Map(settingRows.map((row) => [row.key, row.value]));
    const value = settings.get("collector.tick_batch");
    const tickBatch = typeof value === "number" && Number.isInteger(value) && value > 0
      ? Math.min(value, MAX_TICK_BATCH)
      : null;
    const text = (key: string) => {
      const setting = settings.get(key);
      return typeof setting === "string" && setting.trim() !== "" ? setting : null;
    };

    if (tickBatch === null) {
      return { work: null, actor: text("collector.actor"), actorBuild: text("collector.actor_build") ?? "" };
    }

    const { rows } = await client.query<AdvanceWorkItem>(
      `select r.id,
              case when ${ADVANCE_DUE} then 'advance' else 'cost' end as kind
         from public.collection_requests r
        where ${ADVANCE_DUE} or ${COST_DUE}
        order by case when ${ADVANCE_DUE} then 0 else 1 end, r.created_at asc, r.id
        limit 1
        for update skip locked`,
    );
    return {
      // `tick_batch` enables scheduling, but one HTTP tick owns one row only.
      work: selectOneDueWork(rows),
      actor: text("collector.actor"),
      actorBuild: text("collector.actor_build") ?? "",
    };
  });
}

async function processWork(config: SchedulerConfig): Promise<void> {
  const item = config.work;
  if (item === null) return;
  if (config.actor === null) {
    console.error("collection advance skipped: collector.actor is not configured");
    return;
  }

  let provider;
  try {
    // One provider-selection point, shared with the request paths: a sweep must
    // never talk to a different collector than the one a person's own request
    // would have used.
    provider = await providerFromSettings();
  } catch (error) {
    console.error("collection advance provider unavailable", { error: safeError(error) });
    return;
  }
  if (provider === null) {
    console.error("collection advance skipped: the collector is not configured");
    return;
  }

  // One bounded transition per HTTP request. Remaining due rows wait for the
  // next scheduler tick, so a request never drains a batch.
  try {
    const outcome = await processOneWork(item, {
      advance: (id) => advance(id, { provider }),
      reconcileCost: (id) => reconcileCost(id, { provider }),
    });
    if (outcome !== null) {
      console.info("collection advance", { id: item.id, kind: item.kind, action: outcome.action });
    }
  } catch (error) {
    // A failed item remains due for the next scheduler tick.
    console.error("collection advance item failed", {
      id: item.id, kind: item.kind, error: safeError(error),
    });
  }
}

/** Machine-only scheduled sweep. It acknowledges work; it never waits for a run. */
export async function POST(request: NextRequest) {
  const auth = authenticateCollectionAdvance(request.headers.get("authorization"));
  if (auth !== "ok") {
    if (auth === "not_configured") console.error("COLLECTION_ADVANCE_TOKEN is not configured");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const config = await dueWork();
    if (config.work !== null) after(() => processWork(config));
    const accepted = config.work === null ? 0 : 1;
    const advanceCount = config.work?.kind === "advance" ? 1 : 0;
    const cost = config.work?.kind === "cost" ? 1 : 0;
    return NextResponse.json({ accepted, advance: advanceCount, cost }, { status: 202 });
  } catch (error) {
    console.error("collection advance scheduling failed", { error: safeError(error) });
    return NextResponse.json({ error: "collection advance unavailable" }, { status: 503 });
  }
}
