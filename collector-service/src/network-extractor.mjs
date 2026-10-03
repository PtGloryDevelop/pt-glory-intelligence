const unique = (values) => [...new Set((values || []).filter(Boolean))];

function firstDefined(obj, paths) {
  for (const path of paths) {
    let cur = obj;
    let ok = true;
    for (const part of path.split('.')) {
      if (cur == null || !(part in Object(cur))) { ok = false; break; }
      cur = cur[part];
    }
    if (ok && cur != null && cur !== '') return cur;
  }
  return null;
}

function walkValues(value, fn, path = '', seen = new WeakSet()) {
  if (!value || typeof value !== 'object') return;
  if (seen.has(value)) return;
  seen.add(value);
  fn(value, path);
  if (Array.isArray(value)) {
    value.forEach((item, i) => walkValues(item, fn, `${path}[${i}]`, seen));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (child && typeof child === 'object') walkValues(child, fn, path ? `${path}.${key}` : key, seen);
  }
}

function keyEntriesDeep(root, wantedKeys) {
  const wanted = new Set(wantedKeys.map((k) => k.toLowerCase()));
  const out = [];
  walkValues(root, (obj, path) => {
    if (Array.isArray(obj)) return;
    for (const [key, value] of Object.entries(obj)) {
      if (wanted.has(String(key).toLowerCase()) && value != null && value !== '') out.push({ key, value, path: path ? `${path}.${key}` : key });
    }
  });
  return out;
}

function firstDeep(root, keys, predicate = () => true) {
  const found = keyEntriesDeep(root, keys).find((x) => predicate(x.value));
  return found?.value ?? null;
}

function toStringId(value) {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return String(Math.trunc(value));
  const text = String(value).trim();
  return /^\d{5,}$/.test(text) ? text : null;
}

function timestampToDate(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'string' && /\b\d{1,2}\s+[A-Za-z]{3}\s+\d{4}\b/.test(value)) return value.match(/\b\d{1,2}\s+[A-Za-z]{3}\s+\d{4}\b/)[0];
  let n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n > 1e12) n /= 1000;
  if (n < 946684800 || n > 4102444800) return null;
  const d = new Date(n * 1000);
  if (Number.isNaN(d.getTime())) return null;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function normalizeUrl(value) {
  if (!value) return null;
  const s = String(value).trim();
  if (!/^https?:\/\//i.test(s)) return null;
  try { return new URL(s).href; } catch { return null; }
}

function collectUrls(root, { videos = false, images = false } = {}) {
  const found = [];
  walkValues(root, (obj) => {
    if (Array.isArray(obj)) return;
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value !== 'string') continue;
      const url = normalizeUrl(value);
      if (!url) continue;
      const k = key.toLowerCase();
      if (videos && (k.includes('video') || /\.mp4(?:\?|$)/i.test(url))) found.push(url);
      if (images && (k.includes('image') || k.includes('thumbnail') || k.includes('picture') || k.includes('poster') || /\.(?:jpe?g|png|webp)(?:\?|$)/i.test(url))) found.push(url);
    }
  });
  return unique(found);
}

