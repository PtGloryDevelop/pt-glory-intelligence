import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseFacebookPayload, extractAdsFromPayload, findCursorCandidates, findPaginationState, sanitizeNetworkUrl, buildReplayBody, buildDirectPaginationBody, requestCursorShape, inspectGraphqlPayload, inspectGraphqlRequest } from './network-extractor.mjs';
import { classifyAccessBlock } from './access-guard.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extractorPath = path.join(__dirname, 'extractor.js');
const extractorSource = fs.readFileSync(extractorPath, 'utf8');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const unique = (values) => [...new Set((values || []).filter(Boolean))];

async function accessDiagnostics(page) {
  try {
    return await page.evaluate(() => {
      const text = (document.body?.innerText || '').replace(/\s+/g, ' ');
      const href = location.href;
      const pathname = location.pathname || '';
      const hasLibraryId = /Library ID\s*:/i.test(text);
      const hasAdsLibraryMarker = pathname.includes('/ads/library') || hasLibraryId || /\bAd Library\b/i.test(document.title || '');
      const hasPasswordInput = Boolean(document.querySelector('input[type="password"]'));
      const forms = [...document.querySelectorAll('form')];
      const hasLoginForm = forms.some((form) => /\/login(?:\/|\?|$)/i.test(form.getAttribute('action') || ''));
      const hasCheckpointForm = forms.some((form) => /\/checkpoint(?:\/|\?|$)/i.test(form.getAttribute('action') || ''));
      return {
        href,
        title: document.title || '',
        readyState: document.readyState,
        hasBody: Boolean(document.body),
        hasLibraryId,
        hasAdsLibraryMarker,
        hasPasswordInput,
        hasLoginForm,
        hasCheckpointForm,
        bodySample: text.slice(0, 700)
      };
    });
  } catch {
    return {
      href: page.url(), title: '', readyState: 'unknown', hasBody: false,
      hasLibraryId: false, hasAdsLibraryMarker: false, hasPasswordInput: false,
      hasLoginForm: false, hasCheckpointForm: false, bodySample: ''
    };
  }
}

async function waitForInitialResults(page, all, networkState, requestedEngine, { timeoutMs = 12_000 } = {}) {
  const started = Date.now();
  let lastSnapshot = null;
  let blockObservations = 0;
  let lastBlock = null;

  while (Date.now() - started < timeoutMs) {
    if (requestedEngine === 'network_first') await drainNetwork(networkState, 350);
    if (all.size > 0) return { snapshot: lastSnapshot, access: await accessDiagnostics(page), source: 'network' };

    try {
      lastSnapshot = await domSnapshot(page);
      mergeRows(all, lastSnapshot.rows);
      if (all.size > 0) return { snapshot: lastSnapshot, access: await accessDiagnostics(page), source: 'dom' };
    } catch {}

    const access = await accessDiagnostics(page);
    const block = classifyAccessBlock(access);
    if (block.blocked) {
      blockObservations += 1;
      lastBlock = { ...block, access };
      if (blockObservations >= 2) return { snapshot: lastSnapshot, access, blocked: lastBlock, source: 'blocked' };
    } else {
      blockObservations = 0;
      lastBlock = null;
    }
    await sleep(450);
  }

  return { snapshot: lastSnapshot, access: await accessDiagnostics(page), blocked: lastBlock, source: 'timeout' };
}

export function buildMetaUrl({ keyword, country = 'TH', status = 'active', mediaType = 'all' }) {
  const url = new URL('https://www.facebook.com/ads/library/');
  url.searchParams.set('active_status', status);
  url.searchParams.set('ad_type', 'all');
  url.searchParams.set('country', country);
  url.searchParams.set('is_targeted_country', 'false');
  url.searchParams.set('media_type', mediaType);
  url.searchParams.set('q', keyword);
  url.searchParams.set('search_type', 'keyword_unordered');
  url.searchParams.set('sort_data[mode]', 'total_impressions');
  url.searchParams.set('sort_data[direction]', 'desc');
  return url.href;
}

export function sourceFingerprint(value) {
  try {
    const u = new URL(value);
    const keys = ['active_status', 'ad_type', 'country', 'is_targeted_country', 'media_type', 'q', 'search_type', 'sort_data[mode]', 'sort_data[direction]'];
    return `${u.origin}${u.pathname}?${keys.map((key) => `${key}=${u.searchParams.get(key) || ''}`).join('&')}`;
  } catch { return value || 'unknown'; }
}

function rowKey(row) {
  return row?.ad_archive_id
    ? `ad:${row.ad_archive_id}`
    : `f:${row?.page_name || ''}|${row?.start_date_raw || ''}|${(row?.body_clean || row?.body || '').slice(0, 120)}`;
}

function isMeaningful(value) {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function mergeRows(map, incoming) {
  for (const row of incoming || []) {
    const key = rowKey(row);
    const before = map.get(key);
    if (!before) {
      map.set(key, {
        ...row,
        extraction_sources: unique([...(row?.extraction_sources || []), row?.extraction_source])
      });
      continue;
    }
    const merged = { ...before };
    for (const [field, value] of Object.entries(row || {})) {
      if (['images','auxiliary_images','videos','video_posters','page_categories','publisher_platform','cards','body_urls','query_match_fields'].includes(field)) continue;
      if (field === 'field_evidence' || field === 'media') continue;
      if (isMeaningful(value) || !isMeaningful(merged[field])) merged[field] = value;
    }
    for (const field of ['images', 'auxiliary_images', 'videos', 'video_posters', 'page_categories', 'publisher_platform', 'cards', 'body_urls', 'query_match_fields']) {
      merged[field] = unique([...(before[field] || []), ...(row[field] || [])]);
    }
    merged.field_evidence = { ...(before.field_evidence || {}), ...(row.field_evidence || {}) };
    merged.extraction_sources = unique([
      ...(before.extraction_sources || []), before.extraction_source,
      ...(row.extraction_sources || []), row.extraction_source
    ]);
    const format = merged.videos?.length ? 'VIDEO' : merged.images?.length > 1 ? 'MULTI_IMAGE' : merged.images?.length === 1 ? 'SINGLE_IMAGE' : merged.display_format || 'UNKNOWN';
    merged.display_format = format;
    merged.media = {
      format,
      images: merged.images || [],
      video_posters: merged.video_posters || [],
      videos: merged.videos || [],
      auxiliary_images: merged.auxiliary_images || []
    };
    map.set(key, merged);
  }
}

function completeness(records) {
  const fields = [
    ['Ad ID', (r) => !!r.ad_archive_id],
    ['Page Identity', (r) => !!r.page_identity_key],
    ['Page ID', (r) => !!r.page_id],
    ['Page Name', (r) => !!r.page_name],
    ['Start Date', (r) => !!r.start_date_raw],
    ['Status', (r) => r.is_active !== 'unknown'],
    ['Clean Body', (r) => !!r.body_clean],
    ['Creative Media', (r) => (r.images?.length || 0) + (r.videos?.length || 0) > 0],
    ['Platforms observed', (r) => (r.publisher_platform?.length || 0) > 0],
    ['CTA observed', (r) => r.cta_observation === 'confirmed'],
    ['CTA destination observed', (r) => !!r.cta_destination_url],
    ['Ad details URL observed', (r) => !!r.ad_details_url],
    ['Collation observed', (r) => r.collation_observation === 'observed'],
    ['Categories deterministic', (r) => (r.page_categories?.length || 0) > 0]
  ];
  return fields.map(([name, predicate]) => {
    const present = records.filter(predicate).length;
    return { name, present, total: records.length, pct: records.length ? Math.round((present / records.length) * 1000) / 10 : 0 };
  });
}

function looksAuxiliaryImage(url) {
  return /(?:^|[_?&])s(?:=|_)?60x60|s60x60|\b60x60\b/i.test(url || '');
}

function quality(records) {
  const pct = (predicates) => {
    if (!records.length) return 0;
    let present = 0;
    for (const r of records) for (const fn of predicates) if (fn(r)) present += 1;
    return Math.round((present / (records.length * predicates.length)) * 1000) / 10;
  };
  const core = pct([
    (r) => !!r.ad_archive_id,
    (r) => !!r.page_name,
    (r) => !!r.start_date_raw,
    (r) => r.is_active !== 'unknown',
    (r) => !!r.body_clean,
    (r) => (r.images?.length || 0) + (r.videos?.length || 0) > 0
  ]);
  const identity = pct([(r) => !!r.ad_archive_id, (r) => !!r.page_identity_key, (r) => !!r.page_name, (r) => !!r.start_date_raw]);
  const provenance = pct([
    (r) => !!r.field_evidence?.ad_archive_id,
    (r) => !r.page_id || !!r.field_evidence?.page_id,
    (r) => !r.cta_type || !!r.field_evidence?.cta_type,
    (r) => r.collation_count == null || !!r.field_evidence?.collation_count
  ]);
  const checks = records.flatMap((r) => [
    !(r.page_categories || []).some((x) => /(?:฿|บาท|\d\s*(?:แถม|บาท)|ปกติ|เพียง\s*\d)/i.test(x)),
    r.display_format !== 'MULTI_IMAGE' || (r.images?.length || 0) > 1,
    !(r.images || []).some(looksAuxiliaryImage),
    !r.cta_destination_url || /^https?:\/\//i.test(r.cta_destination_url)
  ]);
  const validity = checks.length ? Math.round((checks.filter(Boolean).length / checks.length) * 1000) / 10 : 0;
  const scope = records.length ? Math.round((records.filter((r) => r.query_relevance_status !== 'no_observed_exact_text_match').length / records.length) * 1000) / 10 : 0;
  const gate = core >= 95 && identity >= 90 && validity >= 95 ? 'ready' : core >= 80 && identity >= 70 && validity >= 85 ? 'review' : 'low';
  return { core, identity, validity, provenance, scope, gate };
}

function makeExport({ sourceUrl, startedAt, finishedAt, target, detectedCount, records, rounds, reason, pageState, engine, networkDiagnostics, warmupDiagnostics }) {
  const pageKeys = unique(records.map((r) => r.page_identity_key));
  const elapsedMs = Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime());
  const recordsPerSecond = elapsedMs > 0 ? Math.round((records.length / (elapsedMs / 1000)) * 100) / 100 : null;
  const networkCount = Number(networkDiagnostics?.accepted_network_backed ?? networkDiagnostics?.unique_ads_from_network ?? 0);
  const networkSharePct = records.length ? Math.round((Math.min(networkCount, records.length) / records.length) * 1000) / 10 : 0;
  return {
    schema: 'pt-glory-collector-service-v0.2.14-long-run-fast-pagination',
    exported_at: new Date().toISOString(),
    source: { url: sourceUrl, fingerprint: sourceFingerprint(sourceUrl) },
    collection: {
      accepted_count: records.length,
      detected_count: detectedCount,
      ignored_extra: Math.max(0, detectedCount - target),
      mode: 'playwright_service',
      engine,
      reason,
      rounds,
      started_at: startedAt,
      finished_at: finishedAt,
      status: reason ? 'finished' : 'running',
      target,
      pageHeight: pageState?.pageHeight ?? null,
      scrollY: pageState?.scrollY ?? null,
      visibility_state: pageState?.visibilityState ?? null,
      elapsed_ms: elapsedMs,
      records_per_second: recordsPerSecond,
      warmup: warmupDiagnostics || null
    },
    summary: {
      records: records.length,
      pages: pageKeys.length,
      quality: quality(records)
    },
    performance: {
      elapsed_ms: elapsedMs,
      records_per_second: recordsPerSecond,
      network_share_pct: networkSharePct
    },
    network_diagnostics: networkDiagnostics || null,
    field_completeness: completeness(records),
    records
  };
}

