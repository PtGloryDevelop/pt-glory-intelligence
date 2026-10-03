import type {
  CollectionProvider, DatasetMetadata, DatasetPage, ProviderRead, ProviderRun, RunInputEvidence,
  StartOutcome, StartRequest,
} from "./provider.ts";

/**
 * A provider that answers from arithmetic instead of the network.
 *
 * The browser suite has to drive a whole collection — start, poll, settle,
 * import, finish — against the real server, and doing that against Apify would
 * cost money on every test run. So the server can be told to use this instead.
 *
 * It refuses to exist outside dev and test, and the switch that reaches it
 * requires a second, explicit environment variable. Both guards are here rather
 * than at the call site, because a fake collector reachable from a deployment
 * would be a silent lie about whether anything was collected.
 *
 * Deterministic on purpose: the same request id always produces the same run id
 * and the same ads, so a test can assert counts rather than tolerate them.
 */

/** The two variables that decide this, and nothing else the process happens to carry. */
export type FakeProviderEnv = {
  PT_GLORY_ENV?: string | undefined;
  COLLECTOR_FAKE_PROVIDER?: string | undefined;
  // An environment carries whatever the process was started with; only the two
  // above are read, and the rest is accepted so `process.env` still fits.
  [key: string]: string | undefined;
};

export function fakeProviderEnabled(env: FakeProviderEnv = process.env): boolean {
  const stage = env.PT_GLORY_ENV;
  return (stage === "dev" || stage === "test") && env.COLLECTOR_FAKE_PROVIDER === "1";
}

/** How many ads a fake run returns. Small enough to import in a test, big enough to count. */
export const FAKE_ITEM_COUNT = 12;

export function createFakeProvider(env: FakeProviderEnv = process.env): CollectionProvider {
  if (!fakeProviderEnabled(env)) {
    throw new Error("the fake collector runs only in dev or test, with COLLECTOR_FAKE_PROVIDER=1");
  }

  // Everything a run needs, derived from the tag the state machine sends, so no
  // state has to survive between requests — the server may restart mid-test.
  const runIdFor = (runTag: string) => `FAKE-RUN-${runTag}`;
  const datasetFor = (runTag: string) => `FAKE-DS-${runTag}`;
  const tagOf = (id: string) => id.replace(/^FAKE-(RUN|DS)-/, "");
  const startedAt = "2026-09-11T09:09:12.548Z";

  const run = (runTag: string): ProviderRun => ({
    runId: runIdFor(runTag),
    status: "SUCCEEDED",
    terminal: true,
    succeeded: true,
    datasetId: datasetFor(runTag),
    keyValueStoreId: `FAKE-KV-${runTag}`,
    startedAt,
    finishedAt: "2026-09-11T09:09:39.722Z",
    buildNumber: "0.0.0",
    ceilingUsd: "0.100000",
    maxItems: FAKE_ITEM_COUNT,
    usage: { reportedTotalUsd: "0.010000", chargedItems: FAKE_ITEM_COUNT, chargedStartEvents: 1 },
  });

  /** Ads shaped like the real export, with none of the forbidden metrics. */
  const items = (runTag: string): unknown[] => {
    const seed = runTag.replace(/[^0-9a-f]/gi, "").slice(0, 6) || "000000";
    return Array.from({ length: FAKE_ITEM_COUNT }, (_, index) => ({
      ad_archive_id: `9${seed}${String(index).padStart(4, "0")}`,
      page_id: `7${seed}${String(index % 4).padStart(3, "0")}`,
      page_name: `เพจทดสอบ ${index % 4}`,
      is_active: true,
      start_date: 1_757_000_000 + index,
      publisher_platform: ["FACEBOOK"],
      snapshot: {
        display_format: "IMAGE",
        page_like_count: 1_000 + index,
        page_categories: ["Health/beauty"],
        cta_type: "MESSAGE_PAGE",
        title: `หัวข้อทดสอบ ${index}`,
        body: { text: `เนื้อหาทดสอบ ${index}` },
      },
    }));
  };

  return {
    async startRun(request: StartRequest): Promise<StartOutcome> {
      return { outcome: "started", run: run(request.runTag) };
    },
    async readRun(runId: string): Promise<ProviderRead<ProviderRun>> {
      return { ok: true, value: run(tagOf(runId)) };
    },
    async readRunInput({ keyValueStoreId }): Promise<ProviderRead<RunInputEvidence>> {
      return { ok: true, value: { runTag: tagOf(keyValueStoreId), sourceUrl: null } };
    },
    async readDatasetMetadata(): Promise<ProviderRead<DatasetMetadata>> {
      return { ok: true, value: { itemCount: FAKE_ITEM_COUNT, modifiedAt: startedAt } };
    },
    async readDatasetItemTotal(): Promise<ProviderRead<number>> {
      return { ok: true, value: FAKE_ITEM_COUNT };
    },
    async readDatasetItems(datasetId: string, page): Promise<ProviderRead<DatasetPage>> {
      const all = items(tagOf(datasetId));
      return {
        ok: true,
        value: { items: all.slice(page.offset, page.offset + page.limit), total: all.length },
      };
    },
    async findRunsSince(): Promise<ProviderRead<ProviderRun[]>> {
      // Nothing to reconcile: this provider never loses an answer.
      return { ok: true, value: [] };
    },
  };
}
