(() => {
  if (window.PTGloryExtractor) return;

  const ID_RE = /(?:ID\s*คลัง(?:โฆษณา)?|รหัสโฆษณา|Library\s*ID|Ad\s*ID)\s*[:：]?\s*(\d{6,})/i;
  const START_PATTERNS = [
    /(?:ได้เริ่มเผยแพร่เมื่อ|เริ่มเผยแพร่เมื่อ)\s*([^\n]+)/i,
    /(?:Started running on|Started on)\s*([^\n]+)/i
  ];
  const COLLATION_PATTERNS = [
    /(\d[\d,.]*)\s+ads?\s+use(?:s)?\s+this\s+creative\s+and\s+text/i,
    /(\d[\d,.]*)\s+ads?\s+use(?:s)?\s+this\s+creative/i,
    /โฆษณา\s*(\d[\d,.]*)\s*(?:รายการ|ชิ้น)?[^\n]{0,80}(?:ใช้|ใช้ร่วมกัน)[^\n]{0,80}(?:ชิ้นงาน|ครีเอทีฟ|ข้อความ)/i
  ];
  const CTA_LABELS = [
    ["ส่งข้อความ", "MESSAGE"], ["Send message", "MESSAGE"],
    ["ซื้อเลย", "SHOP_NOW"], ["Shop now", "SHOP_NOW"],
    ["เรียนรู้เพิ่มเติม", "LEARN_MORE"], ["Learn more", "LEARN_MORE"],
    ["สมัครเลย", "SIGN_UP"], ["Sign up", "SIGN_UP"],
    ["ติดต่อเรา", "CONTACT_US"], ["Contact us", "CONTACT_US"],
    ["ดาวน์โหลด", "DOWNLOAD"], ["Download", "DOWNLOAD"],
    ["จองเลย", "BOOK_NOW"], ["Book now", "BOOK_NOW"],
    ["ดูเมนู", "VIEW_MENU"], ["View menu", "VIEW_MENU"],
    ["สมัคร", "APPLY_NOW"], ["Apply now", "APPLY_NOW"],
    ["รับข้อเสนอ", "GET_OFFER"], ["Get offer", "GET_OFFER"],
    ["ฟังเลย", "LISTEN_NOW"], ["Listen now", "LISTEN_NOW"],
    ["ดูเพิ่มเติม", "SEE_MORE"], ["See more", "SEE_MORE"]
  ];
  const IGNORE_TEXT = [
    "ดูรายละเอียดโฆษณา", "ดูรายละเอียดการสรุป", "ส่งข้อความ",
    "See ad details", "See summary details", "Sponsored", "ได้รับการสนับสนุน",
    "Open Drop-down", "Platforms"
  ];

  const normalizeText = (value) => (value || "")
    .replace(/\u200b/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const unique = (values) => [...new Set((values || []).filter(Boolean))];

  function safeUrl(value) {
    if (!value || typeof value !== "string") return null;
    try {
      const url = new URL(value, location.href);
      if (!/^https?:$/.test(url.protocol)) return null;
      return url.href;
    } catch { return null; }
  }

  function normalizeObservedUrl(value) {
    let raw = String(value || "").trim().replace(/[),.;!?]+$/g, "");
    if (!raw) return null;
    if (/^(?:www\.|m\.me\/|bit\.ly\/|lin\.ee\/)/i.test(raw)) raw = `https://${raw}`;
    return unwrapOutbound(raw);
  }

  function unwrapOutbound(value) {
    const href = safeUrl(value);
    if (!href) return null;
    try {
      const url = new URL(href);
      if (/(^|\.)facebook\.com$/.test(url.hostname) && /\/l\.php$/.test(url.pathname)) {
        const target = url.searchParams.get("u");
        if (target) return safeUrl(target) || href;
      }
      return href;
    } catch { return href; }
  }

  function archiveIdsWithin(el) {
    const matches = normalizeText(el?.innerText).match(new RegExp(ID_RE.source, "gi")) || [];
    return matches.length;
  }

  function cardFromIdNode(node) {
    let current = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    if (!current) return null;
    let best = current;
    for (let i = 0; i < 11 && current; i += 1) {
      const text = normalizeText(current.innerText);
      const ids = archiveIdsWithin(current);
      if (ids === 1 && text.length >= 60) best = current;
      const parent = current.parentElement;
      if (!parent) break;
      if (archiveIdsWithin(parent) > 1) break;
      current = parent;
    }
    return best;
  }

  function currentCards() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) { return ID_RE.test(node.nodeValue || "") ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT; }
    });
    const cards = [];
    const seen = new Set();
    while (walker.nextNode()) {
      const card = cardFromIdNode(walker.currentNode);
      if (card && !seen.has(card)) { seen.add(card); cards.push(card); }
    }
    return cards;
  }

  function firstArchiveId(text) { return normalizeText(text).match(ID_RE)?.[1] || null; }

  function extractStartDate(text) {
    const normalized = normalizeText(text);
    for (const re of START_PATTERNS) {
      const match = normalized.match(re);
      if (match?.[1]) return normalizeText(match[1].split("\n")[0]);
    }
    return null;
  }

  function inferStatus(text) {
    const normalized = normalizeText(text).toLowerCase();
    if (/ไม่ได้ใช้งาน|inactive|หยุดใช้งาน/.test(normalized)) return "inactive";
    if (/กำลังใช้งาน|\bactive\b/.test(normalized)) return "active";
    return "unknown";
  }

  function parseNumeric(value) {
    if (!value) return null;
    const n = Number(String(value).replace(/[,.]/g, ""));
    return Number.isFinite(n) && n >= 0 ? n : null;
  }

  function inferCollation(text) {
    const normalized = normalizeText(text);
    for (const re of COLLATION_PATTERNS) {
      const match = normalized.match(re);
      const value = parseNumeric(match?.[1]);
      if (value !== null) return { value, evidence: normalizeText(match[0]), source: "rendered_text" };
    }
    return { value: null, evidence: null, source: null };
  }

  function inferCta(text) {
    const normalized = normalizeText(text).toLowerCase();
    for (const [label, type] of CTA_LABELS) {
      if (normalized.includes(label.toLowerCase())) return { value: type, status: "confirmed", evidence: label, source: "rendered_text" };
    }
    return { value: null, status: "unknown", evidence: null, source: null };
  }

  function inferCategories(card) {
    const selectors = [
      '[data-page-category]', '[data-category]', '[aria-label^="Category:"]',
      '[aria-label^="หมวดหมู่:"]', '[title^="Category:"]', '[title^="หมวดหมู่:"]'
    ];
    const values = [];
    const evidence = [];
    for (const el of card.querySelectorAll(selectors.join(','))) {
      const raw = el.getAttribute('data-page-category') || el.getAttribute('data-category') || el.getAttribute('aria-label') || el.getAttribute('title') || '';
      const cleaned = normalizeText(raw.replace(/^(?:Category|หมวดหมู่)\s*[:：]\s*/i, ''));
      if (cleaned && cleaned.length <= 120) { values.push(cleaned); evidence.push(raw); }
    }
    return { values: unique(values), evidence: evidence.length ? evidence.join(' | ') : null, source: evidence.length ? 'dom_structural_metadata' : null };
  }

  function inferPage(card) {
    const anchors = [...card.querySelectorAll("a[href]")];
    const candidates = anchors
      .map((a) => ({ text: normalizeText(a.innerText || a.textContent), href: safeUrl(a.href) }))
      .filter((x) => x.text && x.text.length >= 2 && x.text.length <= 140)
      .filter((x) => !IGNORE_TEXT.some((ignored) => x.text.toLowerCase().includes(ignored.toLowerCase())))
      .filter((x) => !/facebook\.com\/ads\/library\/report/i.test(x.href || ""));
    const likely = candidates.find((x) => {
      if (!x.href) return false;
      try {
        const u = new URL(x.href);
        return u.hostname.endsWith("facebook.com") && !u.pathname.includes("/ads/library") && !u.pathname.includes("/l.php");
      } catch { return false; }
    }) || candidates[0];

    let pageId = null;
    let idSource = null;
    if (likely?.href) {
      const m = likely.href.match(/(?:profile\.php\?id=|\/)(\d{5,})(?:[/?#]|$)/);
      if (m) { pageId = m[1]; idSource = "page_link"; }
    }
    if (!pageId) {
      const html = card.outerHTML || "";
      for (const re of [/(?:page_id|pageID|profile_id)[^0-9]{0,40}(\d{5,})/i, /(?:page_id|pageID|profile_id)[^0-9]{0,40}%22(\d{5,})/i]) {
        const m = html.match(re);
        if (m?.[1]) { pageId = m[1]; idSource = "dom_attribute"; break; }
      }
    }
    return { page_name: likely?.text || null, page_url: likely?.href || null, page_id: pageId, page_id_source: idSource };
  }

  function inferBody(card) {
    const candidates = [...card.querySelectorAll("div,span,p")]
      .map((el) => normalizeText(el.innerText || el.textContent))
      .filter((text) => text.length >= 24 && text.length <= 6000)
      .filter((text) => !ID_RE.test(text))
      .filter((text) => !START_PATTERNS.some((re) => re.test(text)))
      .filter((text) => !IGNORE_TEXT.some((ignored) => text === ignored))
      .sort((a, b) => b.length - a.length);
    return candidates[0] || null;
  }

  function cleanBody(bodyRaw, pageName) {
    if (!bodyRaw) return null;
    const ctaLabels = new Set(CTA_LABELS.map(([label]) => label.toLowerCase()));
    const lines = normalizeText(bodyRaw).split("\n").map((x) => x.trim()).filter(Boolean);
    const kept = lines.filter((line, index) => {
      const lower = line.toLowerCase();
      if (pageName && index <= 2 && line === pageName) return false;
      if (/^(sponsored|ได้รับการสนับสนุน)$/i.test(line)) return false;
      if (/^(see ad details|see summary details|ดูรายละเอียดโฆษณา|ดูรายละเอียดการสรุป)$/i.test(line)) return false;
      if (/^\d{1,2}:\d{2}\s*\/\s*\d{1,2}:\d{2}$/.test(line)) return false;
      if (ctaLabels.has(lower)) return false;
      return true;
    });
    while (kept.length) {
      const tail = kept[kept.length - 1];
      if ((pageName && tail === pageName) || /^(see details|visit instagram profile|ดูรายละเอียด)$/i.test(tail)) kept.pop();
      else break;
    }
    return normalizeText(kept.join("\n")) || null;
  }

  function looksAuxiliaryImage(url) {
    if (!url) return true;
    return /(?:^|[_?&])s(?:=|_)?60x60|s60x60|\b60x60\b/i.test(url);
  }

  function extractMedia(card) {
    const allImages = unique([...card.querySelectorAll("img")]
      .map((img) => safeUrl(img.currentSrc || img.src))
      .filter((url) => url && !url.startsWith("data:")));
    const auxiliaryImages = allImages.filter(looksAuxiliaryImage);
    const images = allImages.filter((url) => !looksAuxiliaryImage(url));
    const videos = unique([...card.querySelectorAll("video")].flatMap((video) => [
      safeUrl(video.currentSrc || video.src),
      ...[...video.querySelectorAll("source")].map((s) => safeUrl(s.src))
    ]));
    const posters = unique([...card.querySelectorAll("video")].map((video) => safeUrl(video.poster)));
    const format = videos.length ? "VIDEO" : images.length > 1 ? "MULTI_IMAGE" : images.length === 1 ? "SINGLE_IMAGE" : "UNKNOWN";
    return { images, videos, posters, auxiliaryImages, format };
  }

  function inferPlatforms(card) {
    const haystack = [...card.querySelectorAll("[aria-label],[title],img[alt]")]
      .flatMap((el) => [el.getAttribute("aria-label"), el.getAttribute("title"), el.getAttribute("alt")])
      .filter(Boolean).join(" ").toLowerCase();
    const out = [];
    if (haystack.includes("facebook")) out.push("facebook");
    if (haystack.includes("instagram")) out.push("instagram");
    if (haystack.includes("messenger")) out.push("messenger");
    if (haystack.includes("audience network")) out.push("audience_network");
    return unique(out);
  }

  function textUrls(text) {
    const re = /(?:https?:\/\/|www\.|m\.me\/|bit\.ly\/|lin\.ee\/)[^\s<>"'’”]+/gi;
    const matches = String(text || "").match(re) || [];
    return unique(matches.map(normalizeObservedUrl).filter(Boolean));
  }

  function nearestHref(el) {
    let current = el;
    for (let i = 0; i < 5 && current; i += 1) {
      if (current.matches?.('a[href]')) return unwrapOutbound(current.href);
      current = current.parentElement;
    }
    return null;
  }

  function ctaFromCard(card, fullText) {
    const nodes = [...card.querySelectorAll('a[href],button,[role="button"]')];
    for (const el of nodes) {
      const label = normalizeText(el.innerText || el.textContent || el.getAttribute('aria-label') || '');
      const hit = CTA_LABELS.find(([candidate]) => label.toLowerCase() === candidate.toLowerCase());
      if (!hit) continue;
      return { value: hit[1], status: 'confirmed', evidence: label, source: 'interactive_dom', destination: nearestHref(el) };
    }
    return { ...inferCta(fullText), destination: null };
  }

  function detailsUrlFromCard(card) {
    const anchors = [...card.querySelectorAll('a[href]')];
    const labeled = anchors.find((a) => /^(see ad details|see summary details|ดูรายละเอียดโฆษณา|ดูรายละเอียดการสรุป)$/i.test(normalizeText(a.innerText || a.textContent)));
    if (labeled) return safeUrl(labeled.href);
    return unique(anchors.map((a) => safeUrl(a.href))).find((href) => href && /facebook\.com\/ads\/library/i.test(href) && /[?&]id=\d+/i.test(href)) || null;
  }

  function normalizePageUrl(value) {
    const href = safeUrl(value);
    if (!href) return null;
    try {
      const u = new URL(href);
      u.hash = '';
      for (const key of [...u.searchParams.keys()]) if (key !== 'id') u.searchParams.delete(key);
      if (!/\.[a-z0-9]+$/i.test(u.pathname) && u.pathname !== '/') u.pathname = u.pathname.replace(/\/+$/, '') + '/';
      return u.href;
    } catch { return href; }
  }

  function queryDiagnostics(page, body, rawText) {
    let query = null;
    try { query = new URL(location.href).searchParams.get('q'); } catch {}
    if (!query) return { query_match_observed: null, query_match_fields: [], query_relevance_status: 'not_evaluated' };
    const needle = query.toLocaleLowerCase();
    const fields = [];
    if (String(page?.page_name || '').toLocaleLowerCase().includes(needle)) fields.push('page_name');
    if (String(body || '').toLocaleLowerCase().includes(needle)) fields.push('body_clean');
    if (String(rawText || '').toLocaleLowerCase().includes(needle)) fields.push('raw_text');
    return { query_match_observed: fields.length > 0, query_match_fields: unique(fields), query_relevance_status: fields.length ? 'exact_text_match' : 'no_observed_exact_text_match' };
  }

  function extractCard(card, index) {
    const fullText = normalizeText(card.innerText || card.textContent);
    const adId = firstArchiveId(fullText);
    const page = inferPage(card);
    page.page_url = normalizePageUrl(page.page_url);
    const media = extractMedia(card);
    const platforms = inferPlatforms(card);
    const cta = ctaFromCard(card, fullText);
    const collation = inferCollation(fullText);
    const categories = inferCategories(card);
    const bodyRaw = inferBody(card);
    const bodyClean = cleanBody(bodyRaw, page.page_name);
    const bodyUrls = textUrls(bodyClean || bodyRaw);
    const query = queryDiagnostics(page, bodyClean, fullText);
    const pageIdentityKey = page.page_id ? `page:${page.page_id}` : page.page_url ? `url:${page.page_url}` : null;
    const detailsUrl = detailsUrlFromCard(card);
    const startDate = extractStartDate(fullText);

    const evidence = {
      ad_archive_id: adId ? { source: "rendered_text", strength: "deterministic", evidence: adId } : null,
      page_id: page.page_id ? { source: page.page_id_source, strength: page.page_id_source === "page_link" ? "deterministic" : "heuristic", evidence: page.page_id } : null,
      page_identity_key: pageIdentityKey ? { source: page.page_id ? 'page_id' : 'canonical_page_url', strength: 'deterministic', evidence: pageIdentityKey } : null,
      start_date_raw: startDate ? { source: "rendered_text", strength: "deterministic", evidence: startDate } : null,
      cta_type: cta.value ? { source: cta.source, strength: cta.source === 'interactive_dom' ? 'deterministic' : 'observed', evidence: cta.evidence } : null,
      cta_destination_url: cta.destination ? { source: 'cta_anchor', strength: 'deterministic', evidence: cta.destination } : null,
      collation_count: collation.value !== null ? { source: collation.source, strength: "observed", evidence: collation.evidence } : null,
      page_categories: categories.values.length ? { source: categories.source, strength: "deterministic", evidence: categories.evidence } : null,
      publisher_platform: platforms.length ? { source: "dom_accessibility", strength: "observed", evidence: platforms.join(",") } : null,
      ad_details_url: detailsUrl ? { source: 'anchor_href', strength: 'deterministic', evidence: detailsUrl } : null
    };

    return {
      ad_archive_id: adId,
      page_id: page.page_id,
      page_identity_key: pageIdentityKey,
      page_name: page.page_name,
      page_name_snapshot: page.page_name,
      page_url: page.page_url,
      page_like_count: null,
      page_categories: categories.values,
      start_date_raw: startDate,
      end_date_raw: null,
      is_active: inferStatus(fullText),
      body: bodyClean,
      body_raw: bodyRaw,
      body_clean: bodyClean,
      body_urls: bodyUrls,
      cta_type: cta.value,
      cta_observation: cta.status,
      cta_destination_url: cta.destination,
      link_url: cta.destination,
      display_format: media.format,
      publisher_platform: platforms,
      platform_observation: platforms.length ? 'observed' : 'unobserved',
      collation_count: collation.value,
      collation_observation: collation.value !== null ? 'observed' : 'unobserved',
      images: media.images,
      auxiliary_images: media.auxiliaryImages,
      videos: media.videos,
      video_posters: media.posters,
      media: { format: media.format, images: media.images, video_posters: media.posters, videos: media.videos, auxiliary_images: media.auxiliaryImages },
      cards: [],
      ad_details_url: detailsUrl,
      ...query,
      field_evidence: evidence,
      raw_text: fullText,
      extraction_source: "playwright_dom_meta_service_v0.4.1-prototype",
      captured_at: new Date().toISOString(),
      dom_index: index
    };
  }

  function scan() {
    const map = new Map();
    for (const [index, card] of currentCards().entries()) {
      const record = extractCard(card, index);
      const key = record.ad_archive_id ? `ad:${record.ad_archive_id}` : `fallback:${record.page_name || ''}|${record.start_date_raw || ''}|${(record.body_clean || '').slice(0,120)}`;
      if (!map.has(key)) map.set(key, record);
    }
    return [...map.values()];
  }

  window.PTGloryExtractor = { scan };
})();
