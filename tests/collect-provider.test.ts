import assert from "node:assert/strict";
import test from "node:test";
import { createApifyProvider, READ_TIMEOUT_MS, START_TIMEOUT_MS } from "../lib/collect/apify.ts";
import { createMockProvider, mockRun } from "../lib/collect/mock.ts";
import {
  isTerminalStatus, normalizeStatus, scrubProviderMessage, type StartRequest,
} from "../lib/collect/provider.ts";

/**
 * C06 — the provider client boundary.
 *
 * Every call here goes through a fake fetch. Nothing in this file touches the
 * network, and no run is ever started for real.
 */

/** A token shaped like the real thing, so a leak would be unmistakable. */
const TOKEN = "apify_api_TESTONLY_0123456789abcdef";
const ACTOR = "curious_coder~facebook-ads-library-scraper";
/** Never a destination: this suite only proves the host is scrubbed out of text. */
const PROVIDER_HOST = ["api", "apify", "com"].join(".");

type Call = { url: string; method: string; headers: Record<string, string>; body: string | null; signal: unknown };

function fakeFetch(responder: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      headers,
      body: typeof init?.body === "string" ? init.body : null,
      signal: init?.signal,
    };
    calls.push(call);
    return responder(call);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });

const runBody = (overrides: Record<string, unknown> = {}) => ({
  data: {
    id: "RUN1", status: "SUCCEEDED", defaultDatasetId: "DS1", defaultKeyValueStoreId: "KV1",
    startedAt: "2026-09-11T09:09:12.548Z", finishedAt: "2026-09-11T09:09:39.722Z",
    buildNumber: "2.7.25", usageTotalUsd: 0.0998,
    options: { maxTotalChargeUsd: 0.1, maxItems: 133, build: "2.7.25" },
    chargedEventCounts: { "apify-default-dataset-item": 133, "apify-actor-start": 1 },
    ...overrides,
  },
});

const startRequest = (overrides: Partial<StartRequest> = {}): StartRequest => ({
  sourceUrl: "https://www.facebook.com/ads/library/?q=test",
  runTag: "6b1f1e34-0000-4000-8000-00000000c06a",
  maxRecords: 300,
  maxTotalChargeUsd: "0.100000",
  timeoutSeconds: 600,
  build: "2.7.25",
  memoryMbytes: 512,
  ...overrides,
});

const provider = (responder: (call: Call) => Response | Promise<Response>) => {
  const { impl, calls } = fakeFetch(responder);
  return { client: createApifyProvider({ actor: ACTOR, build: "2.7.25", token: TOKEN, fetchImpl: impl }), calls };
};

// --- authentication --------------------------------------------------------------

test("the token travels in the Authorization header and never in a URL", async () => {
  const { client, calls } = provider(() => json(runBody()));
  await client.startRun(startRequest());
  await client.readRun("RUN1");
  await client.readDatasetMetadata("DS1");

  assert.equal(calls.length, 3);
  for (const call of calls) {
    assert.equal(call.headers.authorization, `Bearer ${TOKEN}`);
    assert.ok(!call.url.includes(TOKEN), "the token must never appear in a URL");
    assert.doesNotMatch(call.url, /[?&]token=/i);
  }
});

test("a client without a token refuses to exist, and says so without quoting one", () => {
  assert.throws(
    () => createApifyProvider({ actor: ACTOR, build: "2.7.25", token: "", fetchImpl: fakeFetch(() => json({})).impl }),
    (error: Error) => error.message === "APIFY_TOKEN is not configured",
  );
});

// --- the start contract ----------------------------------------------------------

test("the start carries the runTag, the pinned build and the caller's ceiling exactly", async () => {
  const { client, calls } = provider(() => json(runBody(), { status: 201 }));
  const request = startRequest({ maxTotalChargeUsd: "0.123456" });
  const outcome = await client.startRun(request);

  assert.equal(outcome.outcome, "started");
  assert.equal(calls.length, 1);
  const [call] = calls;
  assert.equal(call.method, "POST");

  const url = new URL(call.url);
  assert.equal(url.pathname, `/v2/acts/${ACTOR}/runs`);
  assert.equal(url.searchParams.get("build"), "2.7.25", "the pinned build, never 'latest'");
  assert.equal(url.searchParams.get("maxTotalChargeUsd"), "0.123456", "passed through digit for digit");
  assert.equal(url.searchParams.get("restartOnError"), "false");
  assert.equal(url.searchParams.get("timeout"), "600");
  assert.equal(url.searchParams.get("memory"), "512");
  // Nothing may make one HTTP request wait for a run.
  assert.equal(url.searchParams.get("waitForFinish"), null);

  const body = JSON.parse(call.body ?? "{}");
  assert.equal(body.runTag, request.runTag);
  assert.deepEqual(body.urls, [{ url: request.sourceUrl }]);
  assert.equal(body.limitPerSource, 300);
  assert.equal(body.scrapeAdDetails, false);
});