async function dismissCookieDialog(page) {
  const labels = [/Allow all cookies/i, /อนุญาตคุกกี้ทั้งหมด/i, /Allow essential and optional cookies/i];
  for (const label of labels) {
    try {
      const button = page.getByRole('button', { name: label }).first();
      if (await button.isVisible({ timeout: 700 })) {
        await button.click({ timeout: 1200 });
        return true;
      }
    } catch {}
  }
  return false;
}

async function pageDiagnostics(page) {
  return accessDiagnostics(page);
}

async function installExtractor(page) {
  let lastError = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      await page.waitForFunction(() => Boolean(document.documentElement), null, { timeout: 10_000 });
      const installed = await page.evaluate((source) => {
        if (typeof window.PTGloryExtractor?.scan === 'function') return true;
        (0, eval)(source);
        return typeof window.PTGloryExtractor?.scan === 'function';
      }, extractorSource);
      if (installed) return true;
      lastError = new Error('extractor_not_exposed_after_eval');
    } catch (error) {
      lastError = error;
    }
    await sleep(350 * attempt);
  }

  const diag = await pageDiagnostics(page);
  throw new Error([
    'extractor_install_failed',
    lastError?.message || 'unknown',
    `url=${diag.href}`,
    `title=${diag.title || '-'}`,
    `ready=${diag.readyState}`,
    `body=${diag.hasBody ? 'yes' : 'no'}`,
    diag.bodySample ? `sample=${diag.bodySample}` : ''
  ].filter(Boolean).join(' | '));
}


async function navigateWithWarmup(page, sourceUrl, {
  onProgress = () => {}, target = 0, workerMode = 'local_chrome', engine = 'network_first', maxAttempts = 4
} = {}) {
  const delays = [0, 5000, 8000, 12000];
  const attempts = [];
  const startedAt = Date.now();
  let lastResponse = null;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (attempt > 1) {
      const waitMs = delays[Math.min(attempt - 1, delays.length - 1)];
      onProgress({
        state: 'warming_up', count: 0, target, engine, workerMode,
        warmupAttempt: attempt, warmupMaxAttempts: maxAttempts,
        message: `Meta returned an initial error. Waiting ${(waitMs / 1000).toFixed(0)}s before warm-up retry ${attempt}/${maxAttempts}…`
      });
      await sleep(waitMs);
    }

    try {
      // Always retry the canonical Ads Library URL. A previous 4xx document may be
      // a transient bootstrap response; reloading that document is less reliable.
      lastResponse = await page.goto(sourceUrl, { waitUntil: 'domcontentloaded' });
      lastError = null;
    } catch (error) {
      lastError = error;
      lastResponse = null;
    }

    const diag = await pageDiagnostics(page);
    const status = lastResponse?.status?.() ?? null;
    const block = classifyAccessBlock(diag);
    attempts.push({
      attempt,
      status,
      error: lastError ? String(lastError?.message || lastError).slice(0, 240) : null,
      title: diag.title || null,
      ready_state: diag.readyState || null,
      has_body: Boolean(diag.hasBody),
      ads_library_marker: Boolean(diag.hasAdsLibraryMarker),
      library_id_marker: Boolean(diag.hasLibraryId),
      access_block: block.blocked ? block.reason : null
    });

    // A real login/checkpoint state is not something a warm-up retry should bypass.
    if (block.blocked) {
      return {
        ok: false,
        blocked: block,
        response: lastResponse,
        diag,
        attempts,
        recovered: false,
        elapsed_ms: Date.now() - startedAt
      };
    }

    // Successful navigation, or a page that already rendered actual Ad Library records.
    if ((status == null && diag.hasLibraryId) || (status != null && status < 400) || diag.hasLibraryId) {
      return {
        ok: true,
        response: lastResponse,
        diag,
        attempts,
        recovered: attempt > 1,
        elapsed_ms: Date.now() - startedAt
      };
    }
  }

  return {
    ok: false,
    response: lastResponse,
    diag: await pageDiagnostics(page),
    attempts,
    recovered: false,
    elapsed_ms: Date.now() - startedAt,
    error: lastError
  };
}

function createNetworkState() {
  return {
    responsesSeen: 0,
    jsonResponses: 0,
    candidateResponses: 0,
    uniqueAds: new Set(),
    rowsSeen: 0,
    endpoints: new Map(),
    cursors: [],
    replayTemplate: null,
    lastCursor: null,
    replayAttempts: 0,
    replaySuccesses: 0,
    replayRows: 0,
    replayNetworkRows: 0,
    replayFailureStreak: 0,
    replayDisabledReason: null,
    replayLastStatus: null,
    replayLastResponseBytes: 0,
    replayLastAdsFound: 0,
    replayLastAdded: 0,
    replayLastCursorAdvanced: false,
    directBodies: new Set(),
    paginationScrolls: 0,
    recoveryScrolls: 0,
    directBursts: 0,
    directBurstPages: 0,
    directStopReason: null,
    directStartAccepted: null,
    directStartNetwork: null,
    targetAwareStops: 0,
    directActive: false,
    directTransientRetries: 0,
    directTransportFailures: 0,
    directFetchTimeoutMs: 4500,
    directElapsedMs: 0,
    directAttemptMsTotal: 0,
    directAttemptMsMax: 0,
    directPauseMs: 20,
    directSeenCursors: new Set(),
    directPageFingerprints: new Map(),
    directCursorCycleHits: 0,
    directDuplicatePageHits: 0,
    directTerminalPageInfoHits: 0,
    directEventParseSkips: 0,
    sourceExhaustedSignal: false,
    exhaustionConfirmed: false,
    exhaustionReason: null,
    exhaustionProbes: 0,
    exhaustionProbeAdsAdded: 0,
    longRunContinuationEpochs: 0,
    longRunFastPath: false,
    requestTemplatesIgnoredDuringDirect: 0,
    naturalResponsesIgnoredDuringDirect: 0,
    requestTemplateCaptures: 0,
    earlyTemplateScrolls: 0,
    earlyTemplateReady: false,
    earlyDirectPages: 0,
    templateWaitMs: 0,
    firstReplayRequestAt: null,
    replayReadyAt: null,
    replayTemplateSource: null,
    replayReadyWaiters: new Set(),
    replayReadySignals: 0,
    replayReadySignalSource: null,
    replayReadyGeneration: 0,
    replayReadyLatch: null,
    replayReadyImmediateHits: 0,
    replayReadyPostSubscribeHits: 0,
    replayReadySignalsWithoutWaiter: 0,
    replayReadyWaiterSubscriptions: 0,
    responsePivotWakeups: 0,
    responsePivotGraceWaitMs: 0,
    matchedPaginationResponses: 0,
    naturalPaginationResponses: 0,
    directReplayResponsesIgnoredForPivot: 0,
    fastDomBootstrapScans: 0,
    lateTemplateReentries: 0,
    lateTemplateReentryPages: 0,
    domEnrichmentScans: 0,
    graphqlResponses: 0,
    graphqlParsedPayloads: 0,
    graphqlInspector: [],
    pending: new Set()
  };
}