function collectTextUrls(text) {
  const matches = String(text || '').match(/(?:https?:\/\/|www\.|m\.me\/|bit\.ly\/|lin\.ee\/)[^\s<>"'’”]+/gi) || [];
  return unique(matches.map((v) => /^https?:\/\//i.test(v) ? v : `https://${v}`).map(normalizeUrl));
}

function firstText(root, keys) {
  const value = firstDeep(root, keys, (v) => typeof v === 'string' && v.trim().length > 0);
  return value == null ? null : String(value).trim();
}

function directArchiveId(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  for (const key of ['ad_archive_id','adArchiveID','ad_archiveID','archive_id','archiveId','library_id','libraryId']) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const id = toStringId(obj[key]);
      if (id) return id;
    }
  }
  return null;
}

function findArchiveId(obj) {
  const direct = directArchiveId(obj);
  if (direct) return direct;
  const deep = firstDeep(obj, ['ad_archive_id','adArchiveID','ad_archiveID','archive_id','archiveId','library_id','libraryId'], (v) => !!toStringId(v));
  return toStringId(deep);
}

function normalizePageUrl(value) {
  const href = normalizeUrl(value);
  if (!href) return null;
  try {
    const u = new URL(href);
    if (!/facebook\.com$/i.test(u.hostname) && !/\.facebook\.com$/i.test(u.hostname)) return href;
    u.hash = '';
    const keepId = u.searchParams.get('id');
    u.search = '';
    if (keepId) u.searchParams.set('id', keepId);
    if (!/\.[a-z0-9]+$/i.test(u.pathname) && u.pathname !== '/') u.pathname = u.pathname.replace(/\/+$/, '') + '/';
    return u.href;
  } catch { return href; }
}

function normalizePlatform(value) {
  const values = Array.isArray(value) ? value : [value];
  return unique(values.flatMap((v) => typeof v === 'string' ? v.split(/[,|]/) : []).map((x) => x.trim().toUpperCase()).filter((x) => ['FACEBOOK','INSTAGRAM','MESSENGER','AUDIENCE_NETWORK','THREADS'].includes(x)));
}

function candidateScore(obj) {
  // Only treat objects that own an Ad/Library ID as ad records.
  // This prevents broad parent containers from absorbing media/text from sibling ads.
  const adId = directArchiveId(obj);
  if (!adId) return 0;
  let score = 4;
  if (firstDeep(obj, ['page_id','pageId','pageID'], (v) => !!toStringId(v))) score += 2;
  if (firstText(obj, ['page_name','pageName'])) score += 2;
  if (firstDeep(obj, ['start_date','startDate','start_date_raw','startDateRaw','ad_delivery_start_time'])) score += 1;
  if (firstText(obj, ['body','ad_creative_body','adCreativeBody','text','message'])) score += 1;
  if (collectUrls(obj, { images: true }).length || collectUrls(obj, { videos: true }).length) score += 1;
  return score;
}

function bestBody(obj) {
  const direct = firstDefined(obj, ['ad_creative_body','adCreativeBody','body','message','text','snapshot.body.text','snapshot.body']);
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  return firstText(obj, ['ad_creative_body','adCreativeBody','body','message','text','caption','description']);
}

function normalizeCandidate(obj, sourceUrl, path) {
  const adId = directArchiveId(obj);
  if (!adId) return null;
  const pageId = toStringId(firstDeep(obj, ['page_id','pageId','pageID'], (v) => !!toStringId(v)));
  const pageName = firstText(obj, ['page_name','pageName','page_title','pageTitle','name']);
  const pageUrl = normalizePageUrl(firstDeep(obj, ['page_url','pageUrl','page_profile_uri','pageProfileUri','profile_url','profileUrl'], (v) => !!normalizeUrl(v)));
  const startRaw = firstDeep(obj, ['start_date_raw','startDateRaw','start_date','startDate','ad_delivery_start_time','adDeliveryStartTime']);
  const endRaw = firstDeep(obj, ['end_date_raw','endDateRaw','end_date','endDate','ad_delivery_stop_time','adDeliveryStopTime']);
  const startDate = timestampToDate(startRaw) || (typeof startRaw === 'string' ? startRaw : null);
  const endDate = timestampToDate(endRaw) || (typeof endRaw === 'string' ? endRaw : null);
  const body = bestBody(obj) || '';
  const allImages = collectUrls(obj, { images: true });
  const posters = allImages.filter((u) => /poster|thumbnail/i.test(u));
  const auxiliaryImages = allImages.filter((u) => /s60x60|\b60x60\b/i.test(u));
  const images = allImages.filter((u) => !/s60x60|\b60x60\b/i.test(u) && !posters.includes(u));
  const videos = collectUrls(obj, { videos: true }).filter((u) => /\.mp4(?:\?|$)|video/i.test(u));
  const platforms = normalizePlatform(firstDeep(obj, ['publisher_platform','publisher_platforms','publisherPlatforms','platforms']));
  const activeRaw = firstDeep(obj, ['is_active','isActive','active_status','activeStatus','status']);
  const isActive = typeof activeRaw === 'boolean' ? (activeRaw ? 'active' : 'inactive') : /inactive/i.test(String(activeRaw || '')) ? 'inactive' : /active/i.test(String(activeRaw || '')) ? 'active' : 'unknown';
  const ctaType = firstText(obj, ['cta_type','ctaType','call_to_action_type','callToActionType']);
  const ctaUrl = normalizeUrl(firstDeep(obj, ['cta_destination_url','ctaDestinationUrl','link_url','linkUrl','link_url_original','website_url','websiteUrl'], (v) => !!normalizeUrl(v)));
  const detailsUrl = normalizeUrl(firstDeep(obj, ['ad_details_url','adDetailsUrl','library_url','libraryUrl'], (v) => !!normalizeUrl(v)));
  const collation = Number(firstDeep(obj, ['collation_count','collationCount','collation_count_raw','similar_ads_count']));
  const collationCount = Number.isFinite(collation) && collation > 0 ? collation : null;
  let query = null;
  try { query = new URL(sourceUrl).searchParams.get('q'); } catch {}
  const queryFields = [];
  const needle = String(query || '').toLocaleLowerCase();
  if (needle && String(pageName || '').toLocaleLowerCase().includes(needle)) queryFields.push('page_name');
  if (needle && body.toLocaleLowerCase().includes(needle)) queryFields.push('body_clean');
  const pageIdentityKey = pageId ? `page:${pageId}` : pageUrl ? `url:${pageUrl}` : null;
  const format = videos.length ? 'VIDEO' : images.length > 1 ? 'MULTI_IMAGE' : images.length === 1 ? 'SINGLE_IMAGE' : 'UNKNOWN';
  const bodyUrls = collectTextUrls(body);
  const fieldEvidence = {
    ad_archive_id: { source: 'network_json', strength: 'deterministic', evidence: adId },
    page_id: pageId ? { source: 'network_json', strength: 'deterministic', evidence: pageId } : null,
    page_identity_key: pageIdentityKey ? { source: pageId ? 'page_id' : 'canonical_page_url', strength: 'deterministic', evidence: pageIdentityKey } : null,
    start_date_raw: startDate ? { source: 'network_json', strength: 'observed', evidence: String(startRaw) } : null,
    cta_type: ctaType ? { source: 'network_json', strength: 'observed', evidence: ctaType } : null,
    cta_destination_url: ctaUrl ? { source: 'network_json', strength: 'observed', evidence: ctaUrl } : null,
    collation_count: collationCount != null ? { source: 'network_json', strength: 'observed', evidence: String(collationCount) } : null,
    publisher_platform: platforms.length ? { source: 'network_json', strength: 'observed', evidence: platforms.join(',') } : null,
    ad_details_url: detailsUrl ? { source: 'network_json', strength: 'observed', evidence: detailsUrl } : null
  };
  return {
    ad_archive_id: adId,
    page_id: pageId,
    page_identity_key: pageIdentityKey,
    page_name: pageName,
    page_name_snapshot: pageName,
    page_url: pageUrl,
    page_like_count: null,
    page_categories: [],
    start_date_raw: startDate,
    end_date_raw: endDate,
    is_active: isActive,
    body,
    body_raw: body,
    body_clean: body,
    body_urls: bodyUrls,
    cta_type: ctaType ? String(ctaType).toUpperCase() : null,
    cta_observation: ctaType ? 'confirmed' : 'unknown',
    cta_destination_url: ctaUrl,
    link_url: ctaUrl,
    display_format: format,
    publisher_platform: platforms,
    platform_observation: platforms.length ? 'observed' : 'unobserved',
    collation_count: collationCount,
    collation_observation: collationCount != null ? 'observed' : 'unobserved',
    images,
    auxiliary_images: auxiliaryImages,
    videos,
    video_posters: posters,
    media: { format, images, video_posters: posters, videos, auxiliary_images: auxiliaryImages },
    cards: [],
    ad_details_url: detailsUrl,
    query_match_observed: query ? queryFields.length > 0 : null,
    query_match_fields: queryFields,
    query_relevance_status: !query ? 'not_evaluated' : queryFields.length ? 'exact_text_match' : 'no_observed_exact_text_match',
    field_evidence: fieldEvidence,
    raw_text: body,
    extraction_source: 'meta_network_json_v0.2',
    captured_at: new Date().toISOString(),
    network_path: path || null
  };
}

export function parseFacebookPayload(text) {
  if (!text) return [];
  let source = String(text).trim();
  source = source.replace(/^for\s*\(\s*;;\s*\)\s*;?/, '').trim();
  const values = [];
  const tryParse = (chunk) => {
    const c = String(chunk || '').trim();
    if (!c) return;
    try { values.push(JSON.parse(c)); } catch {}
  };
  tryParse(source);
  if (!values.length) {
    for (const line of source.split(/\r?\n/)) tryParse(line);
  }
  return values;
}

export function extractAdsFromPayload(payload, sourceUrl) {
  const candidates = [];
  walkValues(payload, (obj, path) => {
    if (Array.isArray(obj)) return;
    const score = candidateScore(obj);
    if (score >= 7) candidates.push({ score, obj, path });
  });
  candidates.sort((a, b) => b.score - a.score || a.path.length - b.path.length);
  const rows = new Map();
  for (const candidate of candidates) {
    const row = normalizeCandidate(candidate.obj, sourceUrl, candidate.path);
    if (!row?.ad_archive_id) continue;
    if (!rows.has(row.ad_archive_id)) rows.set(row.ad_archive_id, row);
  }
  return [...rows.values()];
}

export function findCursorCandidates(payload) {
  const keys = ['end_cursor','endCursor','next_cursor','nextCursor','cursor','after'];
  const values = keyEntriesDeep(payload, keys)
    .filter((x) => typeof x.value === 'string' && x.value.length >= 8 && x.value.length <= 2048)
    .map((x) => ({ path: x.path, value: x.value }));
  const seen = new Set();
  return values.filter((x) => {
    const key = `${x.path}|${x.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 20);
}

export function findPaginationState(payload) {
  const states = [];
  walkValues(payload, (obj, path) => {
    if (Array.isArray(obj) || !obj || typeof obj !== 'object') return;
    const hasSnake = Object.prototype.hasOwnProperty.call(obj, 'has_next_page');
    const hasCamel = Object.prototype.hasOwnProperty.call(obj, 'hasNextPage');
    const endSnake = Object.prototype.hasOwnProperty.call(obj, 'end_cursor');
    const endCamel = Object.prototype.hasOwnProperty.call(obj, 'endCursor');
    if (!hasSnake && !hasCamel && !endSnake && !endCamel) return;
    const rawHasNext = hasSnake ? obj.has_next_page : hasCamel ? obj.hasNextPage : null;
    const rawEndCursor = endSnake ? obj.end_cursor : endCamel ? obj.endCursor : null;
    states.push({
      path,
      has_next_page: typeof rawHasNext === 'boolean' ? rawHasNext : null,
      end_cursor_present: endSnake || endCamel,
      end_cursor: typeof rawEndCursor === 'string' && rawEndCursor ? rawEndCursor : null
    });
  });
  return states.slice(0, 20);
}

export function sanitizeNetworkUrl(url) {
  try {
    const u = new URL(url);
    for (const key of [...u.searchParams.keys()]) {
      if (/token|key|secret|session|lsd|fb_dtsg|jazoest/i.test(key)) u.searchParams.set(key, '[redacted]');
    }
    return `${u.origin}${u.pathname}${u.search}`;
  } catch { return String(url || '').slice(0, 500); }
}

function setDeepCursor(value, nextCursor) {
  let changedPath = null;
  function walk(node, path = '') {
    if (changedPath || !node || typeof node !== 'object') return;
    for (const [key, child] of Object.entries(node)) {
      const here = path ? `${path}.${key}` : key;
      if (/^(cursor|after|end_cursor|endCursor)$/i.test(key) && (child == null || typeof child === 'string')) {
        node[key] = nextCursor;
        changedPath = here;
        return;
      }
      if (child && typeof child === 'object') walk(child, here);
      if (changedPath) return;
    }
  }
  walk(value);
  return changedPath;
}

export function buildReplayBody(postData, contentType, nextCursor) {
  if (!postData || !nextCursor) return null;
  const ct = String(contentType || '').toLowerCase();
  if (ct.includes('application/x-www-form-urlencoded') || String(postData).includes('variables=')) {
    const params = new URLSearchParams(String(postData));
    const rawVariables = params.get('variables');
    if (!rawVariables) return null;
    try {
      const variables = JSON.parse(rawVariables);
      const cursorPath = setDeepCursor(variables, nextCursor);
      if (!cursorPath) return null;
      params.set('variables', JSON.stringify(variables));
      return { body: params.toString(), cursorPath, variableKeys: Object.keys(variables) };
    } catch { return null; }
  }
  if (ct.includes('application/json') || /^[\[{]/.test(String(postData).trim())) {
    try {
      const parsed = JSON.parse(String(postData));
      const target = parsed.variables && typeof parsed.variables === 'object' ? parsed.variables : parsed;
      const cursorPath = setDeepCursor(target, nextCursor);
      if (!cursorPath) return null;
      return { body: JSON.stringify(parsed), cursorPath, variableKeys: Object.keys(target || {}) };
    } catch { return null; }
  }
  return null;
}



function mergeExcludedIds(value, ids = []) {
  const cleanIds = unique((ids || []).map(toStringId).filter(Boolean));
  if (!cleanIds.length || !value || typeof value !== 'object') return { path: null, added: 0 };
  let result = { path: null, added: 0 };
  function walk(node, path = '') {
    if (result.path || !node || typeof node !== 'object') return;
    for (const [key, child] of Object.entries(node)) {
      const here = path ? `${path}.${key}` : key;
      if (/^excludedIDs$/i.test(key) && Array.isArray(child)) {
        const before = new Set(child.map((x) => String(x)));
        const merged = [...child];
        for (const id of cleanIds) {
          if (!before.has(id)) {
            before.add(id);
            merged.push(id);
          }
        }
        // Keep the request bounded. The browser normally carries a relatively
        // small exclusion list; the newest IDs are the most relevant here.
        node[key] = merged.slice(-800);
        result = { path: here, added: Math.max(0, node[key].length - child.length) };
        return;
      }
      if (child && typeof child === 'object') walk(child, here);
      if (result.path) return;
    }
  }
  walk(value);
  return result;
}

export function buildDirectPaginationBody(postData, contentType, nextCursor, excludedIds = []) {
  if (!postData || !nextCursor) return null;
  const ct = String(contentType || '').toLowerCase();
  if (ct.includes('application/x-www-form-urlencoded') || String(postData).includes('variables=')) {
    const params = new URLSearchParams(String(postData));
    const rawVariables = params.get('variables');
    if (!rawVariables) return null;
    try {
      const variables = JSON.parse(rawVariables);
      const reqSeq = params.get('__req');
      if (reqSeq && /^[0-9a-z]+$/i.test(reqSeq)) {
        const n = Number.parseInt(reqSeq, 36);
        if (Number.isFinite(n)) params.set('__req', (n + 1).toString(36));
      }
      const cursorPath = setDeepCursor(variables, nextCursor);
      if (!cursorPath) return null;
      const excluded = mergeExcludedIds(variables, excludedIds);
      params.set('variables', JSON.stringify(variables));
      return {
        body: params.toString(),
        cursorPath,
        excludedIdsPath: excluded.path,
        excludedIdsAdded: excluded.added,
        variableKeys: Object.keys(variables)
      };
    } catch { return null; }
  }
  if (ct.includes('application/json') || /^[\[{]/.test(String(postData).trim())) {
    try {
      const parsed = JSON.parse(String(postData));
      const target = parsed.variables && typeof parsed.variables === 'object' ? parsed.variables : parsed;
      const cursorPath = setDeepCursor(target, nextCursor);
      if (!cursorPath) return null;
      const excluded = mergeExcludedIds(target, excludedIds);
      return {
        body: JSON.stringify(parsed),
        cursorPath,
        excludedIdsPath: excluded.path,
        excludedIdsAdded: excluded.added,
        variableKeys: Object.keys(target || {})
      };
    } catch { return null; }
  }
  return null;
}

export function requestCursorShape(postData, contentType) {
  if (!postData) return { replayable: false, cursorPaths: [], variableKeys: [] };
  const ct = String(contentType || '').toLowerCase();
  let target = null;
  if (ct.includes('application/x-www-form-urlencoded') || String(postData).includes('variables=')) {
    try {
      const params = new URLSearchParams(String(postData));
      target = JSON.parse(params.get('variables') || '{}');
    } catch {}
  } else {
    try {
      const parsed = JSON.parse(String(postData));
      target = parsed.variables && typeof parsed.variables === 'object' ? parsed.variables : parsed;
    } catch {}
  }
  if (!target || typeof target !== 'object') return { replayable: false, cursorPaths: [], variableKeys: [] };
  const cursorPaths = [];
  walkValues(target, (obj, path) => {
    if (Array.isArray(obj)) return;
    for (const [key] of Object.entries(obj)) {
      if (/^(cursor|after|end_cursor|endCursor)$/i.test(key)) cursorPaths.push(path ? `${path}.${key}` : key);
    }
  });
  return { replayable: cursorPaths.length > 0, cursorPaths: unique(cursorPaths), variableKeys: Object.keys(target) };
}


function scalarKind(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function safeObjectKeys(value, limit = 24) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.keys(value).slice(0, limit);
}

export function inspectGraphqlPayload(payload, { maxInterestingPaths = 80, maxArrays = 20, maxNodes = 20000 } = {}) {
  const interestingKey = /(ad|archive|library|creative|snapshot|result|edge|node|page_info|pageinfo|cursor|pagination|search|collat|platform)/i;
  const idKey = /(ad.*id|archive.*id|library.*id|page.*id|id)$/i;
  const interestingPaths = [];
  const idLikePaths = [];
  const arrays = [];
  const directAdObjectPaths = [];
  let objectCount = 0;
  let arrayCount = 0;
  let scalarCount = 0;
  let maxDepth = 0;
  let nodesSeen = 0;

  const walk = (value, path = '$', depth = 0) => {
    if (nodesSeen >= maxNodes) return;
    nodesSeen += 1;
    maxDepth = Math.max(maxDepth, depth);
    if (value == null || typeof value !== 'object') {
      scalarCount += 1;
      return;
    }
    if (Array.isArray(value)) {
      arrayCount += 1;
      const firstObject = value.find((item) => item && typeof item === 'object' && !Array.isArray(item));
      arrays.push({
        path,
        length: value.length,
        item_type: value.length ? scalarKind(value[0]) : 'empty',
        item_keys: safeObjectKeys(firstObject, 18)
      });
      for (let i = 0; i < value.length && nodesSeen < maxNodes; i += 1) walk(value[i], `${path}[${i}]`, depth + 1);
      return;
    }

    objectCount += 1;
    if (directArchiveId(value)) directAdObjectPaths.push(path);
    for (const [key, child] of Object.entries(value)) {
      const childPath = `${path}.${key}`;
      if (interestingKey.test(key) && interestingPaths.length < maxInterestingPaths) {
        interestingPaths.push({ path: childPath, type: scalarKind(child) });
      }
      if (idKey.test(key) && idLikePaths.length < maxInterestingPaths) {
        idLikePaths.push({ path: childPath, type: scalarKind(child), string_length: typeof child === 'string' ? child.length : null });
      }
      walk(child, childPath, depth + 1);
      if (nodesSeen >= maxNodes) break;
    }
  };

  walk(payload);
  arrays.sort((a, b) => b.length - a.length || a.path.localeCompare(b.path));
  return {
    top_level_type: scalarKind(payload),
    top_level_keys: safeObjectKeys(payload, 32),
    object_count: objectCount,
    array_count: arrayCount,
    scalar_count: scalarCount,
    max_depth: maxDepth,
    nodes_inspected: nodesSeen,
    truncated: nodesSeen >= maxNodes,
    direct_ad_object_paths: unique(directAdObjectPaths).slice(0, 30),
    interesting_paths: interestingPaths.slice(0, maxInterestingPaths),
    id_like_paths: idLikePaths.slice(0, maxInterestingPaths),
    largest_arrays: arrays.slice(0, maxArrays)
  };
}

export function inspectGraphqlRequest(postData, headers = {}) {
  const normalizedHeaders = Object.fromEntries(Object.entries(headers || {}).map(([k, v]) => [String(k).toLowerCase(), v]));
  let friendlyName = normalizedHeaders['x-fb-friendly-name'] || null;
  let docId = null;
  let variableKeys = [];
  let cursorPaths = [];
  let parseMode = 'none';

  const raw = String(postData || '');
  if (raw) {
    try {
      if (raw.includes('variables=') || String(normalizedHeaders['content-type'] || '').includes('application/x-www-form-urlencoded')) {
        parseMode = 'form';
        const params = new URLSearchParams(raw);
        friendlyName = friendlyName || params.get('fb_api_req_friendly_name') || params.get('friendly_name') || null;
        docId = params.get('doc_id') || null;
        const variablesRaw = params.get('variables');
        if (variablesRaw) {
          const variables = JSON.parse(variablesRaw);
          variableKeys = Object.keys(variables || {});
          cursorPaths = requestCursorShape(raw, normalizedHeaders['content-type'] || 'application/x-www-form-urlencoded').cursorPaths;
        }
      } else if (/^[\[{]/.test(raw.trim())) {
        parseMode = 'json';
        const parsed = JSON.parse(raw);
        docId = parsed.doc_id || parsed.docId || null;
        friendlyName = friendlyName || parsed.fb_api_req_friendly_name || parsed.friendly_name || null;
        const target = parsed.variables && typeof parsed.variables === 'object' ? parsed.variables : parsed;
        variableKeys = Object.keys(target || {});
        cursorPaths = requestCursorShape(raw, normalizedHeaders['content-type'] || 'application/json').cursorPaths;
      }
    } catch {
      parseMode = 'unparsed';
    }
  }

  return {
    friendly_name: friendlyName ? String(friendlyName).slice(0, 160) : null,
    doc_id: docId ? String(docId).slice(0, 80) : null,
    parse_mode: parseMode,
    variable_keys: unique(variableKeys).slice(0, 40),
    cursor_paths: unique(cursorPaths).slice(0, 20),
    post_bytes: Buffer.byteLength(raw)
  };
}