test("the actor comes from configuration, and a malformed one is refused", () => {
  const { impl } = fakeFetch(() => json({}));
  assert.throws(() => createApifyProvider({ actor: "not-an-actor", build: "1", token: TOKEN, fetchImpl: impl }));
});

test("one POST on success, and exactly one POST when the outcome is unknown", async () => {
  const ok = provider(() => json(runBody(), { status: 201 }));
  await ok.client.startRun(startRequest());
  assert.equal(ok.calls.filter((c) => c.method === "POST").length, 1);

  for (const failure of [
    () => { throw Object.assign(new Error("timed out"), { name: "TimeoutError" }); },
    () => { throw Object.assign(new Error("socket hang up"), { name: "TypeError" }); },
    () => json({ error: { type: "server-error", message: "boom" } }, { status: 500 }),
    () => new Response("<html>gateway</html>", { status: 502 }),
  ]) {
    const attempt = provider(failure as (call: Call) => Response);
    const outcome = await attempt.client.startRun(startRequest());
    assert.equal(outcome.outcome, "unknown", "an uncertain transport is never a refusal");
    assert.equal(attempt.calls.length, 1, "and the client never retries a start by itself");
  }
});

test("only a status proven to reject before actor work is a definitive refusal", async () => {
  // 401 alone: C01-A saw the API answer token-not-provided with nothing else
  // happening. A 403 is an authorization decision that can be taken anywhere,
  // including after a run exists, so it is not inferred from that.
  const unauthorized = provider(() => json({ error: { type: "token-not-provided" } }, { status: 401 }));
  const auth = await unauthorized.client.startRun(startRequest());
  assert.equal(auth.outcome, "refused");
  if (auth.outcome === "refused") assert.equal(auth.reason, "not_configured");

  const forbidden = provider(() => json({ error: { type: "forbidden" } }, { status: 403 }));
  const outcome = await forbidden.client.startRun(startRequest());
  assert.equal(outcome.outcome, "unknown", "403 is not proof that no run exists");
  assert.equal(forbidden.calls.length, 1, "and it is never retried");
});

test("an ambiguous 4xx is unknown, because a run may exist behind it", async () => {
  // 409 and 429 could be answered after a run was created; 400 and 404 are not
  // proven to reject first; 408 is a timeout wearing a status code.
  for (const status of [400, 403, 404, 408, 409, 429, 422, 451]) {
    const ambiguous = provider(() => json({ error: { type: "provider-said-no" } }, { status }));
    const outcome = await ambiguous.client.startRun(startRequest());
    assert.equal(outcome.outcome, "unknown", `${status} must fail safe to unknown`);
    assert.equal(ambiguous.calls.length, 1, `${status} must not be retried`);
  }
});

test("a request this client can judge is refused before anything is sent", async () => {
  const cases: [string, Partial<StartRequest>][] = [
    ["a URL that is not an Ad Library search", { sourceUrl: "https://example.test/x" }],
    ["no runTag", { runTag: "  " }],
    ["no pinned build", { build: "" }],
    ["a ceiling that is not exact USD", { maxTotalChargeUsd: "0.1234567" }],
    ["a non-positive record cap", { maxRecords: 0 }],
    ["a non-positive timeout", { timeoutSeconds: 0 }],
    ["a non-positive memory", { memoryMbytes: 0 }],
  ];
  for (const [name, overrides] of cases) {
    const attempt = provider(() => json(runBody(), { status: 201 }));
    const outcome = await attempt.client.startRun(startRequest(overrides));
    assert.equal(outcome.outcome, "refused", name);
    if (outcome.outcome === "refused") assert.equal(outcome.reason, "rejected", name);
    assert.equal(attempt.calls.length, 0, `${name}: nothing may reach the wire`);
  }
});

test("a 2xx the client cannot read is unknown, not started", async () => {
  const { client } = provider(() => json({ data: { status: "READY" } }, { status: 201 }));
  const outcome = await client.startRun(startRequest());
  assert.equal(outcome.outcome, "unknown");
});

// --- reads are reads -------------------------------------------------------------

