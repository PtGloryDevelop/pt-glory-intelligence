import {
  isTerminalStatus, normalizeStatus,
  type CollectionProvider, type DatasetMetadata, type DatasetPage, type ProviderRead,
  type ProviderRun, type RunInputEvidence, type StartOutcome, type StartRequest,
} from "./provider.ts";

/**
 * A provider that answers from a script instead of the network (C06).
 *
 * Every outcome the real client can produce is expressible here, including the
 * one that matters most: a start whose outcome is unknown because the answer
 * never arrived. Tests and local development use this; production never does.
 *
 * It refuses to exist outside dev and test. A mock collector reachable from a
 * real deployment would be a silent lie about whether anything was collected.
 */

export type MockScript = {
  /** What the next start returns. Defaults to a started run. */
  start?: StartOutcome | ((request: StartRequest) => StartOutcome);
  run?: ProviderRun | null;
  runInput?: RunInputEvidence | null;
  datasetMetadata?: DatasetMetadata | null;
  items?: unknown[];
  itemTotal?: number | null;
  runsSince?: ProviderRun[];
};

export type MockProvider = CollectionProvider & {
  /** Every call the code under test made, in order. */
  readonly calls: { operation: string; detail?: string }[];
  /** How many starts were issued. The number that must never exceed one. */
  readonly startCount: number;
};

export function mockRun(overrides: Partial<ProviderRun> = {}): ProviderRun {
  const status = normalizeStatus(overrides.status ?? "SUCCEEDED");
  return {
    runId: "mock-run-1",
    status,
    terminal: isTerminalStatus(status),
    succeeded: status === "SUCCEEDED",
    datasetId: "mock-dataset-1",
    keyValueStoreId: "mock-store-1",
    startedAt: "2026-09-11T09:09:12.548Z",
    finishedAt: status === "SUCCEEDED" ? "2026-09-11T09:09:39.722Z" : null,
    buildNumber: "0.0.0",
    ceilingUsd: "0.100000",
    maxItems: 133,
    usage: { reportedTotalUsd: null, chargedItems: null, chargedStartEvents: null },
    ...overrides,
  };
}

export function createMockProvider(
  script: MockScript = {},
  /** Only the one variable matters here, so the double is easy to drive in tests. */
  env: Readonly<Record<string, string | undefined>> = process.env,
): MockProvider {
  const stage = env.PT_GLORY_ENV;
  if (stage !== "dev" && stage !== "test") {
    throw new Error("the mock collector runs only when PT_GLORY_ENV is dev or test");
  }

  const calls: { operation: string; detail?: string }[] = [];
  let startCount = 0;
  const record = (operation: string, detail?: string) => { calls.push({ operation, detail }); };
  const missing = <T>(what: string): ProviderRead<T> => ({ ok: false, reason: "not_found", detail: `mock has no ${what}` });

  return {
    calls,
    get startCount() { return startCount; },

    async startRun(request: StartRequest): Promise<StartOutcome> {
      startCount += 1;
      record("startRun", request.runTag);
      const scripted = typeof script.start === "function" ? script.start(request) : script.start;
      return scripted ?? { outcome: "started", run: mockRun() };
    },

    async readRun(runId: string): Promise<ProviderRead<ProviderRun>> {
      record("readRun", runId);
      return script.run ? { ok: true, value: script.run } : missing("run");
    },

    async readRunInput({ keyValueStoreId }): Promise<ProviderRead<RunInputEvidence>> {
      record("readRunInput", keyValueStoreId);
      return script.runInput ? { ok: true, value: script.runInput } : missing("run input");
    },

    async readDatasetMetadata(datasetId: string): Promise<ProviderRead<DatasetMetadata>> {
      record("readDatasetMetadata", datasetId);
      return script.datasetMetadata
        ? { ok: true, value: script.datasetMetadata } : missing("dataset");
    },

    async readDatasetItemTotal(datasetId: string): Promise<ProviderRead<number>> {
      record("readDatasetItemTotal", datasetId);
      const total = script.itemTotal ?? script.items?.length ?? null;
      return total === null ? missing("item total") : { ok: true, value: total };
    },

    async readDatasetItems(datasetId: string, page): Promise<ProviderRead<DatasetPage>> {
      record("readDatasetItems", `${datasetId}#${page.offset}+${page.limit}`);
      const all = script.items ?? [];
      return { ok: true, value: { items: all.slice(page.offset, page.offset + page.limit), total: all.length } };
    },

    async findRunsSince(since: Date, limit: number): Promise<ProviderRead<ProviderRun[]>> {
      record("findRunsSince", since.toISOString());
      return { ok: true, value: (script.runsSince ?? []).slice(0, limit) };
    },
  };
}
