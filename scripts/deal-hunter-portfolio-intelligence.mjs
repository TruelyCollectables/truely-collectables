import fs from 'node:fs';
import net from 'node:net';

const ENV_PATH = '/tmp/deal-hunter-portfolio-env.json';
const RESULT_PATH = '/tmp/deal-hunter-portfolio-result.json';
const env = JSON.parse(fs.readFileSync(ENV_PATH, 'utf8'));
for (const [key, value] of Object.entries(env)) {
  if (value !== null && value !== undefined && String(value).length) process.env[key] = String(value);
}
process.env.TCOS_SEARCH_MAX_RESULTS = process.env.TCOS_SEARCH_MAX_RESULTS || '20';

const BASE = 'https://truelycollectables.com';
const MIN_ROI = 15;
const EXTREME_ROI = 50;
const MAX_EVALUATIONS = Math.max(12, Math.min(80, Number(process.env.PORTFOLIO_MAX_EVALUATIONS || 50)));
const EVALUATION_CONCURRENCY = Math.max(1, Math.min(4, Number(process.env.PORTFOLIO_EVALUATION_CONCURRENCY || 2)));
const RECENT_EVALUATION_HOURS = Math.max(1, Math.min(168, Number(process.env.PORTFOLIO_RECENT_EVALUATION_HOURS || 24)));
const NOW = new Date();
const RUN_ID = `portfolio-${NOW.toISOString().replace(/[:.]/g, '-')}`;

const ROSTERS = Object.freeze({
  WNBA: [
    'Caitlin Clark', 'Paige Bueckers', 'Dominique Malonga', 'Sonia Citron', 'Kiki Iriafen',
    'Angel Reese', 'Azzi Fudd', 'Olivia Miles', 'Awa Fam Thiam', 'Lauren Betts',
    'Gabriela Jaquez', 'Kiki Rice',
  ],
  BASEBALL: [
    'Jesus Made', 'Leo De Vries', 'Seth Hernandez', 'Eli Willits', 'Colt Emerson',
    'Kade Anderson', 'Max Clark', 'Josue De Paula', 'Franklin Arias',
  ],
  NHL: [
    'Ivan Demidov', 'Matvei Michkov', 'Gavin McKenna', 'Ivar Stenberg', 'Milton Gastrin',
    'Viggo Bjork', 'Caleb Malhotra', 'Liam Ruck', 'Ryan Roobroeck', 'Alberts Smits',
  ],
});