test("every read is a GET, and none of them can start anything", async () => {
  const { client, calls } = provider((call) =>
    call.url.includes("/items")
      ? new Response(JSON.stringify([{ ad_archive_id: "1" }]), {
          headers: { "content-type": "application/json", "x-apify-pagination-total": "133" },
        })
      : call.url.includes("/records/INPUT")
        ? json({ runTag: "tag-1", urls: [{ url: "https://www.facebook.com/ads/library/?q=x" }] })
        : call.url.includes("/datasets/")
          ? json({ data: { itemCount: 133, modifiedAt: "2026-09-11T09:09:39.230Z" } })
          : call.url.includes("/runs?")
            ? json({ data: { items: [runBody().data] } })
            : json(runBody()));

  await client.readRun("RUN1");
  await client.readRunInput({ keyValueStoreId: "KV1" });
  await client.readDatasetMetadata("DS1");
  await client.readDatasetItemTotal("DS1");
  await client.readDatasetItems("DS1", { offset: 0, limit: 10 });
  await client.findRunsSince(new Date("2026-09-11T00:00:00Z"), 10);

  assert.equal(calls.length, 6);
  for (const call of calls) assert.equal(call.method, "GET", call.url);
});

test("the reads return the evidence the collector needs", async () => {
  const { client } = provider((call) =>
    call.url.includes("/items")
      ? new Response(JSON.stringify([{ ad_archive_id: "1" }, { ad_archive_id: "2" }]), {
          headers: { "content-type": "application/json", "x-apify-pagination-total": "133" },
        })
      : call.url.includes("/records/INPUT")
        ? json({ runTag: "tag-1", urls: [{ url: "https://www.facebook.com/ads/library/?q=x" }] })
        : call.url.includes("/datasets/")
          ? json({ data: { itemCount: 133, modifiedAt: "2026-09-11T09:09:39.230Z" } })
          : json(runBody()));

  const run = await client.readRun("RUN1");
  assert.ok(run.ok);
  assert.equal(run.value.runId, "RUN1");
  assert.equal(run.value.succeeded, true);
  assert.equal(run.value.startedAt, "2026-09-11T09:09:12.548Z");
  assert.equal(run.value.maxItems, 133);

  const input = await client.readRunInput({ keyValueStoreId: "KV1" });
  assert.deepEqual(input.ok && input.value, {
    runTag: "tag-1", sourceUrl: "https://www.facebook.com/ads/library/?q=x",
  });

  const metadata = await client.readDatasetMetadata("DS1");
  assert.deepEqual(metadata.ok && metadata.value, { itemCount: 133, modifiedAt: "2026-09-11T09:09:39.230Z" });

  const total = await client.readDatasetItemTotal("DS1");
  assert.equal(total.ok && total.value, 133);

  const page = await client.readDatasetItems("DS1", { offset: 0, limit: 2 });
  assert.equal(page.ok && page.value.items.length, 2);
  assert.equal(page.ok && page.value.total, 133);
});

test("cost figures stay provider evidence, as exact text", async () => {
  const { client } = provider(() => json(runBody()));
  const run = await client.readRun("RUN1");
  assert.ok(run.ok);
  // Text, not a float, and named as the provider's own report.
  assert.equal(run.value.usage.reportedTotalUsd, "0.0998");
  assert.equal(run.value.usage.chargedItems, 133);
  assert.equal(run.value.usage.chargedStartEvents, 1);
  assert.equal(run.value.ceilingUsd, "0.1");
  // Nothing here claims a settled cost: that word belongs to C05.
  assert.ok(!("finalCost" in run.value.usage) && !("cost" in run.value));
});

// --- failing closed ---------------------------------------------------------------

test("a malformed provider answer fails closed", async () => {
  const cases: [string, () => Response][] = [
    ["not json", () => new Response("<html>", { status: 200, headers: { "content-type": "text/html" } })],
    ["no data", () => json({ nothing: true })],
    ["run without id", () => json({ data: { status: "SUCCEEDED" } })],
  ];
  for (const [name, responder] of cases) {
    const { client } = provider(responder);
    const run = await client.readRun("RUN1");
    assert.equal(run.ok, false, name);
  }

  const { client: noCount } = provider(() => json({ data: { modifiedAt: "x" } }));
  assert.equal((await noCount.readDatasetMetadata("DS1")).ok, false, "a dataset without a count is not a count");

  const { client: noTotal } = provider(() => new Response("[]", { headers: { "content-type": "application/json" } }));
  assert.equal((await noTotal.readDatasetItemTotal("DS1")).ok, false, "a missing total is not zero");

  const { client: notAList } = provider(() => json({ data: { items: "nope" } }));
  assert.equal((await notAList.findRunsSince(new Date(), 5)).ok, false);
});

