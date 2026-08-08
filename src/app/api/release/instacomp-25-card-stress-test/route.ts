import { timingSafeEqual } from "node:crypto";
import { NextRequest } from "next/server";
import { POST as runIdentityScan } from "../../instacomp/scan/route";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";
import { getInstaCompServiceToken } from "../../../../lib/tcos-profit-hunter-secrets";
import { releaseRuntimeTeamIsAllowed } from "../../../../lib/vercel-release-runtime-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const EBAY_API = "https://api.ebay.com";
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const SEARCHES = [
  { sport: "Basketball", query: "basketball rookie autograph serial card" },
  { sport: "Basketball", query: "WNBA rookie autograph card" },
  { sport: "Basketball", query: "basketball rookie patch auto card" },
  { sport: "Baseball", query: "Bowman Chrome prospect autograph card" },
  { sport: "Baseball", query: "baseball rookie autograph serial card" },
  { sport: "Baseball", query: "baseball rookie patch auto card" },
  { sport: "Football", query: "football rookie autograph serial card" },
  { sport: "Football", query: "football rookie patch auto card" },
  { sport: "Football", query: "football rookie parallel numbered card" },
  { sport: "Hockey", query: "hockey rookie autograph serial card" },
  { sport: "Hockey", query: "Upper Deck Young Guns numbered parallel" },
  { sport: "Hockey", query: "hockey rookie patch auto card" },
] as const;

const SPORT_QUOTAS: Record<string, number> = {
  Basketball: 6,
  Baseball: 6,
  Football: 6,
  Hockey: 7,
};

type EbayImage = { imageUrl?: string | null };
type EbayAspect = { name?: string | null; value?: string | null };
type EbayItem = {
  itemId?: string | null;
  legacyItemId?: string | null;
  title?: string | null;
  itemWebUrl?: string | null;
  image?: EbayImage | null;
  additionalImages?: EbayImage[] | null;
  localizedAspects?: EbayAspect[] | null;
};

type Expected = {
  sport: string;
  player: string;
  year: string;
  brand: string;
  setName: string;
  cardNumber: string;
  parallel: string | null;
  isRookie: boolean | null;
  isAuto: boolean | null;
  isRelic: boolean | null;
  serialExact: string | null;
  serialRun: number | null;
};

type Candidate = {
  sport: string;
  itemId: string;
  legacyItemId: string | null;
  title: string;
  url: string;
  imageUrls: string[];
  expected: Expected;
  complexity: number;
};