function networkDiagnostics(state, records = []) {
  const endpoints = [...state.endpoints.values()]
    .sort((a, b) => b.ads_found - a.ads_found || b.responses - a.responses)
    .slice(0, 12);
  const replayShape = state.replayTemplate ? requestCursorShape(state.replayTemplate.postData, state.replayTemplate.contentType) : { replayable: false, cursorPaths: [], variableKeys: [] };
  const acceptedNetworkBacked = records.length ? records.filter((row) => row?.ad_archive_id && state.uniqueAds.has(row.ad_archive_id)).length : 0;
  return {
    responses_seen: state.responsesSeen,
    json_responses: state.jsonResponses,
    graphql_responses: state.graphqlResponses,
    graphql_parsed_payloads: state.graphqlParsedPayloads,
    candidate_responses: state.candidateResponses,
    unique_ads_from_network: state.uniqueAds.size,
    accepted_network_backed: acceptedNetworkBacked,
    rows_seen_from_network: state.rowsSeen,
    network_dominant: {
      pagination_scrolls: state.paginationScrolls,
      recovery_scrolls: state.recoveryScrolls,
      total_scroll_triggers: state.paginationScrolls + state.recoveryScrolls,
      direct_bursts: state.directBursts,
      direct_burst_pages: state.directBurstPages,
      direct_stop_reason: state.directStopReason,
      target_mode: 'accepted_union',
      direct_start_accepted: state.directStartAccepted,
      direct_start_network: state.directStartNetwork,
      target_aware_stops: state.targetAwareStops,
      direct_active: state.directActive,
      direct_transient_retries: state.directTransientRetries,
      direct_transport_failures: state.directTransportFailures,
      direct_fetch_timeout_ms: state.directFetchTimeoutMs,
      direct_elapsed_ms: state.directElapsedMs,
      direct_attempt_ms_total: state.directAttemptMsTotal,
      direct_attempt_ms_max: state.directAttemptMsMax,
      direct_average_attempt_ms: state.replayAttempts ? Math.round(state.directAttemptMsTotal / state.replayAttempts) : null,
      direct_pause_ms: state.directPauseMs,
      direct_pages_per_second: state.directElapsedMs > 0 ? Math.round((state.directBurstPages / (state.directElapsedMs / 1000)) * 100) / 100 : null,
      long_run_fast_path: state.longRunFastPath,
      long_run_continuation_epochs: state.longRunContinuationEpochs,
      direct_cursor_cycle_hits: state.directCursorCycleHits,
      direct_duplicate_page_hits: state.directDuplicatePageHits,
      direct_terminal_page_info_hits: state.directTerminalPageInfoHits,
      direct_event_parse_skips: state.directEventParseSkips,
      source_exhausted_signal: state.sourceExhaustedSignal,
      exhaustion_confirmed: state.exhaustionConfirmed,
      exhaustion_reason: state.exhaustionReason,
      exhaustion_probes: state.exhaustionProbes,
      exhaustion_probe_ads_added: state.exhaustionProbeAdsAdded,
      single_pivot_direct: state.directBursts === 1 && state.directStopReason === 'accepted_target_reached',
      request_templates_ignored_during_direct: state.requestTemplatesIgnoredDuringDirect,
      natural_responses_ignored_during_direct: state.naturalResponsesIgnoredDuringDirect,
      early_template_scrolls: state.earlyTemplateScrolls,
      early_template_ready: state.earlyTemplateReady,
      early_direct_pages: state.earlyDirectPages,
      request_template_captures: state.requestTemplateCaptures,
      replay_template_source: state.replayTemplateSource,
      template_wait_ms: state.templateWaitMs,
      replay_ready_latency_ms: state.firstReplayRequestAt && state.replayReadyAt ? Math.max(0, state.replayReadyAt - state.firstReplayRequestAt) : null,
      replay_ready_signals: state.replayReadySignals,
      replay_ready_signal_source: state.replayReadySignalSource,
      replay_ready_generation: state.replayReadyGeneration,
      replay_ready_latched: Boolean(state.replayReadyLatch?.template && state.replayReadyLatch?.cursor),
      replay_ready_latch_source: state.replayReadyLatch?.source || null,
      replay_ready_immediate_hits: state.replayReadyImmediateHits,
      replay_ready_post_subscribe_hits: state.replayReadyPostSubscribeHits,
      replay_ready_signals_without_waiter: state.replayReadySignalsWithoutWaiter,
      replay_ready_waiter_subscriptions: state.replayReadyWaiterSubscriptions,
      response_pivot_wakeups: state.responsePivotWakeups,
      response_pivot_grace_wait_ms: state.responsePivotGraceWaitMs,
      matched_pagination_responses: state.matchedPaginationResponses,
      natural_pagination_responses: state.naturalPaginationResponses,
      direct_replay_responses_ignored_for_pivot: state.directReplayResponsesIgnoredForPivot,
      fast_dom_bootstrap_scans: state.fastDomBootstrapScans,
      late_template_reentries: state.lateTemplateReentries,
      late_template_reentry_pages: state.lateTemplateReentryPages,
      dom_enrichment_scans: state.domEnrichmentScans
    },
    cursor_candidates: state.cursors.slice(0, 12).map((x) => ({ path: x.path, sample_length: x.value?.length || 0 })),
    graphql_inspector: state.graphqlInspector.slice(0, 12),
    replay: {
      available: Boolean(state.replayTemplate && state.lastCursor && replayShape.replayable),
      attempts: state.replayAttempts,
      successes: state.replaySuccesses,
      rows_added: state.replayRows,
      network_rows_confirmed: state.replayNetworkRows,
      failure_streak: state.replayFailureStreak,
      disabled_reason: state.replayDisabledReason,
      cursor_paths: replayShape.cursorPaths,
      variable_keys: replayShape.variableKeys,
      mode: 'page_fetch_graphql_cursor',
      last_status: state.replayLastStatus,
      last_response_bytes: state.replayLastResponseBytes,
      last_ads_found: state.replayLastAdsFound,
      last_added: state.replayLastAdded,
      last_cursor_advanced: state.replayLastCursorAdvanced
    },
    endpoints
  };
}

function isReplayReady(state) {
  return Boolean(state?.replayTemplate && state?.lastCursor);
}

function restoreReplayReadyLatch(state) {
  const latch = state?.replayReadyLatch;
  if (!latch?.template || !latch?.cursor) return false;
  if (!state.replayTemplate) state.replayTemplate = { ...latch.template, headers: { ...(latch.template.headers || {}) } };
  if (!state.lastCursor) state.lastCursor = latch.cursor;
  return isReplayReady(state);
}

function signalReplayReady(state, source = 'response') {
  if (!isReplayReady(state) && !restoreReplayReadyLatch(state)) return false;
  const now = Date.now();
  state.replayReadyGeneration += 1;
  const generation = state.replayReadyGeneration;
  if (!state.replayReadyAt) state.replayReadyAt = now;
  state.replayReadySignals += 1;
  state.replayReadySignalSource = source;
  state.replayReadyLatch = {
    generation,
    at: now,
    source,
    cursor: state.lastCursor,
    template: state.replayTemplate ? { ...state.replayTemplate, headers: { ...(state.replayTemplate.headers || {}) } } : null
  };
  const waiters = [...state.replayReadyWaiters];
  if (waiters.length) state.responsePivotWakeups += waiters.length;
  else state.replayReadySignalsWithoutWaiter += 1;
  state.replayReadyWaiters.clear();
  for (const wake of waiters) {
    try { wake({ ready: true, source, at: now, generation }); } catch {}
  }
  return true;
}

function replayHeadersInternal(headers = {}) {
  const out = {};
  for (const [key, value] of Object.entries(headers || {})) {
    const k = key.toLowerCase();
    // These headers are kept only in memory for the current browser session.
    // They are never written to diagnostics/export. Cookies stay browser-managed.
    if (['accept','content-type','x-fb-friendly-name','x-asbd-id','x-fb-lsd'].includes(k)) out[k] = value;
  }
  return out;
}

