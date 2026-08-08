import { NextRequest } from "next/server";
import { releaseRuntimeTeamIsAllowed } from "../../../../lib/vercel-release-runtime-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SITE_URL = "https://truelycollectables.com";
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  return authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
}

async function verifyVercelToken(request: Request) {
  const token = bearerToken(request);
  if (!token) return false;
  try {
    const response = await fetch("https://api.vercel.com/v2/teams?limit=100", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return false;
    const payload = (await response.json()) as { teams?: unknown };
    return releaseRuntimeTeamIsAllowed(payload.teams);
  } catch {
    return false;
  }
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function compact(value: unknown) {
  return text(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeCardNumber(value: unknown) {
  return compact(value)
    .replace(/^card\s*/, "")
    .replace(/^no\s*/, "")
    .replace(/\s/g, "");
}

function canonicalSeason(value: unknown) {
  const raw = text(value).replace(/[–—]/g, "-");
  const match = raw.match(/\b((?:19|20)\d{2})\s*[-/]\s*(\d{2,4})\b/);
  if (!match) return compact(raw);
  const end = match[2].length === 2 ? `${match[1].slice(0, 2)}${match[2]}` : match[2];
  return `${match[1]}-${end}`;
}

function fuzzyMatch(left: unknown, right: unknown) {
  const a = compact(left);
  const b = compact(right);
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const at = a.split(" ").filter((token) => token.length > 1);
  const bt = b.split(" ").filter((token) => token.length > 1);
  const overlap = at.filter((token) => bt.includes(token)).length;
  return overlap / Math.max(1, Math.min(at.length, bt.length)) >= 0.75;
}

function serialFromText(value: unknown) {
  const raw = text(value);
  const exact = [...raw.matchAll(/(?:^|\D)(\d{1,4})\s*\/\s*(\d{1,4})(?:\D|$)/g)]
    .map((match) => ({
      exact: `${Number(match[1])}/${Number(match[2])}`,
      numerator: Number(match[1]),
      run: Number(match[2]),
    }))
    .find((row) => row.numerator <= row.run && row.run >= 2 && row.run <= 9999);
  if (exact) return exact;
  const run = raw.match(/(?:numbered|serial(?:ized)?|#'?d)[^0-9]{0,12}(?:\/|to|of)\s*(\d{1,4})\b/i);
  return run ? { exact: null, numerator: null, run: Number(run[1]) } : null;
}

function complexity(title: string) {
  const value = title.toLowerCase();
  let score = 0;
  if (/auto|autograph|signed/.test(value)) score += 4;
  if (/patch|relic|jersey|memorabilia|swatch|rpa/.test(value)) score += 4;
  if (serialFromText(value)) score += 4;
  if (/prizm|refractor|parallel|silver|gold|red|blue|green|orange|purple|wave|ice|velocity|shimmer|scope|mojo|cracked|sparkle|x-fractor/.test(value)) score += 2;
  if (/\brc\b|rookie/.test(value)) score += 1;
  return score;
}

async function jsonFetch(url: string, init: RequestInit = {}, timeoutMs = 45_000) {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const raw = await response.text();
  let payload: any = null;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    payload = { raw: raw.slice(0, 1000) };
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${JSON.stringify(payload).slice(0, 1000)}`);
  }
  return payload;
}

async function ebayToken() {
  const clientId = text(process.env.EBAY_CLIENT_ID);
  const clientSecret = text(process.env.EBAY_CLIENT_SECRET);
  if (!clientId || !clientSecret) throw new Error("Production eBay credentials are missing.");
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: "https://api.ebay.com/oauth/api_scope",
  });
  const response = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json();
  if (!response.ok || !payload?.access_token) {
    throw new Error(`eBay OAuth failed: ${JSON.stringify(payload).slice(0, 500)}`);
  }
  return String(payload.access_token);
}

async function ebayItem(token: string, listingItemId: string) {
  const headers = {
    Authorization: `Bearer ${token}`,
    "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
    Accept: "application/json",
  };
  const urls = listingItemId.startsWith("v1|")
    ? [`https://api.ebay.com/buy/browse/v1/item/${encodeURIComponent(listingItemId)}`]
    : [
        `https://api.ebay.com/buy/browse/v1/item/get_item_by_legacy_id?legacy_item_id=${encodeURIComponent(listingItemId)}`,
        `https://api.ebay.com/buy/browse/v1/item/${encodeURIComponent(`v1|${listingItemId}|0`)}`,
      ];
  for (const url of urls) {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
    if (response.ok) return response.json();
  }
  return null;
}

function aspects(item: any) {
  const map = new Map<string, string>();
  for (const row of item?.localizedAspects || []) {
    const key = compact(row?.name);
    if (key && !map.has(key)) map.set(key, text(row?.value));
  }
  return map;
}

function aspect(map: Map<string, string>, names: string[]) {
  for (const name of names) {
    const value = map.get(compact(name));
    if (value) return value;
  }
  return null;
}

type Candidate = {
  sport: "basketball" | "baseball" | "hockey";
  lane: string;
  listingItemId: string;
  listingUrl: string;
  title: string;
  imageUrls: string[];
  complexity: number;
  expected?: Record<string, any>;
};

const feeds: Array<[Candidate["sport"], string, string]> = [
  ["basketball", "wnba", `${SITE_URL}/api/tcos/deal-hunter-native-ebay?perQuery=20&scope=wnba`],
  ["baseball", "baseball_prospects", `${SITE_URL}/api/tcos/deal-hunter-native-ebay?perQuery=20&scope=baseball_prospects`],
  ["hockey", "ivan_demidov", `${SITE_URL}/api/tcos/deal-hunter-native-ebay?perQuery=20&scope=ivan_demidov`],
  ["hockey", "matvei_michkov_young_guns", `${SITE_URL}/api/tcos/deal-hunter-native-ebay?perQuery=20&scope=matvei_michkov_young_guns`],
  ["hockey", "matvei_michkov_opc_platinum", `${SITE_URL}/api/tcos/deal-hunter-michkov-opc-platinum?perQuery=20`],
];

async function discoverCandidates() {
  const aggregate = new Map<string, Candidate>();
  const payloads = await Promise.all(
    feeds.map(async ([sport, lane, url]) => ({ sport, lane, payload: await jsonFetch(url) })),
  );
  for (const { sport, lane, payload } of payloads) {
    if (payload?.ok !== true || !Array.isArray(payload?.results)) {
      throw new Error(`${lane} feed was not complete.`);
    }
    for (const row of payload.results) {
      const listingItemId = text(row?.listingItemId);
      const listingUrl = text(row?.listingUrl);
      const imageUrls = Array.from(new Set((row?.imageUrls || []).map((value: unknown) => text(value)).filter(Boolean)));
      if (!listingItemId || !listingUrl || imageUrls.length < 2) continue;
      aggregate.set(listingItemId, {
        sport,
        lane,
        listingItemId,
        listingUrl,
        title: text(row?.title) || "Untitled listing",
        imageUrls,
        complexity: complexity(text(row?.title)),
      });
    }
  }
  return [...aggregate.values()];
}

async function enrichCandidates(candidates: Candidate[]) {
  const token = await ebayToken();
  const output: Candidate[] = [];
  let cursor = 0;
  async function worker() {
    while (cursor < candidates.length) {
      const index = cursor++;
      const candidate = candidates[index];
      const item = await ebayItem(token, candidate.listingItemId);
      if (!item) continue;
      const map = aspects(item);
      const title = text(item?.title) || candidate.title;
      const imageUrls = Array.from(
        new Set([
          text(item?.image?.imageUrl),
          ...(item?.additionalImages || []).map((row: any) => text(row?.imageUrl)),
          ...candidate.imageUrls,
        ].filter(Boolean)),
      );
      if (imageUrls.length < 2) continue;
      const expected: Record<string, any> = {
        sport: aspect(map, ["Sport"]) || candidate.sport,
        player: aspect(map, ["Player/Athlete", "Player"]),
        year: aspect(map, ["Year Manufactured", "Season"]),
        manufacturer: aspect(map, ["Manufacturer", "Brand"]),
        setName: aspect(map, ["Set"]),
        cardNumber: aspect(map, ["Card Number"]),
        parallel: aspect(map, ["Parallel/Variety"]),
        rookie: null,
        autograph: null,
        memorabilia: null,
        memorabiliaType: null,
        serial: serialFromText(title),
      };
      const features = [aspect(map, ["Features"]), aspect(map, ["Card Attributes"]), title]
        .filter(Boolean)
        .join(" | ");
      const autoAspect = aspect(map, ["Autographed"]);
      if (autoAspect) expected.autograph = /yes|true/i.test(autoAspect);
      else if (/auto|autograph|signed/i.test(title)) expected.autograph = true;
      if (/\brookie\b|\brc\b/i.test(features)) expected.rookie = true;
      else if (aspect(map, ["Features"])) expected.rookie = false;
      if (/patch|relic|jersey|memorabilia|swatch|rpa/i.test(features)) {
        expected.memorabilia = true;
        expected.memorabiliaType = (features.match(/\b(rpa|patch|jersey|relic|memorabilia|swatch)\b/i) || [])[1] || null;
      }
      if ([expected.player, expected.year, expected.setName, expected.cardNumber].filter(Boolean).length < 4) continue;
      output.push({
        ...candidate,
        title,
        listingUrl: text(item?.itemWebUrl) || candidate.listingUrl,
        imageUrls,
        complexity: complexity(title) + (imageUrls.length === 2 ? 2 : 0),
        expected,
      });
    }
  }
  await Promise.all(Array.from({ length: 6 }, () => worker()));
  return output;
}

function select25(candidates: Candidate[]) {
  const quotas: Record<Candidate["sport"], number> = { basketball: 8, baseball: 8, hockey: 9 };
  const selected: Candidate[] = [];
  for (const sport of Object.keys(quotas) as Candidate["sport"][]) {
    selected.push(
      ...candidates
        .filter((row) => row.sport === sport)
        .sort((a, b) => b.complexity - a.complexity || a.imageUrls.length - b.imageUrls.length)
        .slice(0, quotas[sport]),
    );
  }
  const used = new Set(selected.map((row) => row.listingItemId));
  for (const row of [...candidates].sort((a, b) => b.complexity - a.complexity)) {
    if (selected.length >= 25) break;
    if (!used.has(row.listingItemId)) {
      selected.push(row);
      used.add(row.listingItemId);
    }
  }
  if (selected.length < 25) {
    throw new Error(`Only ${selected.length} independently grounded two-image listings were available.`);
  }
  return selected.slice(0, 25);
}

async function downloadImage(url: string) {
  const response = await fetch(url, {
    headers: {
      Accept: "image/jpeg,image/png,image/webp",
      "User-Agent": "InstaComp-AI-25-Card-Stress/1.0",
    },
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new Error(`Image HTTP ${response.status}`);
  const type = text(response.headers.get("content-type")).split(";", 1)[0].toLowerCase();
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!ALLOWED_IMAGE_TYPES.has(type) || !bytes.length || bytes.length > MAX_IMAGE_BYTES) {
    throw new Error(`Invalid image ${type || "unknown"} ${bytes.length}`);
  }
  return { bytes, type };
}

function predictedIdentity(scan: any) {
  return scan?.trusted_identity || scan?.local_suggestion?.identity || scan?.local_vision?.identity_hints || {};
}

function grade(expected: Record<string, any>, scan: any, title: string) {
  const ai = predictedIdentity(scan);
  const serialEvidence = scan?.local_vision?.serial || {};
  const checks: Array<Record<string, any>> = [];
  const add = (field: string, expectedValue: any, actualValue: any, pass: boolean) => {
    if (expectedValue !== null && expectedValue !== undefined && text(expectedValue)) {
      checks.push({ field, expected: expectedValue, actual: actualValue ?? null, pass: Boolean(pass) });
    }
  };
  add("sport", expected.sport, ai.sport, fuzzyMatch(expected.sport, ai.sport));
  add("player", expected.player, ai.player, fuzzyMatch(expected.player, ai.player));
  add(
    "year",
    expected.year,
    ai.year,
    canonicalSeason(expected.year) === canonicalSeason(ai.year) || fuzzyMatch(expected.year, ai.year),
  );
  add("manufacturer", expected.manufacturer, ai.manufacturer || ai.brand, fuzzyMatch(expected.manufacturer, ai.manufacturer || ai.brand));
  add("setName", expected.setName, ai.set_name, fuzzyMatch(expected.setName, ai.set_name));
  add("cardNumber", expected.cardNumber, ai.card_number, normalizeCardNumber(expected.cardNumber) === normalizeCardNumber(ai.card_number));
  add("parallel", expected.parallel, ai.parallel, fuzzyMatch(expected.parallel, ai.parallel));
  if (expected.rookie !== null) add("rookie", expected.rookie, ai.rookie, Boolean(ai.rookie) === expected.rookie);
  if (expected.autograph !== null) add("autograph", expected.autograph, ai.autograph, Boolean(ai.autograph) === expected.autograph);
  if (expected.memorabilia !== null) add("memorabilia", expected.memorabilia, ai.memorabilia, Boolean(ai.memorabilia) === expected.memorabilia);
  if (expected.memorabiliaType) add("memorabiliaType", expected.memorabiliaType, ai.memorabilia_type, fuzzyMatch(expected.memorabiliaType, ai.memorabilia_type));
  if (expected.serial?.run) {
    const actualExact = ai.serial_number || serialEvidence.exact_stamp || null;
    const actualRun = Number(ai.serial_run || serialEvidence.visible_denominator || 0) || null;
    if (expected.serial.exact) add("serialExact", expected.serial.exact, actualExact, compact(expected.serial.exact) === compact(actualExact));
    add("serialRun", expected.serial.run, actualRun, Number(expected.serial.run) === Number(actualRun));
  }
  if (ai.autograph === true && expected.autograph !== true && !/auto|autograph|signed/i.test(title)) {
    checks.push({ field: "unsupportedAutoClaim", expected: false, actual: true, pass: false });
  }
  if (ai.memorabilia === true && expected.memorabilia !== true && !/patch|relic|jersey|memorabilia|swatch|rpa/i.test(title)) {
    checks.push({ field: "unsupportedMemorabiliaClaim", expected: false, actual: true, pass: false });
  }
  const passed = checks.filter((row) => row.pass).length;
  return {
    pass: checks.length > 0 && passed === checks.length,
    passed,
    total: checks.length,
    checks,
    ai,
    status: scan?.status || null,
    trusted: Boolean(scan?.trusted_identity),
    matchSource: scan?.match_source || null,
    pricingAllowed: Boolean(scan?.pricing_allowed),
    backProcessed: Boolean(scan?.local_vision?.back),
  };
}

async function scanCandidate(candidate: Candidate) {
  const macBase = text(process.env.INSTACOMP_AI_LOCAL_URL).replace(/\/+$/, "");
  const key = text(process.env.INSTACOMP_AI_LOCAL_KEY);
  if (!/^https:\/\//i.test(macBase) || !key) {
    throw new Error("Production InstaComp Mac route is not configured.");
  }
  const [front, back] = await Promise.all([
    downloadImage(candidate.imageUrls[0]),
    downloadImage(candidate.imageUrls[1]),
  ]);
  const form = new FormData();
  form.set("front", new Blob([front.bytes], { type: front.type }), "front.jpg");
  form.set("back", new Blob([back.bytes], { type: back.type }), "back.jpg");
  const response = await fetch(`${macBase}/v1/scans/analyze`, {
    method: "POST",
    headers: { "X-InstaComp-AI-Key": key, Accept: "application/json" },
    body: form,
    signal: AbortSignal.timeout(180_000),
  });
  const scan = await response.json().catch(() => null);
  if (!response.ok || !scan) {
    throw new Error(`Mac scan HTTP ${response.status}: ${JSON.stringify(scan).slice(0, 800)}`);
  }
  return scan;
}

async function scanAll(selected: Candidate[]) {
  const results: any[] = new Array(selected.length);
  let cursor = 0;
  async function worker() {
    while (cursor < selected.length) {
      const index = cursor++;
      const candidate = selected[index];
      try {
        const scan = await scanCandidate(candidate);
        results[index] = {
          index: index + 1,
          sport: candidate.sport,
          lane: candidate.lane,
          title: candidate.title,
          listingItemId: candidate.listingItemId,
          listingUrl: candidate.listingUrl,
          imageUrls: candidate.imageUrls.slice(0, 2),
          expected: candidate.expected,
          complexity: candidate.complexity,
          grade: grade(candidate.expected || {}, scan, candidate.title),
        };
      } catch (error) {
        results[index] = {
          index: index + 1,
          sport: candidate.sport,
          lane: candidate.lane,
          title: candidate.title,
          listingItemId: candidate.listingItemId,
          listingUrl: candidate.listingUrl,
          imageUrls: candidate.imageUrls.slice(0, 2),
          expected: candidate.expected,
          complexity: candidate.complexity,
          error: error instanceof Error ? error.message : String(error),
          grade: {
            pass: false,
            passed: 0,
            total: 1,
            checks: [{ field: "scan", expected: "completed", actual: "failed", pass: false }],
            trusted: false,
            backProcessed: false,
          },
        };
      }
    }
  }
  await Promise.all([worker(), worker()]);
  return results;
}

export async function POST(request: NextRequest) {
  if (!(await verifyVercelToken(request))) {
    return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const configured = {
      macUrl: Boolean(text(process.env.INSTACOMP_AI_LOCAL_URL)),
      macKey: Boolean(text(process.env.INSTACOMP_AI_LOCAL_KEY)),
      ebay: Boolean(text(process.env.EBAY_CLIENT_ID) && text(process.env.EBAY_CLIENT_SECRET)),
    };
    if (!configured.macUrl || !configured.macKey || !configured.ebay) {
      return Response.json({ success: false, error: "Production stress-test dependencies are not configured.", configured }, { status: 503 });
    }
    const discovered = await discoverCandidates();
    const enriched = await enrichCandidates(discovered);
    const selected = select25(enriched);
    const results = await scanAll(selected);
    const cardsPassed = results.filter((row) => row.grade?.pass).length;
    const totalChecks = results.reduce((sum, row) => sum + Number(row.grade?.total || 0), 0);
    const passedChecks = results.reduce((sum, row) => sum + Number(row.grade?.passed || 0), 0);
    const trusted = results.filter((row) => row.grade?.trusted).length;
    const backProcessed = results.filter((row) => row.grade?.backProcessed).length;
    const summary = {
      schema: "truelycollectables.instacomp.25-card-stress.v3",
      completedAt: new Date().toISOString(),
      selectedListings: results.length,
      sports: Object.fromEntries(["basketball", "baseball", "hockey"].map((sport) => [sport, results.filter((row) => row.sport === sport).length])),
      complexCounts: {
        autograph: results.filter((row) => row.expected?.autograph === true).length,
        memorabilia: results.filter((row) => row.expected?.memorabilia === true).length,
        serialized: results.filter((row) => row.expected?.serial?.run).length,
        parallel: results.filter((row) => row.expected?.parallel).length,
        rookie: results.filter((row) => row.expected?.rookie === true).length,
      },
      cardsPassed,
      cardsFailed: results.length - cardsPassed,
      cardAccuracyPercent: Number(((cardsPassed / Math.max(1, results.length)) * 100).toFixed(1)),
      fieldChecksPassed: passedChecks,
      fieldChecksTotal: totalChecks,
      fieldAccuracyPercent: totalChecks ? Number(((passedChecks / totalChecks) * 100).toFixed(1)) : 0,
      trustedRegistryLocks: trusted,
      backImagesProcessed: backProcessed,
      perfect: results.length === 25 && cardsPassed === 25,
      failures: results.filter((row) => !row.grade?.pass).map((row) => ({
        index: row.index,
        title: row.title,
        listingUrl: row.listingUrl,
        error: row.error || null,
        failedChecks: (row.grade?.checks || []).filter((check: any) => !check.pass),
      })),
    };
    return Response.json({ success: true, summary, results }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