type ImageRoles = {
  frontIndex: number;
  backIndex: number;
  confidence: number;
  method: "openai" | "fallback";
  note: string;
};

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalized(value: unknown) {
  return clean(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactCardNumber(value: unknown) {
  return normalized(value).replace(/[^a-z0-9]/g, "");
}

function canonicalSeason(value: unknown) {
  const raw = clean(value).replace(/[–—]/g, "-");
  const match = raw.match(/\b((?:19|20)\d{2})\s*[-/]\s*(\d{2,4})\b/);
  if (!match) return normalized(raw);
  const end = match[2].length === 2 ? `${match[1].slice(0, 2)}${match[2]}` : match[2];
  return `${match[1]}-${end}`;
}

function phraseMatch(actual: unknown, expected: unknown) {
  const a = normalized(actual);
  const e = normalized(expected);
  if (!a || !e) return false;
  if (a === e || a.includes(e) || e.includes(a)) return true;
  const at = a.split(" ").filter((token) => token.length > 1);
  const et = e.split(" ").filter((token) => token.length > 1);
  const overlap = at.filter((token) => et.includes(token)).length;
  return overlap / Math.max(1, Math.min(at.length, et.length)) >= 0.75;
}

function exactSerial(value: unknown) {
  const match = clean(value).match(/(?:^|\D)(\d{1,4})\s*\/\s*(\d{1,4})(?:\D|$)/);
  if (!match) return null;
  const numerator = Number(match[1]);
  const denominator = Number(match[2]);
  if (!denominator || numerator > denominator) return null;
  return `${numerator}/${denominator}`;
}

function serialRun(value: unknown) {
  const matches = Array.from(clean(value).matchAll(/\/\s*(\d{1,5})\b/g));
  const last = matches.at(-1)?.[1];
  return last ? Number(last) : null;
}

function aspectMap(item: EbayItem) {
  const map = new Map<string, string>();
  for (const row of item.localizedAspects || []) {
    const key = normalized(row?.name);
    const value = clean(row?.value);
    if (key && value && !map.has(key)) map.set(key, value);
  }
  return map;
}

function aspect(map: Map<string, string>, names: string[]) {
  for (const name of names) {
    const value = map.get(normalized(name));
    if (value) return value;
  }
  return null;
}

function ebayImages(item: EbayItem) {
  const values: string[] = [
    clean(item.image?.imageUrl),
    ...(item.additionalImages || []).map((image) => clean(image?.imageUrl)),
  ].filter((value) => Boolean(value));
  return Array.from(new Set(values)).map((url) =>
    url.replace(/\/s-l\d+(?=\.(?:jpe?g|png|webp)(?:\?|$))/i, "/s-l1600"),
  );
}

function rejectedTitle(title: string) {
  return /\b(?:lot|team set|complete set|reprint|custom|digital|nft|break|you pick|choose your card|psa|bgs|sgc|cgc|graded|gem mint|box|case|pack)\b/i.test(title);
}

function expectedFrom(item: EbayItem, fallbackSport: string): Expected | null {
  const map = aspectMap(item);
  const title = clean(item.title);
  const sport = aspect(map, ["Sport"]) || fallbackSport;
  const player = aspect(map, ["Player/Athlete", "Player"]);
  const year = aspect(map, ["Season", "Year Manufactured"]);
  const brand = aspect(map, ["Manufacturer", "Brand"]);
  const setName = aspect(map, ["Set"]);
  const cardNumber = aspect(map, ["Card Number"]);
  if (!player || !year || !brand || !setName || !cardNumber) return null;
  if (!phraseMatch(title, player)) return null;
  if (!normalized(title).includes(normalized(cardNumber))) return null;

  const parallel = aspect(map, ["Parallel/Variety"]);
  const features = [
    aspect(map, ["Features"]),
    aspect(map, ["Card Attributes"]),
    title,
  ].filter(Boolean).join(" | ");
  const autoAspect = aspect(map, ["Autographed"]);
  const relicAspect = aspect(map, ["Memorabilia", "Relic"]);
  const serialAspect = aspect(map, ["Card Serial Number", "Serial Number", "Print Run"]);
  const serialText = [serialAspect, title].filter(Boolean).join(" | ");
  let isRookie: boolean | null = null;
  if (/\brookie\b|\brc\b/i.test(features)) isRookie = true;
  else if (aspect(map, ["Features"])) isRookie = false;
  let isAuto: boolean | null = null;
  if (autoAspect) isAuto = /yes|true/i.test(autoAspect);
  else if (/\bauto(?:graph)?\b|signed/i.test(title)) isAuto = true;
  let isRelic: boolean | null = null;
  if (relicAspect) isRelic = /yes|true|patch|relic|jersey|memorabilia|swatch/i.test(relicAspect);
  else if (/patch|relic|jersey|memorabilia|swatch|rpa/i.test(features)) isRelic = true;

  return {
    sport,
    player,
    year,
    brand,
    setName,
    cardNumber,
    parallel,
    isRookie,
    isAuto,
    isRelic,
    serialExact: exactSerial(serialText),
    serialRun: serialRun(serialText),
  };
}

function complexity(expected: Expected, title: string, imageCount: number) {
  let score = imageCount === 2 ? 4 : 0;
  if (expected.isAuto === true) score += 6;
  if (expected.isRelic === true) score += 6;
  if (expected.serialRun) score += 6;
  if (expected.parallel) score += 3;
  if (expected.isRookie === true) score += 2;
  if (/1\/1|one of one/i.test(title)) score += 4;
  return score;
}

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

let ebayTokenCache: { token: string; expiresAt: number } | null = null;
async function ebayToken() {
  if (ebayTokenCache && ebayTokenCache.expiresAt > Date.now() + 60_000) {
    return ebayTokenCache.token;
  }
  const clientId = clean(process.env.EBAY_CLIENT_ID);
  const clientSecret = clean(process.env.EBAY_CLIENT_SECRET);
  if (!clientId || !clientSecret) throw new Error("Production eBay credentials are missing.");
  const response = await fetch(`${EBAY_API}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "https://api.ebay.com/oauth/api_scope",
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.access_token) throw new Error("eBay OAuth failed.");
  ebayTokenCache = {
    token: String(payload.access_token),
    expiresAt: Date.now() + Math.max(300, Number(payload.expires_in) || 7200) * 1000,
  };
  return ebayTokenCache.token;
}

async function searchEbay(sport: string, query: string) {
  const token = await ebayToken();
  const url = new URL(`${EBAY_API}/buy/browse/v1/item_summary/search`);
  url.searchParams.set("q", query);
  url.searchParams.set("category_ids", "261328");
  url.searchParams.set("limit", "50");
  url.searchParams.set("fieldgroups", "EXTENDED");
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      "X-EBAY-C-ENDUSERCTX": "contextualLocation=country=US,zip=80014",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`eBay search failed for ${sport}.`);
  const rows = (Array.isArray(payload?.itemSummaries) ? payload.itemSummaries : []) as EbayItem[];
  const candidates: Candidate[] = [];
  for (const item of rows) {
    const itemId = clean(item.itemId);
    const title = clean(item.title);
    const urlValue = clean(item.itemWebUrl);
    const imageUrls = ebayImages(item);
    if (!itemId || !title || !urlValue || imageUrls.length < 2 || rejectedTitle(title)) continue;
    const expected = expectedFrom(item, sport);
    if (!expected) continue;
    candidates.push({
      sport,
      itemId,
      legacyItemId: clean(item.legacyItemId) || null,
      title,
      url: urlValue,
      imageUrls,
      expected,
      complexity: complexity(expected, title, imageUrls.length),
    });
  }
  return candidates;
}

function select25(candidates: Candidate[]) {
  const deduped = Array.from(new Map(candidates.map((row) => [row.itemId, row])).values());
  const selected: Candidate[] = [];
  const used = new Set<string>();
  for (const [sport, quota] of Object.entries(SPORT_QUOTAS)) {
    const pool = deduped
      .filter((row) => phraseMatch(row.expected.sport, sport) || row.sport === sport)
      .sort((a, b) => b.complexity - a.complexity || a.imageUrls.length - b.imageUrls.length);
    for (const row of pool.slice(0, quota)) {
      if (!used.has(row.itemId)) {
        selected.push(row);
        used.add(row.itemId);
      }
    }
  }
  for (const row of deduped.sort((a, b) => b.complexity - a.complexity)) {
    if (selected.length >= 25) break;
    if (!used.has(row.itemId)) {
      selected.push(row);
      used.add(row.itemId);
    }
  }
  if (selected.length < 25) {
    throw new Error(`Only ${selected.length} suitable live two-image listings were found.`);
  }
  return selected.slice(0, 25);
}

function outputText(payload: any) {
  return (Array.isArray(payload?.choices) ? payload.choices : [])
    .map((choice: any) => clean(choice?.message?.content))
    .filter(Boolean)
    .join("\n");
}

async function selectImageRoles(urls: string[]): Promise<ImageRoles> {
  const fallback: ImageRoles = {
    frontIndex: 0,
    backIndex: 1,
    confidence: 0,
    method: "fallback",
    note: "Could not independently verify image roles; used eBay primary plus first additional image.",
  };
  const apiKey = clean(process.env.OPENAI_API_KEY);
  if (!apiKey || urls.length < 2) return fallback;
  const content: any[] = [{
    type: "text",
    text: "Choose one clear FRONT and one clear BACK image of the same physical sports card. Reject duplicate fronts, closeups, slabs, shipping photos, or unrelated cards. Return zero-based indices and confidence.",
  }];
  urls.slice(0, 6).forEach((url, index) => {
    content.push({ type: "text", text: `IMAGE ${index}` });
    content.push({ type: "image_url", image_url: { url, detail: "low" } });
  });
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: clean(process.env.INSTACOMP_OPENAI_FALLBACK_MODEL) || "gpt-4.1-mini",
        temperature: 0,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "front_back_selection",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                frontIndex: { type: ["integer", "null"] },
                backIndex: { type: ["integer", "null"] },
                confidence: { type: "number" },
                note: { type: "string" },
              },
              required: ["frontIndex", "backIndex", "confidence", "note"],
            },
          },
        },
        messages: [{ role: "user", content }],
      }),
      signal: AbortSignal.timeout(45_000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return fallback;
    const parsed = JSON.parse(outputText(payload));
    const frontIndex = Number(parsed.frontIndex);
    const backIndex = Number(parsed.backIndex);
    const confidence = Number(parsed.confidence);
    if (
      !Number.isInteger(frontIndex) ||
      !Number.isInteger(backIndex) ||
      frontIndex < 0 ||
      backIndex < 0 ||
      frontIndex >= urls.length ||
      backIndex >= urls.length ||
      frontIndex === backIndex
    ) return fallback;
    return {
      frontIndex,
      backIndex,
      confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
      method: "openai",
      note: clean(parsed.note),
    };
  } catch {
    return fallback;
  }
}

function imageType(bytes: Uint8Array) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

async function downloadImage(url: string, fileName: string) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { "User-Agent": "TCOS-InstaComp-25-Stress/1.0" },
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new Error(`${fileName} download failed (${response.status}).`);
  const buffer = await response.arrayBuffer();
  if (!buffer.byteLength || buffer.byteLength > MAX_IMAGE_BYTES) throw new Error(`${fileName} image size invalid.`);
  const type = imageType(new Uint8Array(buffer));
  if (!type || !ALLOWED_IMAGE_TYPES.has(type)) throw new Error(`${fileName} image type invalid.`);
  return new File([buffer], fileName, { type });
}

function grade(expected: Expected, scan: any, roles: ImageRoles) {
  const ai = scan?.ai || {};
  const checks: Array<{ field: string; expected: unknown; actual: unknown; pass: boolean }> = [];
  const add = (field: string, expectedValue: unknown, actualValue: unknown, pass: boolean) => {
    checks.push({ field, expected: expectedValue, actual: actualValue ?? null, pass });
  };
  add("front/back verified", "front + back same card", roles.note, roles.method === "openai" && roles.confidence >= 0.7);
  add("sport", expected.sport, ai.sport, phraseMatch(ai.sport, expected.sport));
  add("player", expected.player, ai.player, phraseMatch(ai.player, expected.player));
  add("year", expected.year, ai.year, canonicalSeason(ai.year) === canonicalSeason(expected.year));
  add("manufacturer", expected.brand, ai.brand, phraseMatch(ai.brand, expected.brand));
  add("set", expected.setName, ai.setName, phraseMatch(ai.setName, expected.setName));
  add("card number", expected.cardNumber, ai.cardNumber, compactCardNumber(ai.cardNumber) === compactCardNumber(expected.cardNumber));
  if (expected.parallel) add("parallel", expected.parallel, ai.parallel, phraseMatch(ai.parallel, expected.parallel) || phraseMatch(ai.setName, expected.parallel));
  if (expected.isRookie !== null) add("rookie", expected.isRookie, Boolean(ai.isRookie), Boolean(ai.isRookie) === expected.isRookie);
  if (expected.isAuto !== null) add("autograph", expected.isAuto, Boolean(ai.isAuto), Boolean(ai.isAuto) === expected.isAuto);
  if (expected.isRelic !== null) add("memorabilia/relic", expected.isRelic, Boolean(ai.isRelic), Boolean(ai.isRelic) === expected.isRelic);
  if (expected.serialExact) add("serial number", expected.serialExact, ai.serialNumber, exactSerial(ai.serialNumber) === expected.serialExact);
  else if (expected.serialRun) add("serial print run", expected.serialRun, ai.serialNumber, serialRun(ai.serialNumber) === expected.serialRun);
  const passed = checks.filter((check) => check.pass).length;
  return {
    pass: passed === checks.length,
    passed,
    total: checks.length,
    checks,
    confidence: Number(ai.confidence) || 0,
  };
}

async function cleanupScan(scanId: unknown) {
  const id = clean(scanId);
  if (!id) return;
  try {
    const supabase = createSupabaseServerClient({ admin: true });
    await supabase.from("instacomp_scans").delete().eq("id", id);
  } catch {
    // Benchmark cleanup is best-effort and never changes the grade.
  }
}

async function runOne(candidate: Candidate, request: NextRequest, index: number) {
  const roles = await selectImageRoles(candidate.imageUrls);
  const frontUrl = candidate.imageUrls[roles.frontIndex];
  const backUrl = candidate.imageUrls[roles.backIndex];
  const [front, back] = await Promise.all([
    downloadImage(frontUrl, `${index + 1}-front.jpg`),
    downloadImage(backUrl, `${index + 1}-back.jpg`),
  ]);
  const form = new FormData();
  form.set("frontImage", front);
  form.set("backImage", back);
  form.set("aiCouncilTier", "basic");
  const headers = new Headers({ Accept: "application/json" });
  headers.set("x-tcos-instacomp-service-token", getInstaCompServiceToken());
  const internalRequest = new NextRequest(new URL("/api/instacomp/scan", request.url), {
    method: "POST",
    headers,
    body: form,
  });
  const response = await runIdentityScan(internalRequest);
  const scan = await response.json().catch(() => null);
  if (!response.ok || !scan?.ok || !scan?.ai) {
    return {
      index: index + 1,
      ...candidate,
      frontImageUrl: frontUrl,
      backImageUrl: backUrl,
      imageRoles: roles,
      scanOk: false,
      error: clean(scan?.error) || `InstaComp scan HTTP ${response.status}`,
      grade: {
        pass: false,
        passed: 0,
        total: 1,
        checks: [{ field: "scan", expected: "recognized", actual: "failed", pass: false }],
        confidence: 0,
      },
    };
  }
  const result = {
    index: index + 1,
    sport: candidate.sport,
    itemId: candidate.itemId,
    legacyItemId: candidate.legacyItemId,
    title: candidate.title,
    url: candidate.url,
    frontImageUrl: frontUrl,
    backImageUrl: backUrl,
    imageRoles: roles,
    expected: candidate.expected,
    ai: scan.ai,
    scanOk: true,
    grade: grade(candidate.expected, scan, roles),
  };
  await cleanupScan(scan.scanId);
  return result;
}

export async function POST(request: NextRequest) {
  if (!(await verifyVercelToken(request))) {
    return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const pools = await Promise.all(SEARCHES.map((entry) => searchEbay(entry.sport, entry.query)));
    const selected = select25(pools.flat());
    const results: any[] = new Array(selected.length);
    let cursor = 0;
    async function worker() {
      while (cursor < selected.length) {
        const index = cursor++;
        const candidate = selected[index];
        try {
          results[index] = await runOne(candidate, request, index);
        } catch (error) {
          results[index] = {
            index: index + 1,
            sport: candidate.sport,
            itemId: candidate.itemId,
            title: candidate.title,
            url: candidate.url,
            expected: candidate.expected,
            scanOk: false,
            error: error instanceof Error ? error.message : String(error),
            grade: {
              pass: false,
              passed: 0,
              total: 1,
              checks: [{ field: "execution", expected: "completed", actual: "failed", pass: false }],
              confidence: 0,
            },
          };
        }
      }
    }
    await Promise.all([worker(), worker(), worker()]);
    const cardsPassed = results.filter((row) => row.grade?.pass).length;
    const fieldTotal = results.reduce((sum, row) => sum + Number(row.grade?.total || 0), 0);
    const fieldPassed = results.reduce((sum, row) => sum + Number(row.grade?.passed || 0), 0);
    const summary = {
      selectedListings: results.length,
      sports: Object.fromEntries(Object.keys(SPORT_QUOTAS).map((sport) => [sport, results.filter((row) => phraseMatch(row.expected?.sport, sport) || row.sport === sport).length])),
      autographCards: results.filter((row) => row.expected?.isAuto === true).length,
      memorabiliaCards: results.filter((row) => row.expected?.isRelic === true).length,
      serialNumberedCards: results.filter((row) => row.expected?.serialRun).length,
      parallelCards: results.filter((row) => row.expected?.parallel).length,
      rookieCards: results.filter((row) => row.expected?.isRookie === true).length,
      frontBackVerified: results.filter((row) => row.imageRoles?.method === "openai" && Number(row.imageRoles?.confidence) >= 0.7).length,
      cardsPassed,
      cardsFailed: results.length - cardsPassed,
      cardAccuracyPercent: Number(((cardsPassed / Math.max(1, results.length)) * 100).toFixed(1)),
      fieldChecksPassed: fieldPassed,
      fieldChecksTotal: fieldTotal,
      fieldAccuracyPercent: fieldTotal ? Number(((fieldPassed / fieldTotal) * 100).toFixed(1)) : 0,
      perfect: results.length === 25 && cardsPassed === 25,
    };
    return Response.json({
      success: true,
      schema: "truelycollectables.instacomp.25-card-recognition-stress.v1",
      completedAt: new Date().toISOString(),
      summary,
      failures: results.filter((row) => !row.grade?.pass).map((row) => ({
        index: row.index,
        title: row.title,
        url: row.url,
        error: row.error || null,
        failedChecks: (row.grade?.checks || []).filter((check: any) => !check.pass),
      })),
      results,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