const FOLLOWED_MARKETPLACES = [
  'eBay', 'Mercari', 'Whatnot Marketplace', 'Sportslots', 'COMC', 'MySlabs',
  'Fanatics Collect', 'CollX', 'public Facebook Marketplace/pages/groups',
  'public X sale posts', 'Etsy',
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const money = (value) => value === null || value === undefined || !Number.isFinite(Number(value)) ? '—' : `$${Number(value).toFixed(2)}`;
const pct = (value) => value === null || value === undefined || !Number.isFinite(Number(value)) ? '—' : `${Number(value) >= 0 ? '+' : ''}${Number(value).toFixed(1)}%`;
const esc = (value) => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
const text = (value, max = 500) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const numberOrNull = (value) => {
  const n = Number(value);
  return value === null || value === undefined || value === '' || !Number.isFinite(n) ? null : n;
};

function median(values) {
  const clean = values.map(Number).filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (!clean.length) return null;
  const mid = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[mid] : (clean[mid - 1] + clean[mid]) / 2;
}

function percentChange(current, previous) {
  return current === null || previous === null || previous === 0 ? null : ((current - previous) / previous) * 100;
}

function rosterMatch(title, bucket) {
  const haystack = text(title, 1200).toLowerCase();
  return (ROSTERS[bucket] || []).find((name) => {
    const tokens = name.toLowerCase().split(/\s+/).filter(Boolean);
    return tokens.every((token) => haystack.includes(token));
  }) || null;
}

function canonicalUrl(value) {
  try {
    const url = new URL(String(value || ''));
    url.hash = '';
    return url.toString();
  } catch {
    return '';
  }
}

function listingKey(candidate) {
  return `${candidate.marketplace}|${candidate.listingItemId || canonicalUrl(candidate.listingUrl)}`.toLowerCase();
}

function isRecent(dateValue, hours = 24) {
  const time = new Date(dateValue || 0).getTime();
  return Number.isFinite(time) && time >= Date.now() - hours * 3_600_000;
}

function nativeCandidate(entry, bucket, scope) {
  return {
    sourceKind: 'native-ebay',
    bucket,
    scope,
    marketplace: 'eBay',
    listingItemId: text(entry.listingItemId, 100) || null,
    listingUrl: canonicalUrl(entry.listingUrl),
    title: text(entry.title, 1200),
    watchedPerson: text(entry.watchedPerson, 200) || rosterMatch(entry.title, bucket),
    lane: text(entry.lane, 200) || `${bucket.toLowerCase()}_portfolio`,
    itemPrice: numberOrNull(entry.itemPrice),
    inboundShipping: numberOrNull(entry.inboundShipping),
    buyerFees: numberOrNull(entry.buyerFees),
    tax: numberOrNull(entry.tax),
    sellerName: text(entry.sellerName, 300) || null,
    condition: text(entry.condition, 200) || null,
    imageUrls: Array.from(new Set((entry.imageUrls || []).map(canonicalUrl).filter(Boolean))),
    listedAt: entry.itemCreationDate || null,
    discoveredAt: NOW.toISOString(),
    discoveryManualReview: entry.manualReviewRequired === true,
    discoveryRisks: Array.isArray(entry.preliminaryRisks) ? entry.preliminaryRisks.map((r) => text(r, 300)) : [],
    queryFamilyIds: Array.isArray(entry.queryFamilyIds) ? entry.queryFamilyIds : [],
  };
}

function publicCandidate(entry, bucket) {
  const marketplace = text(entry.source, 120) || 'public_web';
  const title = text(entry.title, 1200);
  return {
    sourceKind: 'public-web',
    bucket,
    scope: `${bucket.toLowerCase()}_multi_market`,
    marketplace,
    listingItemId: null,
    listingUrl: canonicalUrl(entry.url),
    title,
    watchedPerson: rosterMatch(title, bucket),
    lane: `${bucket.toLowerCase()}_multi_market`,
    itemPrice: numberOrNull(entry.askingPrice),
    inboundShipping: numberOrNull(entry.shipping),
    buyerFees: numberOrNull(entry.buyerFees),
    tax: numberOrNull(entry.tax),
    sellerName: text(entry.sellerName, 300) || null,
    condition: null,
    imageUrls: Array.from(new Set((entry.imageUrls || []).map(canonicalUrl).filter(Boolean))),
    listedAt: null,
    discoveredAt: entry.discoveredAt || NOW.toISOString(),
    discoveryManualReview: entry.manualReviewRequired === true,
    discoveryRisks: [entry.verificationNotes].filter(Boolean).map((r) => text(r, 500)),
    queryFamilyIds: [],
  };
}

async function fetchJson(url, options = {}, timeoutMs = 120_000) {
  const response = await fetch(url, {
    ...options,
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (response.status >= 300 && response.status < 400) {
    throw new Error(`Redirect refused from ${url} (HTTP ${response.status}).`);
  }
  const payload = await response.json().catch(() => null);
  return { response, payload };
}

async function nativeSearch(scope, bucket, extraPath = null) {
  const url = extraPath || `${BASE}/api/tcos/deal-hunter-native-ebay?perQuery=20&scope=${encodeURIComponent(scope)}&portfolio=${Date.now()}`;
  const { response, payload } = await fetchJson(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'tcos-portfolio-intelligence/1.0' },
  });
  const complete = response.status === 200 && payload?.ok === true && payload?.failedQueryCount === 0;
  console.log(`PORTFOLIO ${scope}: ${complete ? 'PASS' : 'FAIL'} ${payload?.successfulQueryCount || 0}/${payload?.queryFamilyCount || 0} families, ${payload?.deduplicatedResultCount || 0} results.`);
  return {
    scope,
    bucket,
    complete,
    status: response.status,
    queryFamilyCount: Number(payload?.queryFamilyCount || 0),
    successfulQueryCount: Number(payload?.successfulQueryCount || 0),
    failedQueryCount: Number(payload?.failedQueryCount || 0),
    rawResultCount: Number(payload?.rawResultCount || 0),
    candidates: Array.isArray(payload?.results) ? payload.results.map((entry) => nativeCandidate(entry, bucket, scope)) : [],
    errors: payload?.errors || [],
  };
}

async function publicSearches() {
  if (!process.env.OPENAI_API_KEY) {
    return { configured: false, groups: [], warnings: ['OPENAI_API_KEY missing; multi-market discovery skipped.'] };
  }
  try {
    const { OpenAiPublicSearchAdapter } = await import('../connectors/tcos-market-intel-mcp/src/public-search.mjs');
    const adapter = new OpenAiPublicSearchAdapter();
    if (!adapter.configured) return { configured: false, groups: [], warnings: ['Public-web adapter not configured.'] };
    const groups = [];
    for (const [bucket, names] of Object.entries(ROSTERS)) {
      const sport = bucket === 'WNBA' ? 'WNBA basketball cards' : bucket === 'BASEBALL' ? 'baseball prospect cards' : 'NHL hockey prospect cards';
      const query = `${sport}: ${names.join(', ')}. Find live listings that could be undervalued, newly listed, misspelled, mislisted, wrong-category, omitted-name, parallel/serial-numbered, autograph, rookie, photo-only, auction, lot, or relist opportunities. Prefer listings with multiple clear card images so front and back can be verified.`;
      try {
        const result = await adapter.search({
          query,
          sources: FOLLOWED_MARKETPLACES,
          filters: { liveOnly: true, collectibleType: 'sports_card' },
          maxResults: 20,
          exactIdentityOnly: false,
        });
        const candidates = (result.results || []).map((entry) => publicCandidate(entry, bucket));
        groups.push({ bucket, candidates, warnings: result.warnings || [] });
        console.log(`PORTFOLIO MULTI-MARKET ${bucket}: ${candidates.length} direct listings discovered.`);
      } catch (error) {
        groups.push({ bucket, candidates: [], warnings: [error instanceof Error ? error.message : String(error)] });
        console.log(`PORTFOLIO MULTI-MARKET ${bucket}: search failed; deterministic eBay coverage remains available.`);
      }
    }
    return { configured: true, groups, warnings: groups.flatMap((group) => group.warnings) };
  } catch (error) {
    return { configured: false, groups: [], warnings: [error instanceof Error ? error.message : String(error)] };
  }
}

function dedupeCandidates(candidates) {
  const map = new Map();
  for (const candidate of candidates) {
    if (!candidate.listingUrl || candidate.itemPrice === null || candidate.itemPrice < 0) continue;
    const key = listingKey(candidate);
    const prior = map.get(key);
    if (!prior) {
      map.set(key, candidate);
      continue;
    }
    const merged = {
      ...prior,
      imageUrls: Array.from(new Set([...(prior.imageUrls || []), ...(candidate.imageUrls || [])])),
      discoveryRisks: Array.from(new Set([...(prior.discoveryRisks || []), ...(candidate.discoveryRisks || [])])),
      queryFamilyIds: Array.from(new Set([...(prior.queryFamilyIds || []), ...(candidate.queryFamilyIds || [])])),
      discoveryManualReview: prior.discoveryManualReview || candidate.discoveryManualReview,
    };
    if (prior.sourceKind !== 'native-ebay' && candidate.sourceKind === 'native-ebay') Object.assign(merged, candidate, { imageUrls: merged.imageUrls, discoveryRisks: merged.discoveryRisks });
    map.set(key, merged);
  }
  return [...map.values()];
}

function publicHostnameAllowed(hostname) {
  const host = String(hostname || '').toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return false;
  if (net.isIP(host)) {
    if (host === '0.0.0.0' || host === '127.0.0.1' || host === '::1') return false;
    if (/^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return false;
    const m = host.match(/^172\.(\d+)\./);
    if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return false;
  }
  return true;
}

async function fetchImage(urlValue) {
  let current = new URL(urlValue);
  for (let redirectCount = 0; redirectCount <= 2; redirectCount += 1) {
    if (current.protocol !== 'https:' || !publicHostnameAllowed(current.hostname)) throw new Error('Image URL is not an allowed public HTTPS location.');
    const response = await fetch(current, {
      headers: { Accept: 'image/jpeg,image/png,image/webp', 'User-Agent': 'tcos-portfolio-intelligence/1.0' },
      redirect: 'manual',
      signal: AbortSignal.timeout(25_000),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location || redirectCount === 2) throw new Error(`Image redirect refused at HTTP ${response.status}.`);
      current = new URL(location, current);
      continue;
    }
    if (!response.ok) throw new Error(`Image HTTP ${response.status}.`);
    const contentType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) throw new Error(`Unsupported image type ${contentType || 'unknown'}.`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length || bytes.length > 12 * 1024 * 1024) throw new Error('Image is empty or exceeds 12MB.');
    const extension = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';
    return { blob: new Blob([bytes], { type: contentType }), filename: `card.${extension}` };
  }
  throw new Error('Unable to fetch image.');
}

async function evaluateCandidate(candidate) {
  if ((candidate.imageUrls || []).length < 2) {
    return { candidate, status: 'needs_front_back', error: 'Fewer than two distinct listing images were available.' };
  }
  const key = String(process.env.INSTACOMP_AI_LOCAL_KEY || '').trim();
  if (!key) return { candidate, status: 'evaluation_unavailable', error: 'INSTACOMP_AI_LOCAL_KEY missing.' };
  try {
    const [front, back] = await Promise.all([fetchImage(candidate.imageUrls[0]), fetchImage(candidate.imageUrls[1])]);
    const listing = {
      runId: RUN_ID,
      candidateKey: listingKey(candidate),
      lane: candidate.lane,
      watchedPerson: candidate.watchedPerson,
      marketplace: candidate.marketplace,
      listingItemId: candidate.listingItemId,
      listingUrl: candidate.listingUrl,
      title: candidate.title,
      sellerName: candidate.sellerName,
      itemPrice: candidate.itemPrice,
      inboundShipping: candidate.inboundShipping,
      buyerFees: candidate.buyerFees,
      tax: candidate.tax,
      conditionText: candidate.condition,
      discoveryManualReviewRequired: candidate.discoveryManualReview,
      discoveryRisks: candidate.discoveryRisks,
      sourceKind: candidate.sourceKind,
      sourceScope: candidate.scope,
    };
    const form = new FormData();
    form.set('listingJson', JSON.stringify(listing));
    form.set('frontImage', front.blob, `front-${front.filename}`);
    form.set('backImage', back.blob, `back-${back.filename}`);
    const { response, payload } = await fetchJson(`${BASE}/api/instacomp/deal-hunter/evaluate`, {
      method: 'POST',
      headers: { 'x-instacomp-ai-key': key, Accept: 'application/json', 'User-Agent': 'tcos-portfolio-intelligence/1.0' },
      body: form,
    }, 320_000);
    if (!response.ok || payload?.ok !== true) {
      return { candidate, status: 'scan_rejected', httpStatus: response.status, error: text(payload?.error || payload?.scan?.error || 'InstaComp evaluation failed.', 1000), payload };
    }
    const evaluation = payload.evaluation || {};
    const scan = payload.scan || {};
    const registry = scan.checklistRegistry || {};
    const marketHistory = payload.marketHistory || {};
    const roi = numberOrNull(evaluation.roiPercent);
    const verified = registry.matched === true && Boolean(registry.identityId) && Number(evaluation.soldCount || 0) > 0 && marketHistory.status === 'saved';
    const classification = !verified
      ? 'not_verified'
      : roi === null
        ? 'no_roi'
        : roi >= EXTREME_ROI
          ? 'extreme_verify'
          : roi >= MIN_ROI && Number(evaluation.expectedNetProfit || 0) > 0
            ? 'portfolio_buy'
            : 'under_15';
    return {
      candidate,
      status: 'evaluated',
      classification,
      verified,
      roiPercent: roi,
      expectedNetProfit: numberOrNull(evaluation.expectedNetProfit),
      deliveredCost: numberOrNull(evaluation.deliveredCost),
      conservativeResale: numberOrNull(evaluation.conservativeResale),
      soldCount: Number(evaluation.soldCount || 0),
      dealLabel: text(evaluation.dealLabel, 100),
      identity: scan.ai || {},
      registry: {
        matched: registry.matched === true,
        identityId: registry.identityId || null,
        fingerprintSha256: registry.fingerprintSha256 || null,
        confidence: numberOrNull(registry.identityConfidence ?? scan.ai?.confidence),
      },
      marketHistory: {
        status: marketHistory.status || null,
        inserted: Number(marketHistory.inserted || 0),
        duplicates: Number(marketHistory.duplicates || 0),
      },
      exactMarket: {
        soldCount: Number(scan.exactMarket?.pricingEligibleSoldCount ?? scan.exactMarket?.soldCount ?? 0),
        activeCount: Number(scan.exactMarket?.activeCount || 0),
        historicalFallback: scan.exactMarket?.historicalSoldFallback?.used === true,
      },
      conditionGuess: text(scan.ai?.conditionGuess, 200) || null,
    };
  } catch (error) {
    return { candidate, status: 'evaluation_error', error: error instanceof Error ? error.message : String(error) };
  }
}

async function supabaseRest(table, params) {
  const base = String(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!base || !key) return null;
  const url = new URL(`${base}/rest/v1/${table}`);
  for (const [name, value] of Object.entries(params || {})) url.searchParams.set(name, String(value));
  const response = await fetch(url, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
    redirect: 'manual', signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Supabase ${table} HTTP ${response.status}.`);
  return response.json();
}

async function recentEvaluations() {
  try {
    const since = new Date(Date.now() - RECENT_EVALUATION_HOURS * 3_600_000).toISOString();
    const rows = await supabaseRest('tcos_deal_hunter_candidates', {
      select: 'listing_url,item_price,updated_at',
      updated_at: `gte.${since}`,
      limit: '5000',
    });
    const map = new Map();
    for (const row of rows || []) {
      map.set(canonicalUrl(row.listing_url), { itemPrice: numberOrNull(row.item_price), updatedAt: row.updated_at });
    }
    return map;
  } catch (error) {
    console.log(`PORTFOLIO recent-evaluation lookup unavailable: ${error instanceof Error ? error.message : String(error)}`);
    return new Map();
  }
}

function candidatePriority(candidate, recentMap) {
  let score = 0;
  if (candidate.bucket === 'WNBA') score += 1000;
  else if (candidate.bucket === 'BASEBALL') score += 600;
  else if (candidate.bucket === 'NHL') score += 550;
  if (candidate.discoveryManualReview || candidate.discoveryRisks?.length) score += 300;
  if (isRecent(candidate.listedAt, 24)) score += 250;
  if (candidate.sourceKind === 'public-web') score += 100;
  if ((candidate.imageUrls || []).length >= 2) score += 100;
  const recent = recentMap.get(canonicalUrl(candidate.listingUrl));
  if (recent && recent.itemPrice === candidate.itemPrice) score -= 5000;
  if (candidate.itemPrice !== null) score += Math.max(0, 100 - Math.min(candidate.itemPrice, 100));
  return score;
}

async function runPool(items, concurrency, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]);
      const row = results[index];
      const label = row.classification || row.status;
      console.log(`PORTFOLIO INSTACOMP ${index + 1}/${items.length}: ${label} ${row.roiPercent === null || row.roiPercent === undefined ? '' : `${row.roiPercent.toFixed(1)}% ROI`} — ${text(items[index].title, 90)}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

function exactIdentityLabel(identity) {
  const parts = [identity.player, identity.year, identity.brand, identity.setName, identity.cardNumber ? `#${identity.cardNumber}` : null, identity.parallel, identity.isAuto ? 'AUTO' : null].filter(Boolean);
  return parts.join(' · ') || 'Registry-locked card';
}

function trendForWindow(rows, days) {
  const now = Date.now();
  const recentStart = now - days * 86_400_000;
  const previousStart = now - days * 2 * 86_400_000;
  const sold = rows.filter((row) => row.observation_kind === 'SOLD' && Number(row.delivered_price) > 0)
    .map((row) => ({ ...row, time: new Date(row.effective_at || row.observed_at || 0).getTime() }))
    .filter((row) => Number.isFinite(row.time));
  const recent = median(sold.filter((row) => row.time >= recentStart).map((row) => row.delivered_price));
  const previous = median(sold.filter((row) => row.time >= previousStart && row.time < recentStart).map((row) => row.delivered_price));
  return { recent, previous, changePct: percentChange(recent, previous), recentCount: sold.filter((row) => row.time >= recentStart).length };
}

async function exactMarketMovers(bucket, limit = 12) {
  try {
    const identities = await supabaseRest('tcos_card_market_identities', {
      select: 'registry_identity_id,identity_json,last_seen_at',
      order: 'last_seen_at.desc',
      limit: '3000',
    });
    if (!identities) return [];
    const roster = new Set((ROSTERS[bucket] || []).map((name) => name.toLowerCase()));
    const relevant = identities.filter((row) => roster.has(text(row.identity_json?.player, 200).toLowerCase()));
    if (!relevant.length) return [];
    const ids = new Set(relevant.map((row) => String(row.registry_identity_id)));
    const since = new Date(Date.now() - 180 * 86_400_000).toISOString();
    const observations = await supabaseRest('tcos_card_market_observations', {
      select: 'registry_identity_id,observation_kind,delivered_price,effective_at,observed_at',
      observed_at: `gte.${since}`,
      order: 'observed_at.asc',
      limit: '10000',
    }) || [];
    const byId = new Map();
    for (const row of observations) {
      if (!ids.has(String(row.registry_identity_id))) continue;
      const list = byId.get(String(row.registry_identity_id)) || [];
      list.push(row);
      byId.set(String(row.registry_identity_id), list);
    }
    return relevant.map((row) => {
      const rows = byId.get(String(row.registry_identity_id)) || [];
      const w7 = trendForWindow(rows, 7);
      const w30 = trendForWindow(rows, 30);
      const w90 = trendForWindow(rows, 90);
      return {
        registryIdentityId: row.registry_identity_id,
        identity: row.identity_json || {},
        label: exactIdentityLabel(row.identity_json || {}),
        lastSeenAt: row.last_seen_at,
        soldObservations: rows.filter((r) => r.observation_kind === 'SOLD').length,
        askObservations: rows.filter((r) => r.observation_kind === 'ASK').length,
        sevenDay: w7,
        thirtyDay: w30,
        ninetyDay: w90,
      };
    }).filter((row) => row.soldObservations > 0)
      .sort((a, b) => Math.abs(b.thirtyDay.changePct || b.sevenDay.changePct || 0) - Math.abs(a.thirtyDay.changePct || a.sevenDay.changePct || 0))
      .slice(0, limit);
  } catch (error) {
    console.log(`PORTFOLIO ${bucket} exact-market trend lookup unavailable: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

function formatDeal(row, index) {
  const c = row.candidate;
  return `${index + 1}. ${exactIdentityLabel(row.identity)}\n   ${c.marketplace} | ROI ${pct(row.roiPercent)} | Net ${money(row.expectedNetProfit)} | Delivered ${money(row.deliveredCost)} | Conservative resale ${money(row.conservativeResale)} | exact sold ${row.soldCount}\n   ${c.title}\n   ${c.listingUrl}`;
}

function htmlDeal(row) {
  const c = row.candidate;
  return `<section style="border:1px solid #ddd;border-radius:12px;padding:16px;margin:0 0 14px"><div style="font-weight:900;font-size:20px">${esc(exactIdentityLabel(row.identity))}</div><div style="margin:8px 0"><b>${esc(c.marketplace)}</b> · <b>ROI ${esc(pct(row.roiPercent))}</b> · Net ${esc(money(row.expectedNetProfit))} · Delivered ${esc(money(row.deliveredCost))} · Conservative resale ${esc(money(row.conservativeResale))} · exact sold ${row.soldCount}</div><div style="font-size:13px;color:#555">${esc(c.title)}</div><div style="font-size:12px;color:#666;margin-top:6px">Condition read: ${esc(row.conditionGuess || 'not stated')} · Registry confidence ${esc(row.registry.confidence === null ? '—' : `${(Number(row.registry.confidence) <= 1 ? Number(row.registry.confidence) * 100 : Number(row.registry.confidence)).toFixed(1)}%`)}</div><a href="${esc(c.listingUrl)}" style="display:inline-block;margin-top:10px;background:#111;color:#fff;text-decoration:none;padding:9px 13px;border-radius:7px;font-weight:800">OPEN LISTING</a></section>`;
}

const deterministic = await Promise.all([
  nativeSearch('wnba', 'WNBA'),
  nativeSearch('ivan_demidov', 'NHL'),
  nativeSearch('matvei_michkov_young_guns', 'NHL'),
  nativeSearch('baseball_prospects', 'BASEBALL'),
  nativeSearch('matvei_michkov_opc_platinum', 'NHL', `${BASE}/api/tcos/deal-hunter-michkov-opc-platinum?perQuery=20&portfolio=${Date.now()}`),
]);
const multiMarket = await publicSearches();
const candidates = dedupeCandidates([
  ...deterministic.flatMap((group) => group.candidates),
  ...multiMarket.groups.flatMap((group) => group.candidates),
]);
const recentMap = await recentEvaluations();

const newlyListedEbay = candidates.filter((candidate) => candidate.marketplace === 'eBay' && isRecent(candidate.listedAt, 24));
const newlyDiscoveredOther = candidates.filter((candidate) => candidate.sourceKind === 'public-web' && candidate.marketplace.toLowerCase() !== 'ebay');
const imageReady = candidates.filter((candidate) => candidate.imageUrls.length >= 2);
const ranked = [...imageReady].sort((a, b) => candidatePriority(b, recentMap) - candidatePriority(a, recentMap));
const evaluationQueue = ranked.slice(0, MAX_EVALUATIONS);
const skippedRecent = evaluationQueue.filter((candidate) => candidatePriority(candidate, recentMap) < -1000).length;
const actualQueue = evaluationQueue.filter((candidate) => candidatePriority(candidate, recentMap) >= -1000);

console.log(`PORTFOLIO DISCOVERY: ${candidates.length} unique live candidates; ${imageReady.length} with 2+ images; ${actualQueue.length} selected for front/back InstaComp this run.`);
const evaluations = await runPool(actualQueue, EVALUATION_CONCURRENCY, evaluateCandidate);

const buys = evaluations.filter((row) => row.classification === 'portfolio_buy').sort((a, b) => Number(b.roiPercent) - Number(a.roiPercent));
const extreme = evaluations.filter((row) => row.classification === 'extreme_verify').sort((a, b) => Number(b.roiPercent) - Number(a.roiPercent));
const under15 = evaluations.filter((row) => row.classification === 'under_15');
const unresolved = evaluations.filter((row) => !['portfolio_buy', 'extreme_verify', 'under_15'].includes(row.classification));
const edgeReview = evaluations.filter((row) => row.candidate.discoveryManualReview || row.candidate.discoveryRisks?.length || row.classification === 'extreme_verify');
const historyInserted = evaluations.reduce((sum, row) => sum + Number(row.marketHistory?.inserted || 0), 0);

const [wnbaMovers, baseballMovers, nhlMovers] = await Promise.all([
  exactMarketMovers('WNBA', 15), exactMarketMovers('BASEBALL', 8), exactMarketMovers('NHL', 8),
]);

const lines = [
  'BALLS DEEP PORTFOLIO INTELLIGENCE',
  `Run: ${RUN_ID}`,
  `Verified portfolio buy gate: >= ${MIN_ROI}% expected NET ROI after acquisition + modeled resale costs; >=${EXTREME_ROI}% is held for fraud/seller/condition verification.`,
  '',
  `Discovery: ${candidates.length} unique live candidates across deterministic eBay + multi-market public discovery.`,
  `Front/back image-ready: ${imageReady.length}; InstaComp evaluated this run: ${evaluations.length}/${MAX_EVALUATIONS} cap.`,
  `Verified >=15% portfolio buys: ${buys.length}; extreme-spread verify: ${extreme.length}; under 15%: ${under15.length}; unresolved/rejected: ${unresolved.length}.`,
  `New eBay listings <=24h: ${newlyListedEbay.length}; newly discovered non-eBay listings this run: ${newlyDiscoveredOther.length}.`,
  `New exact-card market observations persisted by these evaluations: ${historyInserted}.`,
  '',
  '=== VERIFIED 15%+ PORTFOLIO BUYS ===',
  ...(buys.length ? buys.map(formatDeal) : ['No card cleared the verified 15%-49.99% net-ROI portfolio gate this run.']),
  '',
  '=== EXTREME SPREAD — VERIFY BEFORE BUYING ===',
  ...(extreme.length ? extreme.map(formatDeal) : ['None.']),
  '',
  '=== NEW LISTINGS / NEWLY DISCOVERED ===',
  ...newlyListedEbay.slice(0, 20).map((c) => `NEW eBay ${c.listedAt} — ${c.title} — ${money(c.itemPrice)} — ${c.listingUrl}`),
  ...newlyDiscoveredOther.slice(0, 25).map((c) => `DISCOVERED ${c.marketplace} — ${c.title} — ${money(c.itemPrice)} — ${c.listingUrl}`),
  ...(newlyListedEbay.length || newlyDiscoveredOther.length ? [] : ['No qualifying newly-listed/newly-discovered direct listings were returned.']),
  '',
  '=== MISLISTING / MISSPELLING / EDGE REVIEW ===',
  ...edgeReview.slice(0, 25).map((row) => `${row.classification || row.status} — ${row.candidate.marketplace} — ROI ${pct(row.roiPercent)} — ${row.candidate.title} — ${[...(row.candidate.discoveryRisks || [])].join('; ') || 'large verified spread'} — ${row.candidate.listingUrl}`),
  ...(edgeReview.length ? [] : ['No edge-review candidates survived discovery/evaluation this run.']),
  '',
  '=== WNBA EXACT-CARD PRICE MOVEMENT ===',
  ...wnbaMovers.map((m) => `${m.label} | 7d ${pct(m.sevenDay.changePct)} (${m.sevenDay.recentCount} recent sold) | 30d ${pct(m.thirtyDay.changePct)} | 90d ${pct(m.ninetyDay.changePct)} | sold obs ${m.soldObservations} | asks ${m.askObservations}`),
  ...(wnbaMovers.length ? [] : ['WNBA exact-card history does not yet have enough paired sold windows for movement percentages; this run still added verified observations where scans succeeded.']),
  '',
  '=== BASEBALL PROSPECT MARKET MINING ===',
  ...baseballMovers.map((m) => `${m.label} | 7d ${pct(m.sevenDay.changePct)} | 30d ${pct(m.thirtyDay.changePct)} | 90d ${pct(m.ninetyDay.changePct)} | sold obs ${m.soldObservations}`),
  ...(baseballMovers.length ? [] : ['No sufficiently populated exact-card baseball trend windows yet.']),
  '',
  '=== NHL PROSPECT MARKET MINING ===',
  ...nhlMovers.map((m) => `${m.label} | 7d ${pct(m.sevenDay.changePct)} | 30d ${pct(m.thirtyDay.changePct)} | 90d ${pct(m.ninetyDay.changePct)} | sold obs ${m.soldObservations}`),
  ...(nhlMovers.length ? [] : ['No sufficiently populated exact-card NHL trend windows yet.']),
  '',
  'BOUNDARIES: No automatic purchase was performed. Public-web discoveries are labeled DISCOVERED unless a source supplied a real listed timestamp. A card is not admitted to the portfolio list unless front/back InstaComp exact-locks a Checklist Registry identity, exact sold pricing exists, exact-card history saves successfully, and modeled net ROI is at least 15%.',
];

const topBuysHtml = buys.length ? buys.map(htmlDeal).join('') : '<p>No card cleared the verified 15%-49.99% net-ROI portfolio gate this run.</p>';
const movementRows = wnbaMovers.map((m) => `<tr><td style="padding:7px;border-bottom:1px solid #eee">${esc(m.label)}</td><td style="padding:7px;border-bottom:1px solid #eee">${esc(pct(m.sevenDay.changePct))}</td><td style="padding:7px;border-bottom:1px solid #eee">${esc(pct(m.thirtyDay.changePct))}</td><td style="padding:7px;border-bottom:1px solid #eee">${esc(pct(m.ninetyDay.changePct))}</td><td style="padding:7px;border-bottom:1px solid #eee">${m.soldObservations}</td></tr>`).join('');
const newRows = [...newlyListedEbay.slice(0, 12), ...newlyDiscoveredOther.slice(0, 18)].map((c) => `<li style="margin-bottom:9px"><b>${esc(c.marketplace)}</b> · ${esc(money(c.itemPrice))} · ${esc(c.title)} · <a href="${esc(c.listingUrl)}">open</a></li>`).join('');
const extremeHtml = extreme.length ? extreme.map(htmlDeal).join('') : '<p>None.</p>';
const edgeHtml = edgeReview.length ? `<ul>${edgeReview.slice(0, 20).map((row) => `<li style="margin-bottom:8px"><b>${esc(row.candidate.marketplace)}</b> · ROI ${esc(pct(row.roiPercent))} · ${esc(row.candidate.title)} · ${esc((row.candidate.discoveryRisks || []).join('; ') || 'extreme verified spread')} · <a href="${esc(row.candidate.listingUrl)}">open</a></li>`).join('')}</ul>` : '<p>None.</p>';

const subject = `BALLS DEEP PORTFOLIO — ${buys.length} verified 15%+ ROI buys — WNBA/MLB/NHL`;
const html = `<!doctype html><html><body style="margin:0;background:#f4f1ea;font-family:Arial,Helvetica,sans-serif;color:#111"><div style="max-width:980px;margin:auto;padding:24px"><section style="background:#101418;color:#fff;border-radius:14px;padding:24px"><div style="font-weight:900;letter-spacing:.13em">BALLS DEEP PORTFOLIO INTELLIGENCE</div><h1 style="margin:8px 0 0">${buys.length} verified 15%+ net-ROI buys</h1><p>${candidates.length} unique live candidates · ${evaluations.length} front/back InstaComp evaluations · ${historyInserted} new exact-card observations</p></section><h2>Verified 15%+ Portfolio Buys</h2>${topBuysHtml}<h2>Extreme Spread — Verify Before Buying</h2>${extremeHtml}<h2>New Listings / Newly Discovered</h2><ul>${newRows || '<li>None returned.</li>'}</ul><h2>Mislisting / Misspelling Edge Review</h2>${edgeHtml}<h2>WNBA Exact-Card Price Movement</h2><table style="width:100%;border-collapse:collapse;background:#fff"><thead><tr><th style="text-align:left;padding:7px">Card</th><th style="text-align:left;padding:7px">7d</th><th style="text-align:left;padding:7px">30d</th><th style="text-align:left;padding:7px">90d</th><th style="text-align:left;padding:7px">Sold obs</th></tr></thead><tbody>${movementRows || '<tr><td colspan="5" style="padding:10px">Not enough paired exact-sold windows yet; successful scans still added market history.</td></tr>'}</tbody></table><h2>Mining Status</h2><p>Baseball exact trend cards: ${baseballMovers.length} · NHL exact trend cards: ${nhlMovers.length}. Every successful Registry-locked evaluation writes exact asks/solds back into InstaComp market history.</p><p style="font-size:12px;color:#666">No auto-buy. Public-web items are “newly discovered” unless the source provides a real listed time. Portfolio admission requires front/back scan + Registry exact lock + trusted exact sold pricing + successful exact-history persistence + ≥15% modeled net ROI.</p></div></body></html>`;

const apiKey = String(process.env.RESEND_API_KEY || '').trim();
const from = String(process.env.MARKET_INTEL_FROM_EMAIL || '').trim();
const recipients = Array.from(new Set(String(process.env.MARKET_INTEL_ALERT_EMAIL || '')
  .split(/[;,\n]/).map((entry) => entry.trim()).filter((entry) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(entry))));
const enabled = String(process.env.MARKET_INTEL_EMAIL_ENABLED ?? 'true').trim().toLowerCase() !== 'false';
let emailAccepted = false;
let emailProviderIdPresent = false;
if (enabled && apiKey && from && recipients.length) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'User-Agent': 'tcos-portfolio-intelligence/1.0' },
    body: JSON.stringify({ from, to: recipients, subject, text: lines.join('\n'), html }),
    redirect: 'manual', signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json().catch(() => null);
  emailAccepted = response.ok && Boolean(payload?.id);
  emailProviderIdPresent = Boolean(payload?.id);
  if (!emailAccepted) throw new Error(`Portfolio report email submission failed with HTTP ${response.status}.`);
  console.log(`PORTFOLIO report accepted by production Resend; recipients=${recipients.length}.`);
} else {
  console.log('PORTFOLIO email delivery not configured/enabled; report was generated but not sent.');
}

const result = {
  schema: 'tcos.deal-hunter.portfolio-intelligence.v1',
  runId: RUN_ID,
  generatedAt: NOW.toISOString(),
  roiGatePercent: MIN_ROI,
  extremeVerificationPercent: EXTREME_ROI,
  deterministic: deterministic.map(({ candidates: ignored, ...group }) => group),
  multiMarket: { configured: multiMarket.configured, warnings: multiMarket.warnings, groupCounts: multiMarket.groups.map((g) => ({ bucket: g.bucket, count: g.candidates.length, warnings: g.warnings })) },
  discovery: { uniqueCandidates: candidates.length, imageReady: imageReady.length, newlyListedEbay24h: newlyListedEbay.length, newlyDiscoveredNonEbay: newlyDiscoveredOther.length, evaluationCap: MAX_EVALUATIONS, evaluated: evaluations.length, recentSamePriceSuppressed: skippedRecent },
  outcomes: { portfolioBuys: buys.length, extremeVerify: extreme.length, under15: under15.length, unresolved: unresolved.length, edgeReview: edgeReview.length, exactMarketObservationsInserted: historyInserted },
  buys: buys.map((row) => ({ title: row.candidate.title, marketplace: row.candidate.marketplace, url: row.candidate.listingUrl, roiPercent: row.roiPercent, expectedNetProfit: row.expectedNetProfit, deliveredCost: row.deliveredCost, conservativeResale: row.conservativeResale, soldCount: row.soldCount, identity: row.identity })),
  extreme: extreme.map((row) => ({ title: row.candidate.title, marketplace: row.candidate.marketplace, url: row.candidate.listingUrl, roiPercent: row.roiPercent, expectedNetProfit: row.expectedNetProfit, identity: row.identity })),
  trends: { wnba: wnbaMovers, baseball: baseballMovers, nhl: nhlMovers },
  email: { accepted: emailAccepted, providerIdPresent: emailProviderIdPresent, recipients: recipients.length, subject },
};
fs.writeFileSync(RESULT_PATH, JSON.stringify(result, null, 2), { mode: 0o600 });
console.log(`PORTFOLIO COMPLETE: buys=${buys.length} extreme=${extreme.length} evaluated=${evaluations.length} observationsInserted=${historyInserted}.`);