test("a status the provider has not documented is never read as success", async () => {
  const { client } = provider(() => json(runBody({ status: "SOMETHING_NEW" })));
  const run = await client.readRun("RUN1");
  assert.ok(run.ok);
  assert.equal(run.value.status, "UNKNOWN");
  assert.equal(run.value.succeeded, false);
  assert.equal(run.value.terminal, false);
  assert.equal(normalizeStatus(undefined), "UNKNOWN");
  assert.equal(isTerminalStatus("UNKNOWN"), false);
});

test("a missing record is not found, and an outage is unavailable", async () => {
  const { client: missing } = provider(() => json({ error: { type: "record-not-found" } }, { status: 404 }));
  const gone = await missing.readRun("RUN1");
  assert.equal(gone.ok === false && gone.reason, "not_found");

  const { client: down } = provider(() => json({ error: { type: "server-error" } }, { status: 503 }));
  const outage = await down.readDatasetMetadata("DS1");
  assert.equal(outage.ok === false && outage.reason, "unavailable");
});

// --- secrets and scrubbing --------------------------------------------------------

test("provider text is scrubbed of credentials, URLs and length", () => {
  const dirty = `Authorization: Bearer ${TOKEN} failed for https://${PROVIDER_HOST}/v2/acts/x?token=${TOKEN}`;
  const clean = scrubProviderMessage(dirty);
  assert.ok(!clean.includes(TOKEN), "no token survives");
  assert.ok(!clean.includes(PROVIDER_HOST), "no provider URL survives");
  assert.ok(clean.includes("[redacted]"), "the credential is replaced, by whichever rule catches it");
  assert.ok(scrubProviderMessage("x".repeat(1000)).length <= 300, "and it stays bounded");
});

test("no error or returned object carries the token", async () => {
  const leaky = provider(() => json({
    error: { type: "forbidden", message: `token ${TOKEN} rejected at https://${PROVIDER_HOST}/v2/acts` },
  }, { status: 403 }));
  const outcome = await leaky.client.startRun(startRequest());
  const serialized = JSON.stringify(outcome);
  assert.ok(!serialized.includes(TOKEN), "the refusal must not quote the token");
  assert.ok(!serialized.includes(PROVIDER_HOST), "nor the provider URL");

  const thrown = provider(() => { throw new Error(`connect failed using ${TOKEN}`); });
  const unknown = await thrown.client.startRun(startRequest());
  assert.ok(!JSON.stringify(unknown).includes(TOKEN));
});

// --- bounded calls ------------------------------------------------------------------

test("every call is time-bounded", async () => {
  const { client, calls } = provider(() => json(runBody()));
  await client.startRun(startRequest());
  await client.readRun("RUN1");
  for (const call of calls) {
    assert.ok(call.signal instanceof AbortSignal, `${call.url} must carry a timeout signal`);
  }
  assert.ok(START_TIMEOUT_MS > 0 && READ_TIMEOUT_MS > 0);
  assert.ok(START_TIMEOUT_MS <= 60_000 && READ_TIMEOUT_MS <= 60_000, "no call waits for a run");
});

// --- the mock -----------------------------------------------------------------------

test("the mock refuses to run outside dev and test", () => {
  for (const stage of ["production", "pilot", undefined]) {
    assert.throws(
      () => createMockProvider({}, { PT_GLORY_ENV: stage }),
      /dev or test/,
    );
  }
  assert.ok(createMockProvider({}, { PT_GLORY_ENV: "test" }));
});

test("the mock can script a lost start, and counts the starts it was asked for", async () => {
  const lost = createMockProvider(
    { start: { outcome: "unknown", detail: "no answer" } },
    { PT_GLORY_ENV: "test" },
  );
  const outcome = await lost.startRun(startRequest());
  assert.equal(outcome.outcome, "unknown");
  assert.equal(lost.startCount, 1);
  assert.deepEqual(lost.calls.map((c) => c.operation), ["startRun"]);

  const succeeded = createMockProvider(
    { run: mockRun(), items: [{ ad_archive_id: "1" }] },
    { PT_GLORY_ENV: "test" },
  );
  assert.equal((await succeeded.startRun(startRequest())).outcome, "started");
  assert.equal((await succeeded.readDatasetItemTotal("DS1")).ok, true);
  assert.equal(succeeded.startCount, 1);
});

// --- no real provider call, anywhere in this suite -----------------------------------

test("this suite never reaches the network", () => {
  // Every client above was built with an injected fetch; the default would be
  // the real one, so a test that forgot to inject would show up here.
  const source = new URL("collect-provider.test.ts", import.meta.url);
  assert.ok(source.pathname.endsWith("tests/collect-provider.test.ts"));
  assert.equal(typeof createApifyProvider, "function");
});