function captureReplayTemplateFromRequest(request, state, source = 'request') {
  try {
    const url = request.url();
    if (!/\/api\/graphql\/?/i.test(url)) return false;
    const postData = request.postData();
    if (!postData || state.directBodies.has(postData)) return false;
    const headers = request.headers();
    const inspector = inspectGraphqlRequest(postData, headers);
    if (inspector?.friendly_name !== 'AdLibrarySearchPaginationQuery') return false;
    if (state.directActive && state.replayTemplate && state.lastCursor) {
      // Single-pivot ownership: natural page pagination may still fire while the
      // Direct burst is running. Keep parsing those responses for rows, but do not
      // let their request template replace the cursor/template pair owned by Direct.
      state.requestTemplatesIgnoredDuringDirect += 1;
      return true;
    }
    const contentType = headers['content-type'] || '';
    const shape = requestCursorShape(postData, contentType);
    if (!shape.replayable) return false;
    if (state.replayTemplate?.url === url && state.replayTemplate?.postData === postData) {
      if (state.lastCursor) signalReplayReady(state, 'request_after_cursor');
      return true;
    }

    state.replayTemplate = {
      url,
      method: request.method(),
      headers: replayHeadersInternal(headers),
      postData,
      contentType,
      friendlyName: inspector?.friendly_name || null,
      docId: inspector?.doc_id || null
    };
    state.replayDisabledReason = null;
    state.requestTemplateCaptures += 1;
    state.replayTemplateSource = source;
    if (!state.firstReplayRequestAt) state.firstReplayRequestAt = Date.now();
    if (state.lastCursor) signalReplayReady(state, 'request_after_cursor');
    return true;
  } catch {
    return false;
  }
}

async function waitForReplayReady(state, timeoutMs = 1400) {
  const started = Date.now();
  const startGeneration = state.replayReadyGeneration || 0;
  const finish = (ready, source = ready ? 'latched_ready' : 'timeout', generation = state.replayReadyGeneration || startGeneration) => {
    const elapsed = Date.now() - started;
    state.templateWaitMs += elapsed;
    if (ready && !state.replayReadyAt) state.replayReadyAt = Date.now();
    return { ready, elapsed_ms: elapsed, source, generation };
  };

  if (isReplayReady(state) || restoreReplayReadyLatch(state)) {
    state.replayReadyImmediateHits += 1;
    return finish(true, 'latched_ready');
  }

  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const settle = (ready, source, generation = state.replayReadyGeneration || startGeneration) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      state.replayReadyWaiters.delete(wake);
      resolve(finish(ready, source, generation));
    };
    const wake = (info = {}) => settle(true, info.source || 'response_signal', info.generation);
    state.replayReadyWaiters.add(wake);
    state.replayReadyWaiterSubscriptions += 1;

    // Stateful lost-wakeup protection: a pagination response can arrive before this
    // waiter is subscribed. The generation/latch survives that timing window, so
    // re-check both readiness and generation immediately after subscribing.
    const generationAdvanced = (state.replayReadyGeneration || 0) > startGeneration;
    if (isReplayReady(state) || restoreReplayReadyLatch(state) || generationAdvanced) {
      state.replayReadyPostSubscribeHits += 1;
      queueMicrotask(() => wake({
        source: generationAdvanced ? 'ready_generation_latched' : 'ready_after_subscribe',
        generation: state.replayReadyGeneration || startGeneration
      }));
      return;
    }

    timer = setTimeout(() => {
      const latched = isReplayReady(state) || restoreReplayReadyLatch(state) || (state.replayReadyGeneration || 0) > startGeneration;
      settle(latched, latched ? 'ready_latched_at_timeout' : 'timeout', state.replayReadyGeneration || startGeneration);
    }, Math.max(1, timeoutMs));
  });
}

function pageIdFingerprint(rows = []) {
  return unique((rows || []).map((row) => row?.ad_archive_id).filter(Boolean)).sort().join('|');
}

function shouldVerifyLongRunStop(reason) {
  return ['source_exhausted_signal','cursor_cycle_detected','duplicate_page_cycle','cursor_not_advanced','no_network_progress_twice','no_network_progress'].includes(String(reason || ''));
}

async function waitForReplayGeneration(state, startGeneration, timeoutMs = 1400) {
  if ((state.replayReadyGeneration || 0) > startGeneration) return true;
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      state.replayReadyWaiters.delete(wake);
      resolve(value);
    };
    const wake = (info = {}) => {
      if ((info.generation || state.replayReadyGeneration || 0) > startGeneration) settle(true);
      else state.replayReadyWaiters.add(wake);
    };
    state.replayReadyWaiters.add(wake);
    state.replayReadyWaiterSubscriptions += 1;
    if ((state.replayReadyGeneration || 0) > startGeneration) queueMicrotask(() => settle(true));
    timer = setTimeout(() => settle((state.replayReadyGeneration || 0) > startGeneration), Math.max(1, timeoutMs));
  });
}

async function waitForPaginationSurface(page, timeoutMs = 1800) {
  try {
    await page.waitForFunction(() => {
      const doc = document.documentElement;
      const bodyText = document.body?.innerText || '';
      return doc.scrollHeight > Math.max(window.innerHeight || 800, 800) * 1.2 || /Library ID\s*:/i.test(bodyText);
    }, null, { timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

function attachNetworkCapture(page, sourceUrl, all, state) {
  // Capture the exact observed pagination request as soon as Chrome sends it.
  // v0.2.9 waited until the response body had been parsed before storing the
  // template; capturing on request shortens the pivot once end_cursor arrives.
  page.on('request', (request) => {
    captureReplayTemplateFromRequest(request, state, 'request');
  });
  page.on('response', (response) => {
    const task = (async () => {
      state.responsesSeen += 1;
      const request = response.request();
      const resourceType = request.resourceType();
      const url = response.url();
      const contentType = String(response.headers()['content-type'] || '').toLowerCase();
      const isGraphql = /\/api\/graphql\/?/i.test(url);
      const requestHeaders = await request.allHeaders().catch(() => request.headers());
      const requestPostData = request.postData();
      const isDirectReplay = Boolean(requestPostData && state.directBodies.has(requestPostData));
      const requestInspector = isGraphql ? inspectGraphqlRequest(requestPostData, requestHeaders) : null;
      if (isGraphql) state.graphqlResponses += 1;
      // Direct fetch responses are already read + normalized synchronously by
      // tryReplayNextPage(). Parsing them again in the event listener doubles CPU
      // work on long 500–1,000 Ad runs without adding information.
      if (isDirectReplay && isGraphql && requestInspector?.friendly_name === 'AdLibrarySearchPaginationQuery') {
        state.directReplayResponsesIgnoredForPivot += 1;
        state.directEventParseSkips += 1;
        return;
      }
      if (!/facebook\.com/i.test(url)) return;
      if (!['xhr','fetch','document'].includes(resourceType) && !/json|javascript|text/.test(contentType)) return;
      if (!/graphql|ads\/library|api|ajax|async/i.test(url) && !/json/.test(contentType)) return;
      let text;
      try {
        const body = await response.body();
        if (!body?.length || body.length > 12 * 1024 * 1024) return;
        text = body.toString('utf8');
      } catch { return; }
      const payloads = parseFacebookPayload(text);
      if (isGraphql) state.graphqlParsedPayloads += payloads.length;
      if (!payloads.length) {
        if (isGraphql && state.graphqlInspector.length < 12) {
          state.graphqlInspector.push({
            endpoint: sanitizeNetworkUrl(url).slice(0, 300),
            status: response.status(),
            resource_type: resourceType,
            content_type: contentType || null,
            body_bytes: Buffer.byteLength(text),
            parsed_payloads: 0,
            body_format_hint: /^for\s*\(\s*;;\s*\)/.test(text.trim()) ? 'for_prefix' : /^[{[]/.test(text.trim()) ? 'json_like' : 'other',
            request: requestInspector,
            ads_found: 0,
            cursors_found: 0,
            payload_shapes: []
          });
        }
        return;
      }
      state.jsonResponses += 1;
      let responseRows = [];
      let responseCursors = [];
      for (const payload of payloads) {
        responseRows.push(...extractAdsFromPayload(payload, sourceUrl));
        responseCursors.push(...findCursorCandidates(payload));
      }
      responseRows = responseRows.filter((r) => r?.ad_archive_id);
      if (isGraphql && state.graphqlInspector.length < 12) {
        state.graphqlInspector.push({
          endpoint: sanitizeNetworkUrl(url).slice(0, 300),
          status: response.status(),
          resource_type: resourceType,
          content_type: contentType || null,
          body_bytes: Buffer.byteLength(text),
          parsed_payloads: payloads.length,
          request: requestInspector,
          ads_found: responseRows.length,
          cursors_found: responseCursors.length,
          payload_shapes: payloads.slice(0, 3).map((payload) => inspectGraphqlPayload(payload))
        });
      }
      if (responseRows.length) {
        state.candidateResponses += 1;
        state.rowsSeen += responseRows.length;
        for (const row of responseRows) state.uniqueAds.add(row.ad_archive_id);
        mergeRows(all, responseRows);
        const preferred = responseCursors.find((x) => /end_cursor|next_cursor|endCursor|nextCursor/i.test(x.path)) || responseCursors[0] || null;
        const isPaginationResponse = Boolean(isGraphql && requestInspector?.friendly_name === 'AdLibrarySearchPaginationQuery');
        if (preferred?.value) {
          if (isPaginationResponse) {
            state.matchedPaginationResponses += 1;
            if (isDirectReplay) {
              // Direct replay responses are skipped before body parsing above.
            } else if (state.directActive) {
              // A natural page request can finish while Direct is draining. Merge its
              // rows above, but do not overwrite Direct's cursor/template mid-burst.
              state.naturalResponsesIgnoredDuringDirect += 1;
            } else {
              state.lastCursor = preferred.value;
              state.naturalPaginationResponses += 1;
              // Re-bind the ready latch to the exact natural request that produced
              // this cursor. This prevents a later request event from overwriting the
              // template/cursor pair before the async response body finishes parsing.
              captureReplayTemplateFromRequest(request, state, state.replayTemplate ? state.replayTemplateSource || 'request' : 'response_fallback');
              signalReplayReady(state, 'pagination_response');
            }
          } else if (!state.directActive) {
            state.lastCursor = preferred.value;
          }
        }
      }
      if (responseCursors.length) {
        for (const cursor of responseCursors) {
          if (!state.cursors.some((x) => x.path === cursor.path && x.value === cursor.value)) state.cursors.push(cursor);
        }
      }
      const endpointKey = sanitizeNetworkUrl(url).slice(0, 500);
      const existing = state.endpoints.get(endpointKey) || { url: endpointKey, responses: 0, ads_found: 0, status: response.status(), resource_type: resourceType };
      existing.responses += 1;
      existing.ads_found += responseRows.length;
      existing.status = response.status();
      state.endpoints.set(endpointKey, existing);
    })().catch(() => {});
    state.pending.add(task);
    task.finally(() => state.pending.delete(task));
  });
}

async function drainNetwork(state, timeoutMs = 2500) {
  if (!state.pending.size) return;
  await Promise.race([
    Promise.allSettled([...state.pending]),
    sleep(timeoutMs)
  ]);
}

async function tryReplayNextPage(page, sourceUrl, all, state) {
  const template = state.replayTemplate;
  const cursor = state.lastCursor;
  if (!template || !cursor) return { attempted: false, added: 0 };

  const direct = buildDirectPaginationBody(
    template.postData,
    template.contentType,
    cursor,
    [...all.values()].map((row) => row?.ad_archive_id).filter(Boolean)
  );
  if (!direct) return { attempted: false, added: 0 };

  state.replayAttempts += 1;
  const before = all.size;
  const beforeNetwork = state.uniqueAds.size;
  const previousCursor = cursor;
  const attemptStartedAt = Date.now();
  const fetchTimeoutMs = Math.max(2500, Math.min(Number(state.directFetchTimeoutMs) || 4500, 8000));

  try {
    state.directBodies.add(direct.body);
    const result = await page.evaluate(async ({ url, method, headers, body, timeoutMs }) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(url, {
          method: method || 'POST',
          headers,
          body,
          credentials: 'include',
          signal: controller.signal
        });
        const text = await response.text();
        return { ok: response.ok, status: response.status, text };
      } finally {
        clearTimeout(timer);
      }
    }, {
      url: template.url,
      method: template.method || 'POST',
      headers: template.headers,
      body: direct.body,
      timeoutMs: fetchTimeoutMs
    });
    state.directBodies.delete(direct.body);

    state.replayLastStatus = result.status ?? null;
    state.replayLastResponseBytes = Buffer.byteLength(result.text || '');

    if (!result.ok) {
      state.replayLastAdsFound = 0;
      state.replayLastAdded = 0;
      state.replayLastCursorAdvanced = false;
      state.replayFailureStreak += 1;
      if (state.replayFailureStreak >= 2) {
        state.replayDisabledReason = `http_${result.status}`;
        state.replayTemplate = null;
      }
      return { attempted: true, added: 0, status: result.status };
    }

    const payloads = parseFacebookPayload(result.text);
    let rows = [];
    let cursors = [];
    let paginationStates = [];
    for (const payload of payloads) {
      rows.push(...extractAdsFromPayload(payload, sourceUrl));
      cursors.push(...findCursorCandidates(payload));
      paginationStates.push(...findPaginationState(payload));
    }

    rows = rows.filter((row) => row?.ad_archive_id);
    mergeRows(all, rows);
    for (const row of rows) state.uniqueAds.add(row.ad_archive_id);

    const preferred = cursors.find((x) => /end_cursor|next_cursor|endCursor|nextCursor/i.test(x.path)) || cursors[0] || null;
    const cursorAdvanced = Boolean(preferred?.value && preferred.value !== previousCursor);
    const cursorRepeated = Boolean(preferred?.value && state.directSeenCursors.has(preferred.value));
    if (previousCursor) state.directSeenCursors.add(previousCursor);
    if (preferred?.value) state.directSeenCursors.add(preferred.value);
    if (cursorAdvanced) state.lastCursor = preferred.value;

    const pageFingerprint = pageIdFingerprint(rows);
    const pageFingerprintCount = pageFingerprint ? (state.directPageFingerprints.get(pageFingerprint) || 0) + 1 : 0;
    if (pageFingerprint) state.directPageFingerprints.set(pageFingerprint, pageFingerprintCount);

    const terminalPageInfo = paginationStates.find((x) => x.has_next_page === false) || null;
    const terminalSource = Boolean(terminalPageInfo);
    if (terminalSource) {
      state.directTerminalPageInfoHits += 1;
      state.sourceExhaustedSignal = true;
    }
    if (cursorRepeated) state.directCursorCycleHits += 1;

    const added = Math.max(0, all.size - before);
    const networkAdded = Math.max(0, state.uniqueAds.size - beforeNetwork);
    const duplicatePage = pageFingerprintCount > 1 && added <= 0 && networkAdded <= 0;
    if (duplicatePage) state.directDuplicatePageHits += 1;
    state.replayLastAdsFound = rows.length;
    state.replayLastAdded = added;
    state.replayLastCursorAdvanced = cursorAdvanced;

    // Network confirmation itself is progress. A row may already exist because the
    // Stable DOM bootstrap saw it first; that must not be treated as replay failure.
    if (added > 0 || networkAdded > 0) {
      if (state.replayTemplate) state.replayTemplate.postData = direct.body;
      state.replaySuccesses += 1;
      state.replayRows += added;
      state.replayNetworkRows += networkAdded;
      state.replayFailureStreak = 0;
      state.replayDisabledReason = null;
    } else {
      state.replayFailureStreak += 1;
      if (terminalSource) {
        state.replayDisabledReason = 'source_exhausted_signal';
        state.replayTemplate = null;
      } else if (cursorRepeated) {
        state.replayDisabledReason = 'cursor_cycle_detected';
        state.replayTemplate = null;
      } else if (duplicatePage && state.directDuplicatePageHits >= 2) {
        state.replayDisabledReason = 'duplicate_page_cycle';
        state.replayTemplate = null;
      } else if (!cursorAdvanced) {
        state.replayDisabledReason = 'cursor_not_advanced';
        state.replayTemplate = null;
      } else if (state.replayFailureStreak >= 2) {
        state.replayDisabledReason = 'no_network_progress';
        state.replayTemplate = null;
      }
    }
    return {
      attempted: true, added, networkAdded, status: result.status, cursorAdvanced, adsFound: rows.length,
      cursorRepeated, duplicatePage, terminalSource, hasNextPage: terminalPageInfo ? false : null, pageFingerprint
    };
  } catch (error) {
    state.directBodies.delete(direct.body);
    state.replayLastStatus = null;
    state.replayLastAdsFound = 0;
    state.replayLastAdded = 0;
    state.replayLastCursorAdvanced = false;
    state.replayFailureStreak += 1;
    if (state.replayFailureStreak >= 2) {
      state.replayDisabledReason = 'page_fetch_failed';
      state.replayTemplate = null;
    }
    return { attempted: true, added: 0, error: String(error?.message || error).slice(0, 160) };
  } finally {
    const attemptMs = Math.max(0, Date.now() - attemptStartedAt);
    state.directAttemptMsTotal += attemptMs;
    state.directAttemptMsMax = Math.max(state.directAttemptMsMax, attemptMs);
  }
}

async function domSnapshot(page) {
  const ready = await page.evaluate(() => typeof window.PTGloryExtractor?.scan === 'function').catch(() => false);
  if (!ready) await installExtractor(page);
  return page.evaluate(() => ({
    rows: window.PTGloryExtractor?.scan?.() || [],
    scrollY: window.scrollY,
    pageHeight: document.documentElement.scrollHeight,
    visibilityState: document.visibilityState,
    bodySample: (document.body?.innerText || '').slice(0, 1000)
  }));
}

async function triggerPaginationScroll(page) {
  await page.evaluate(() => {
    const scroller = document.scrollingElement || document.documentElement;
    const viewport = Math.max(window.innerHeight || 800, 800);
    // Jump close to the current bottom instead of walking the DOM card-by-card.
    // This is only a pagination trigger; GraphQL remains the primary data path.
    const target = Math.max(0, scroller.scrollHeight - Math.round(viewport * 0.35));
    window.scrollTo({ top: target, behavior: 'auto' });
    window.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
}

async function rapidScroll(page) {
  await page.evaluate(() => {
    const scroller = document.scrollingElement || document.documentElement;
    const current = window.scrollY;
    const viewport = Math.max(window.innerHeight || 800, 800);
    const target = Math.min(scroller.scrollHeight - viewport, current + viewport * 2.8);
    window.scrollTo({ top: Math.max(target, 0), behavior: 'auto' });
    window.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
}

async function runDirectUntilTarget(page, sourceUrl, all, state, target, { pauseMs = null, safetyPages = null } = {}) {
  if (!state.replayTemplate || !state.lastCursor || all.size >= target) {
    state.directStopReason = all.size >= target ? 'accepted_target_reached' : 'template_or_cursor_unavailable';
    if (all.size >= target) state.targetAwareStops += 1;
    return { pages: 0, added: 0, networkAdded: 0, stopReason: state.directStopReason };
  }

  const directStartedAt = Date.now();
  const effectivePauseMs = Math.max(0, Number(pauseMs ?? state.directPauseMs ?? 20));
  state.directBursts += 1;
  if (state.lastCursor) state.directSeenCursors.add(state.lastCursor);
  state.directActive = true;
  if (state.directStartAccepted == null) state.directStartAccepted = all.size;
  if (state.directStartNetwork == null) state.directStartNetwork = state.uniqueAds.size;
  state.directStopReason = null;
  let pages = 0;
  let totalAdded = 0;
  let totalNetworkAdded = 0;
  let consecutiveNoProgress = 0;
  let consecutiveTransportFailures = 0;
  const hardLimit = Math.max(25, Math.min(Number(safetyPages) || Math.max(target * 2, 60), 400));

  try {
    while (pages < hardLimit && all.size < target && state.replayTemplate && state.lastCursor) {
      const replay = await tryReplayNextPage(page, sourceUrl, all, state);
      if (!replay.attempted) {
        state.directStopReason = 'replay_not_attempted';
        break;
      }

      pages += 1;
      state.directBurstPages += 1;
      const added = replay.added || 0;
      const networkAdded = replay.networkAdded || 0;
      totalAdded += added;
      totalNetworkAdded += networkAdded;

      const transportFailed = Boolean(replay.error || (replay.status != null && replay.status >= 400));
      if (transportFailed) {
        consecutiveTransportFailures += 1;
        state.directTransportFailures += 1;
        // One transient fetch failure should not eject the collector into another
        // burst/scroll cycle. Retry the same cursor inside this Direct session while
        // the template is still valid; tryReplayNextPage disables it after 2 failures.
        if (consecutiveTransportFailures < 2 && state.replayFailureStreak < 2 && state.replayTemplate && state.lastCursor) {
          state.directTransientRetries += 1;
          await sleep(Math.max(60, effectivePauseMs));
          continue;
        }
        state.directStopReason = replay.error ? 'page_fetch_failed' : `http_${replay.status}`;
        break;
      }
      consecutiveTransportFailures = 0;

      if (replay.terminalSource) {
        state.directStopReason = 'source_exhausted_signal';
        break;
      }
      if (replay.cursorRepeated) {
        state.directStopReason = 'cursor_cycle_detected';
        break;
      }
      if (replay.duplicatePage && state.directDuplicatePageHits >= 2) {
        state.directStopReason = 'duplicate_page_cycle';
        break;
      }
      if (replay.cursorAdvanced === false) {
        state.directStopReason = 'cursor_not_advanced';
        break;
      }

      if (added <= 0 && networkAdded <= 0) consecutiveNoProgress += 1;
      else consecutiveNoProgress = 0;

      if (consecutiveNoProgress >= 2) {
        state.directStopReason = 'no_network_progress_twice';
        break;
      }
      if (all.size >= target) {
        state.directStopReason = 'accepted_target_reached';
        state.targetAwareStops += 1;
        break;
      }
      await sleep(effectivePauseMs);
    }

    if (!state.directStopReason) {
      if (all.size >= target) {
        state.directStopReason = 'accepted_target_reached';
        state.targetAwareStops += 1;
      } else if (!state.replayTemplate || !state.lastCursor) state.directStopReason = state.replayDisabledReason || 'template_or_cursor_unavailable';
      else if (pages >= hardLimit) state.directStopReason = 'safety_page_limit';
      else state.directStopReason = 'direct_loop_finished';
    }

    return { pages, added: totalAdded, networkAdded: totalNetworkAdded, stopReason: state.directStopReason };
  } finally {
    state.directActive = false;
    state.directElapsedMs += Math.max(0, Date.now() - directStartedAt);
  }
}

async function verifyLongRunPagination(page, sourceUrl, all, state, target, { waitMs = 1500 } = {}) {
  state.exhaustionProbes += 1;
  const beforeAccepted = all.size;
  const beforeNetwork = state.uniqueAds.size;
  const beforeGeneration = state.replayReadyGeneration || 0;

  // Drop the stale Direct cursor/template pair. The one verification scroll below
  // must earn a fresh natural pagination response before Direct is allowed to resume.
  state.replayTemplate = null;
  state.lastCursor = null;
  state.replayReadyLatch = null;
  state.replayFailureStreak = 0;
  state.replayDisabledReason = null;

  await triggerPaginationScroll(page);
  state.recoveryScrolls += 1;
  await sleep(120);
  await waitForReplayGeneration(state, beforeGeneration, waitMs);
  await drainNetwork(state, 320);

  let added = Math.max(0, all.size - beforeAccepted);
  let networkAdded = Math.max(0, state.uniqueAds.size - beforeNetwork);

  // One DOM verification is enough to distinguish a real visible tail from a
  // replay stall. Do not enter the old repeated scroll/DOM/re-entry loop.
  if (added <= 0 && networkAdded <= 0) {
    try {
      const snapshot = await domSnapshot(page);
      state.domEnrichmentScans += 1;
      mergeRows(all, snapshot.rows);
      added = Math.max(0, all.size - beforeAccepted);
      networkAdded = Math.max(0, state.uniqueAds.size - beforeNetwork);
    } catch {}
  }

  state.exhaustionProbeAdsAdded += added;
  const recovered = added > 0 || networkAdded > 0 || (state.replayReadyGeneration || 0) > beforeGeneration;
  if (!recovered) {
    state.exhaustionConfirmed = true;
    state.exhaustionReason = state.sourceExhaustedSignal
      ? 'source_exhausted'
      : state.directCursorCycleHits > 0
        ? 'cursor_cycle_detected'
        : state.directDuplicatePageHits > 0
          ? 'duplicate_page_cycle'
          : 'pagination_stalled';
  }
  return { recovered, added, networkAdded, reason: state.exhaustionReason };
}

export async function collectAds(options, { onProgress = () => {}, signal } = {}) {
  const target = Math.max(1, Number(options.target) || 100);
  const domDelayMs = Math.max(350, Number(options.delayMs) || 700);
  const networkDelayMs = Math.max(120, Number(options.networkDelayMs) || 220);
  const stableLimit = Math.max(4, Number(options.stableRounds) || 12);
  const headless = options.headless !== false;
  const requestedEngine = String(options.engine || 'network_first');
  const sourceUrl = options.sourceUrl || buildMetaUrl(options);
  const startedAt = new Date().toISOString();
  const all = new Map();
  const networkState = createNetworkState();
  networkState.directFetchTimeoutMs = Math.max(2500, Math.min(Number(options.directFetchTimeoutMs) || 4500, 8000));
  networkState.longRunFastPath = target >= 300;
  networkState.directPauseMs = Math.max(0, Math.min(Number(options.directPauseMs) || (target >= 500 ? 8 : target >= 300 ? 12 : 20), 250));
  let rounds = 0;
  let stableRounds = 0;
  let previousCount = 0;
  let detectedCount = 0;
  let pageState = null;
  let browser;
  let context;
  let effectiveEngine = requestedEngine;
  let warmupDiagnostics = null;

  const abortIfNeeded = () => {
    if (signal?.aborted) throw new Error('collection_aborted');
  };

  try {
    const workerMode = String(options.workerMode || 'local_chrome');
    if (workerMode === 'local_chrome') {
      const profileDir = path.resolve(options.profileDir || path.join(__dirname, '..', 'data', 'chrome-worker-profile'));
      fs.mkdirSync(profileDir, { recursive: true });
      onProgress({ state: 'opening', count: 0, target, engine: requestedEngine, message: 'Launching local Google Chrome worker…' });
      try {
        context = await chromium.launchPersistentContext(profileDir, {
          channel: 'chrome',
          headless: false,
          viewport: null,
          locale: 'en-US',
          timezoneId: 'Asia/Bangkok',
          args: ['--start-maximized']
        });
      } catch (error) {
        throw new Error(`system_chrome_launch_failed | ${error?.message || error} | Install Google Chrome or choose Bundled Chromium mode.`);
      }
    } else {
      browser = await chromium.launch({ headless });
      context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'en-US', timezoneId: 'Asia/Bangkok' });
    }

    const page = context.pages()[0] || await context.newPage();
    page.setDefaultTimeout(15_000);
    page.setDefaultNavigationTimeout(60_000);

    if (requestedEngine === 'network_first') {
      attachNetworkCapture(page, sourceUrl, all, networkState);
      await page.route('**/*', async (route) => {
        const type = route.request().resourceType();
        if (['font'].includes(type)) return route.abort();
        return route.continue();
      });
    }

    onProgress({ state: 'opening', count: 0, target, workerMode, engine: requestedEngine, message: requestedEngine === 'network_first'
      ? 'Loading Meta Ads Library and listening for network JSON…'
      : 'Loading Meta Ads Library with Stable DOM engine…' });

    const warmup = await navigateWithWarmup(page, sourceUrl, {
      onProgress,
      target,
      workerMode,
      engine: requestedEngine,
      maxAttempts: Math.max(2, Math.min(Number(options.warmupAttempts) || 4, 6))
    });
    warmupDiagnostics = {
      attempts: warmup.attempts,
      recovered: Boolean(warmup.recovered),
      elapsed_ms: warmup.elapsed_ms
    };
    if (!warmup.ok) {
      const diag = warmup.diag || await pageDiagnostics(page);
      if (warmup.blocked?.blocked) {
        throw new Error(`meta_access_blocked:${warmup.blocked.reason} | mode=${workerMode} | url=${diag.href} | title=${diag.title || '-'} | sample=${diag.bodySample || '-'}`);
      }
      const lastStatus = warmup.attempts?.at(-1)?.status;
      const statuses = (warmup.attempts || []).map((x) => x.status ?? 'ERR').join(',');
      throw new Error(`meta_http_${lastStatus || 'navigation_failed'} | warmup_attempts=${warmup.attempts?.length || 0} | statuses=${statuses} | mode=${workerMode} | url=${diag.href} | title=${diag.title || '-'} | sample=${diag.bodySample || '-'}`);
    }
    await page.waitForFunction(() => Boolean(document.body), null, { timeout: 20_000 });
    await dismissCookieDialog(page);

    let initial = { snapshot: null, blocked: null, source: 'skipped' };
    let snapshot = null;

    // v0.2.14 long-run fast response path: trigger one pagination request, then
    // keep a single event-driven waiter alive while the cheap DOM bootstrap runs.
    // There is no second sequential "grace" wait. Once the ready latch is set,
    // Direct owns template/cursor until it reaches Target or a real stop condition.
    let fastDomBootstrapped = false;
    if (requestedEngine === 'network_first') {
      effectiveEngine = 'network_dominant_response_pivot';
      await sleep(180);
      await drainNetwork(networkState, 260);

      let earlyReady = isReplayReady(networkState);
      if (all.size < target && !earlyReady) {
        const surfaceReady = await waitForPaginationSurface(page, Math.max(700, Math.min(Number(options.earlySurfaceWaitMs) || 1350, 3000)));
        if (surfaceReady && all.size < target && !isReplayReady(networkState)) {
          abortIfNeeded();
          await triggerPaginationScroll(page);
          networkState.paginationScrolls += 1;
          networkState.earlyTemplateScrolls += 1;
          rounds += 1;

          const pivotWaitMs = Math.max(1200, Math.min(Number(options.responsePivotWaitMs) || 3800, 5200));
          const readyPromise = waitForReplayReady(networkState, pivotWaitMs);

          // Overlap one inexpensive DOM bootstrap with the in-flight pagination
          // response instead of waiting first and then paying a separate grace stall.
          await sleep(90);
          if (all.size < target && !isReplayReady(networkState)) {
            await installExtractor(page);
            await sleep(90);
            try {
              snapshot = await domSnapshot(page);
              networkState.domEnrichmentScans += 1;
              networkState.fastDomBootstrapScans += 1;
              pageState = snapshot;
              mergeRows(all, snapshot.rows);
              detectedCount = Math.max(detectedCount, all.size);
              fastDomBootstrapped = true;
            } catch {}
          }

          const readyResult = await readyPromise;
          earlyReady = readyResult.ready || isReplayReady(networkState);
        }
      }

      if (all.size < target && (earlyReady || isReplayReady(networkState))) {
        networkState.earlyTemplateReady = true;
        effectiveEngine = 'network_dominant_response_pivot';
        const earlyDirect = await runDirectUntilTarget(page, sourceUrl, all, networkState, target, { pauseMs: 30 });
        networkState.earlyDirectPages += earlyDirect.pages;
        detectedCount = Math.max(detectedCount, all.size);
      }
    }

    // Only pay the full initial-results bootstrap cost when the response-driven path
    // neither finished nor already performed the one fast DOM bootstrap above.
    if (all.size < target && !fastDomBootstrapped) {
      await installExtractor(page);
      await sleep(requestedEngine === 'network_first' ? 240 : 1600);
      await drainNetwork(networkState, requestedEngine === 'network_first' ? 420 : 1200);

      initial = await waitForInitialResults(page, all, networkState, requestedEngine, {
        timeoutMs: requestedEngine === 'network_first' ? 7_000 : 16_000
      });
      snapshot = initial.snapshot || null;
      pageState = snapshot || pageState;
      if (snapshot?.rows?.length) mergeRows(all, snapshot.rows);

      if (initial.blocked?.blocked && all.size === 0) {
        const diag = initial.blocked.access || await accessDiagnostics(page);
        throw new Error(`meta_access_blocked:${initial.blocked.reason} | url=${diag.href} | title=${diag.title || '-'} | sample=${diag.bodySample || '-'}`);
      }
    }

    if (requestedEngine === 'network_first') {
      if (!effectiveEngine.startsWith('network_dominant')) effectiveEngine = 'network_dominant';

      // 1) Complete at most two bootstrap scrolls TOTAL, including the early
      // capture probe above. Wait on replay readiness rather than a fixed long sleep.
      const remainingBootstrapScrolls = Math.max(0, 2 - networkState.paginationScrolls);
      for (let bootstrap = 0; bootstrap < remainingBootstrapScrolls && all.size < target && (!networkState.replayTemplate || !networkState.lastCursor); bootstrap += 1) {
        abortIfNeeded();
        await triggerPaginationScroll(page);
        networkState.paginationScrolls += 1;
        rounds += 1;
        await sleep(Math.min(networkDelayMs, 160));
        await waitForReplayReady(networkState, Math.max(650, Math.min(Number(options.bootstrapTemplateWaitMs) || 1150, 2800)));
        await drainNetwork(networkState, 220);
        detectedCount = Math.max(detectedCount, all.size);
        const accepted = [...all.values()].slice(0, target);
        onProgress({
          state: 'collecting', count: accepted.length, detectedCount, target, rounds, stableRounds,
          engine: effectiveEngine,
          networkAds: networkState.uniqueAds.size,
          replaySuccesses: networkState.replaySuccesses,
          graphqlResponses: networkState.graphqlResponses,
          scrollTriggers: networkState.paginationScrolls + networkState.recoveryScrolls,
          warmupAttempts: warmupDiagnostics?.attempts?.length || 0,
          warmupRecovered: Boolean(warmupDiagnostics?.recovered),
          quality: quality(accepted),
          message: `Network bootstrap: ${networkState.uniqueAds.size} network ads · ${networkState.paginationScrolls} scroll trigger(s)`
        });
      }

      // 2) Once a real AdLibrarySearchPaginationQuery is observed, keep Direct
      // GraphQL running only until the accepted union (DOM + Network) reaches Target.
      // Network confirmation still counts as progress, but it no longer forces us
      // to fetch extra pages after enough unique exportable Ads already exist.
      if (all.size < target && networkState.replayTemplate && networkState.lastCursor) {
        await runDirectUntilTarget(page, sourceUrl, all, networkState, target);
        detectedCount = Math.max(detectedCount, all.size);
      }

      // v0.2.14 long-run mode: when Direct stalls, do exactly one fresh natural
      // pagination + DOM verification. Resume Direct only if that probe proves new
      // progress. This keeps 500–1,000 Ad jobs fast and prevents the old 13-scroll /
      // 15-burst loop seen when the source tail had no new unique Ads.
      const maxLongRunContinuationEpochs = target >= 500 ? 8 : 4;
      while (all.size < target && !networkState.exhaustionConfirmed && shouldVerifyLongRunStop(networkState.directStopReason) && networkState.longRunContinuationEpochs < maxLongRunContinuationEpochs) {
        abortIfNeeded();
        const probe = await verifyLongRunPagination(page, sourceUrl, all, networkState, target, {
          waitMs: Math.max(700, Math.min(Number(options.exhaustionProbeWaitMs) || 1500, 3000))
        });
        rounds += 1;
        detectedCount = Math.max(detectedCount, all.size);
        if (!probe.recovered) break;
        networkState.longRunContinuationEpochs += 1;
        if (all.size < target && networkState.replayTemplate && networkState.lastCursor) {
          await runDirectUntilTarget(page, sourceUrl, all, networkState, target);
          detectedCount = Math.max(detectedCount, all.size);
        } else {
          break;
        }
      }

      // 3) If direct pagination stalls before target, use a tiny number of recovery
      // scroll triggers to let the page refresh its cursor/template, then burst again.
      const maxRecoveryScrolls = Math.max(1, Math.min(Number(options.recoveryScrolls) || 2, 4));
      while (all.size < target && !networkState.exhaustionConfirmed && networkState.recoveryScrolls < maxRecoveryScrolls) {
        abortIfNeeded();
        const beforeRecovery = all.size;
        await triggerPaginationScroll(page);
        networkState.recoveryScrolls += 1;
        rounds += 1;
        await sleep(Math.min(networkDelayMs, 160));
        await waitForReplayReady(networkState, Math.max(650, Math.min(Number(options.recoveryTemplateWaitMs) || 1050, 2600)));
        await drainNetwork(networkState, 220);

        if (networkState.replayTemplate && networkState.lastCursor && all.size < target) {
          await runDirectUntilTarget(page, sourceUrl, all, networkState, target);
        }

        detectedCount = Math.max(detectedCount, all.size);
        const accepted = [...all.values()].slice(0, target);
        onProgress({
          state: 'collecting', count: accepted.length, detectedCount, target, rounds, stableRounds,
          engine: effectiveEngine,
          networkAds: networkState.uniqueAds.size,
          replaySuccesses: networkState.replaySuccesses,
          graphqlResponses: networkState.graphqlResponses,
          scrollTriggers: networkState.paginationScrolls + networkState.recoveryScrolls,
          warmupAttempts: warmupDiagnostics?.attempts?.length || 0,
          warmupRecovered: Boolean(warmupDiagnostics?.recovered),
          quality: quality(accepted),
          message: `Target-aware Direct: ${Math.min(all.size, target)}/${target} accepted · ${networkState.uniqueAds.size} network ads · direct ${networkState.replaySuccesses}/${networkState.replayAttempts} · ${networkState.directStopReason || 'running'}`
        });

        if (all.size <= beforeRecovery && (!networkState.replayTemplate || networkState.replayFailureStreak >= 2)) break;
      }

      // 4) Stable DOM fallback remains available, but it is no longer a one-way
      // path. A replayable AdLibrarySearchPaginationQuery can appear late, after
      // several page-driven scrolls. Check for it before every DOM scan and again
      // immediately after each scroll/network drain, then pivot back to Direct
      // GraphQL as soon as the template + cursor exist.
      if (all.size < target && !networkState.exhaustionConfirmed) {
        effectiveEngine = 'network_dominant_dom_fallback';
        previousCount = all.size;
        stableRounds = 0;
        while (all.size < target && stableRounds < stableLimit && rounds < 800) {
          abortIfNeeded();

          // Late-template re-entry before doing more DOM work. This catches a
          // GraphQL template discovered by the previous fallback scroll.
          if (all.size < target && networkState.replayTemplate && networkState.lastCursor) {
            effectiveEngine = 'network_dominant_reentry';
            networkState.lateTemplateReentries += 1;
            const reentry = await runDirectUntilTarget(page, sourceUrl, all, networkState, target);
            networkState.lateTemplateReentryPages += reentry.pages;
            detectedCount = Math.max(detectedCount, all.size);
            const accepted = [...all.values()].slice(0, target);
            onProgress({
              state: 'collecting', count: accepted.length, detectedCount, target, rounds, stableRounds,
              engine: effectiveEngine,
              networkAds: networkState.uniqueAds.size,
              replaySuccesses: networkState.replaySuccesses,
              graphqlResponses: networkState.graphqlResponses,
              scrollTriggers: networkState.paginationScrolls + networkState.recoveryScrolls,
              warmupAttempts: warmupDiagnostics?.attempts?.length || 0,
              warmupRecovered: Boolean(warmupDiagnostics?.recovered),
              quality: quality(accepted),
              message: `Late GraphQL re-entry: ${Math.min(all.size, target)}/${target} accepted · ${networkState.uniqueAds.size} network ads · +${reentry.pages} direct page(s) · ${networkState.directStopReason || 'running'}`
            });
            if (all.size >= target) break;
            if (shouldVerifyLongRunStop(networkState.directStopReason)) break;
            effectiveEngine = 'network_dominant_dom_fallback';
          }

          // v0.2.14 probes Network BEFORE paying for another DOM extraction.
          // If the late pagination request appears, pivot immediately and skip the scan.
          await rapidScroll(page);
          networkState.recoveryScrolls += 1;
          rounds += 1;
          await sleep(Math.min(domDelayMs, 260));
          await waitForReplayReady(networkState, Math.max(600, Math.min(Number(options.fallbackTemplateWaitMs) || 900, 2400)));
          await drainNetwork(networkState, 200);

          if (all.size < target && networkState.replayTemplate && networkState.lastCursor) {
            effectiveEngine = 'network_dominant_reentry';
            networkState.lateTemplateReentries += 1;
            const reentry = await runDirectUntilTarget(page, sourceUrl, all, networkState, target);
            networkState.lateTemplateReentryPages += reentry.pages;
            detectedCount = Math.max(detectedCount, all.size);
            const accepted = [...all.values()].slice(0, target);
            onProgress({
              state: 'collecting', count: accepted.length, detectedCount, target, rounds, stableRounds,
              engine: effectiveEngine,
              networkAds: networkState.uniqueAds.size,
              replaySuccesses: networkState.replaySuccesses,
              graphqlResponses: networkState.graphqlResponses,
              scrollTriggers: networkState.paginationScrolls + networkState.recoveryScrolls,
              warmupAttempts: warmupDiagnostics?.attempts?.length || 0,
              warmupRecovered: Boolean(warmupDiagnostics?.recovered),
              quality: quality(accepted),
              message: `Fast GraphQL pivot after scroll: ${Math.min(all.size, target)}/${target} accepted · ${networkState.uniqueAds.size} network ads · +${reentry.pages} direct page(s)`
            });
            if (all.size >= target) break;
            if (shouldVerifyLongRunStop(networkState.directStopReason)) break;
            effectiveEngine = 'network_dominant_dom_fallback';
          }

          // Only scan the DOM when the network probe still did not expose a usable
          // pagination template/cursor or Direct could not finish the target.
          snapshot = await domSnapshot(page);
          networkState.domEnrichmentScans += 1;
          pageState = snapshot;
          mergeRows(all, snapshot.rows);
          detectedCount = Math.max(detectedCount, all.size);
          if (all.size >= target) break;

          stableRounds = all.size === previousCount ? stableRounds + 1 : 0;
          previousCount = all.size;
        }
      }
    } else {
      while (all.size < target && stableRounds < stableLimit && rounds < 800) {
        abortIfNeeded();
        rounds += 1;
        snapshot = await domSnapshot(page);
        pageState = snapshot;
        mergeRows(all, snapshot.rows);
        detectedCount = Math.max(detectedCount, all.size);
        stableRounds = all.size === previousCount ? stableRounds + 1 : 0;
        previousCount = all.size;
        const accepted = [...all.values()].slice(0, target);
        onProgress({
          state: 'collecting', count: accepted.length, detectedCount, target, rounds, stableRounds,
          engine: effectiveEngine, quality: quality(accepted), pageHeight: pageState?.pageHeight, scrollY: pageState?.scrollY,
          message: 'Stable DOM collection'
        });
        if (all.size >= target) break;
        await rapidScroll(page);
        await sleep(domDelayMs);
      }
    }

    // Final enrichment: Network-first performs at most one DOM scan when no fallback
    // scan was needed. If fallback already scanned the DOM, do not repeat the work.
    if (requestedEngine === 'network_first') {
      if (networkState.domEnrichmentScans === 0) {
        try {
          snapshot = await domSnapshot(page);
          networkState.domEnrichmentScans += 1;
          pageState = snapshot;
          mergeRows(all, snapshot.rows);
        } catch {}
      }
    } else {
      try {
        snapshot = await domSnapshot(page);
        pageState = snapshot;
        mergeRows(all, snapshot.rows);
      } catch {}
    }
    await drainNetwork(networkState, 700);

    const records = [...all.values()].slice(0, target);
    if (!records.length) {
      const diag = await accessDiagnostics(page);
      const block = classifyAccessBlock(diag);
      if (block.blocked) throw new Error(`meta_access_blocked:${block.reason} | url=${diag.href} | title=${diag.title || '-'} | sample=${diag.bodySample || '-'}`);
    }
    const reason = records.length >= target
      ? 'target_reached'
      : networkState.exhaustionConfirmed
        ? networkState.exhaustionReason || 'pagination_stalled'
        : stableRounds >= stableLimit
          ? 'no_more_items'
          : 'round_limit';
    const finishedAt = new Date().toISOString();
    const result = makeExport({
      sourceUrl, startedAt, finishedAt, target, detectedCount: Math.max(detectedCount, all.size), records, rounds, reason, pageState,
      engine: effectiveEngine,
      networkDiagnostics: requestedEngine === 'network_first' ? networkDiagnostics(networkState, records) : null,
      warmupDiagnostics
    });
    onProgress({
      state: 'finished', count: records.length, target, reason, engine: effectiveEngine,
      networkAds: networkState.uniqueAds.size, replaySuccesses: networkState.replaySuccesses,
      graphqlResponses: networkState.graphqlResponses,
      warmupAttempts: warmupDiagnostics?.attempts?.length || 0,
      warmupRecovered: Boolean(warmupDiagnostics?.recovered),
      quality: result.summary.quality, result
    });
    await context.close();
    context = null;
    return result;
  } finally {
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}
