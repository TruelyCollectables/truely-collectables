import fs from "node:fs";

const pairsPath = process.env.PAIRS_PATH;
const reportPath = process.env.REPORT_PATH;
const origin = String(process.env.INSTACOMP_AUDIT_ORIGIN || "https://truelycollectables.com").replace(/\/+$/, "");
const serviceToken = String(process.env.INSTACOMP_ACCEPTANCE_SERVICE_TOKEN || "").trim();

if (!pairsPath || !reportPath) throw new Error("PAIRS_PATH and REPORT_PATH are required.");
if (!serviceToken) throw new Error("INSTACOMP_ACCEPTANCE_SERVICE_TOKEN is required.");

const pairs = JSON.parse(fs.readFileSync(pairsPath, "utf8"));
if (!Array.isArray(pairs) || pairs.length !== 25) throw new Error(`Expected 25 pairs; received ${Array.isArray(pairs) ? pairs.length : 0}.`);

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const norm = (value) => clean(value)
  .normalize("NFKD")
  .replace(/[’']/g, "")
  .toLowerCase()
  .replace(/&/g, " and ")
  .replace(/[^a-z0-9/]+/g, " ")
  .replace(/\s+/g, " ")
  .trim();
const compact = (value) => norm(value).replace(/[^a-z0-9]/g, "");
const record = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const tokenSet = (value) => norm(value).split(" ").filter(Boolean).sort().join(" ");

function textEquivalent(actual, expected) {
  const a = norm(actual);
  const b = norm(expected);
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.includes(b) || b.includes(a)) return true;
  return tokenSet(a) === tokenSet(b);
}

function playerEquivalent(actual, expected) {
  const a = norm(actual);
  const b = norm(expected);
  if (a === b) return true;
  const expectedPlayers = clean(expected).split("/").map(norm).filter(Boolean);
  return expectedPlayers.length > 1 && expectedPlayers.every((player) => a.includes(player));
}

function canonicalParallel(value) {
  const normalized = norm(value);
  if (!normalized || ["base", "base card", "none", "null", "standard", "regular"].includes(normalized)) return "base";
  return tokenSet(normalized.replace(/\bprizms?\b/g, "").trim());
}

function serialDenominator(value) {
  const match = clean(value).match(/\b\d{1,5}\s*\/\s*(\d{1,6})\b/);
  return match ? Number(match[1]) : null;
}

async function downloadImage(url, side) {
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(45_000),
    headers: { "User-Agent": "TCOS-InstaComp-25-Live-Mixed-Audit/1.0" },
  });
  if (!response.ok) throw new Error(`${side} image HTTP ${response.status}`);
  const contentType = (response.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 500) throw new Error(`${side} image was too small (${bytes.length} bytes).`);
  if (bytes.length > 12 * 1024 * 1024) throw new Error(`${side} image exceeded 12 MB.`);
  return new File([bytes], `${side}.jpg`, { type: contentType });
}

async function scan(front, back) {
  const form = new FormData();
  form.append("frontImage", front, front.name);
  form.append("backImage", back, back.name);
  form.append("aiCouncilTier", "basic");
  const response = await fetch(`${origin}/api/instacomp/scan`, {
    method: "POST",
    body: form,
    redirect: "error",
    signal: AbortSignal.timeout(295_000),
    headers: {
      "x-tcos-instacomp-service-token": serviceToken,
      "User-Agent": "TCOS-InstaComp-25-Live-Mixed-Audit/1.0",
    },
  });
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; }
  catch { payload = { error: `Non-JSON response: ${text.slice(0, 500)}` }; }
  return { httpOk: response.ok, httpStatus: response.status, payload };
}

function grade(row, scanResult) {
  const expected = row.expected || {};
  const payload = record(scanResult.payload);
  const ai = record(payload.ai);
  const registry = record(payload.checklistRegistry);
  const decision = record(payload.identityDecision);

  let confidence = Number(decision.confidence ?? registry.identityConfidence ?? NaN);
  if (Number.isFinite(confidence) && confidence > 1) confidence /= 100;

  const actual = {
    player: clean(ai.player),
    year: clean(ai.year),
    brand: clean(ai.manufacturer || ai.brand),
    setName: clean(ai.setName || ai.set_name),
    cardNumber: clean(ai.cardNumber || ai.card_number),
    parallel: clean(ai.parallel) || "Base",
    serialNumber: clean(ai.serialNumber || ai.serial_number),
    team: clean(ai.team),
    sport: clean(ai.sport),
    isRookie: (ai.isRookie ?? ai.is_rookie) === true,
    isAuto: (ai.isAuto ?? ai.is_auto) === true,
    isRelic: (ai.isRelic ?? ai.is_relic) === true,
    confidence: Number.isFinite(confidence) ? confidence : null,
    registryMatched: registry.matched === true,
    identityConfirmed: decision.confirmed === true || registry.identityConfirmed === true,
    registryIdentityId: clean(registry.identityId) || null,
  };

  const fields = [];
  const add = (field, weight, pass, note) => fields.push({ field, weight, pass: Boolean(pass), earned: pass ? weight : 0, note });
  add("player", 15, playerEquivalent(actual.player, expected.player), `${actual.player || "missing"} vs ${expected.player}`);
  add("year", 10, norm(actual.year) === norm(expected.year), `${actual.year || "missing"} vs ${expected.year}`);
  add("brand", 8, textEquivalent(actual.brand, expected.brand), `${actual.brand || "missing"} vs ${expected.brand}`);
  add("set", 10, textEquivalent(actual.setName, expected.setName), `${actual.setName || "missing"} vs ${expected.setName}`);
  add("cardNumber", 12, compact(actual.cardNumber) === compact(expected.cardNumber), `${actual.cardNumber || "missing"} vs ${expected.cardNumber}`);
  add("parallel", 10, canonicalParallel(actual.parallel) === canonicalParallel(expected.parallel), `${actual.parallel || "missing"} vs ${expected.parallel}`);

  const expectedDenominator = Number(expected.serialDenominator || 0) || null;
  const actualDenominator = serialDenominator(actual.serialNumber);
  add("serial", 8, expectedDenominator ? actualDenominator === expectedDenominator : !actualDenominator, `${actual.serialNumber || "none"} vs ${expectedDenominator ? `/${expectedDenominator}` : "none"}`);
  add("team", 6, !clean(expected.team) || textEquivalent(actual.team, expected.team), `${actual.team || "missing"} vs ${expected.team || "n/a"}`);
  add("sport", 4, textEquivalent(actual.sport, expected.sport), `${actual.sport || "missing"} vs ${expected.sport}`);
  add("rookie", 5, actual.isRookie === Boolean(expected.isRookie), `${actual.isRookie} vs ${Boolean(expected.isRookie)}`);
  add("auto", 4, actual.isAuto === Boolean(expected.isAuto), `${actual.isAuto} vs ${Boolean(expected.isAuto)}`);
  add("relic", 3, actual.isRelic === Boolean(expected.isRelic), `${actual.isRelic} vs ${Boolean(expected.isRelic)}`);
  add("confidence", 5, (actual.confidence ?? 0) >= 0.95, `${actual.confidence}`);

  const score = fields.reduce((sum, field) => sum + field.earned, 0);
  const critical = fields.filter((field) => ["player", "year", "cardNumber"].includes(field.field) && !field.pass).map((field) => field.field);
  const major = fields.filter((field) => ["parallel", "serial"].includes(field.field) && !field.pass).map((field) => field.field);
  const exactCore = ["player", "year", "brand", "set", "cardNumber", "parallel"].every((name) => fields.find((field) => field.field === name)?.pass)
    && (expectedDenominator ? fields.find((field) => field.field === "serial")?.pass : true);
  const registryLock = actual.registryMatched && actual.identityConfirmed;
  const pass = scanResult.httpOk && payload.ok === true && critical.length === 0 && major.length === 0 && score >= 85 && registryLock;

  return { actual, fields, score, critical, major, exactCore, registryLock, pass };
}

const startedAt = new Date().toISOString();
const results = [];

for (let index = 0; index < pairs.length; index += 1) {
  const row = pairs[index];
  const started = Date.now();
  let scanResult = { httpOk: false, httpStatus: 0, payload: {} };
  let failure = null;
  try {
    const [front, back] = await Promise.all([
      downloadImage(row.listing.frontImageUrl, "front"),
      downloadImage(row.listing.backImageUrl, "back"),
    ]);
    scanResult = await scan(front, back);
  } catch (error) {
    failure = clean(error?.message || error);
  }

  const graded = grade(row, scanResult);
  const result = {
    number: index + 1,
    caseId: row.caseId,
    listing: row.listing,
    expected: row.expected,
    http: { ok: scanResult.httpOk, status: scanResult.httpStatus },
    routeOk: scanResult.payload?.ok === true,
    failure: failure || clean(scanResult.payload?.error) || null,
    ...graded,
    durationMs: Date.now() - started,
  };
  results.push(result);
  console.log(`CARD ${index + 1}/25 ${graded.pass ? "PASS" : "FAIL"} score=${graded.score} core=${graded.exactCore} registry=${graded.registryLock} auto=${graded.actual.isAuto} relic=${graded.actual.isRelic} serial=${graded.actual.serialNumber || "-"} :: ${row.listing.title}`);
  fs.writeFileSync(reportPath, JSON.stringify({ schema: "tcos.instacomp.direct25LiveMixed.v1", startedAt, updatedAt: new Date().toISOString(), results }, null, 2));
}

const total = results.length;
const passed = results.filter((result) => result.pass).length;
const exactCore = results.filter((result) => result.exactCore).length;
const registryLocked = results.filter((result) => result.registryLock).length;
const httpRouteOk = results.filter((result) => result.http.ok && result.routeOk).length;
const averageScore = total ? Number((results.reduce((sum, result) => sum + result.score, 0) / total).toFixed(1)) : 0;
const serialRows = results.filter((result) => Number(result.expected?.serialDenominator) > 0);
const rookieRows = results.filter((result) => result.expected?.isRookie === true);
const parallelRows = results.filter((result) => canonicalParallel(result.expected?.parallel) !== "base");
const autoRows = results.filter((result) => result.expected?.isAuto === true);
const relicRows = results.filter((result) => result.expected?.isRelic === true);
const sports = {};
for (const result of results) sports[result.expected.sport] = (sports[result.expected.sport] || 0) + 1;

const fieldAccuracy = {};
for (const fieldName of ["player", "year", "brand", "set", "cardNumber", "parallel", "serial", "team", "sport", "rookie", "auto", "relic", "confidence"]) {
  const checks = results.map((result) => result.fields.find((field) => field.field === fieldName)).filter(Boolean);
  fieldAccuracy[fieldName] = {
    tested: checks.length,
    correct: checks.filter((check) => check.pass).length,
    rate: checks.length ? Number((checks.filter((check) => check.pass).length / checks.length * 100).toFixed(1)) : 0,
  };
}

const summary = {
  requested: 25,
  completed: total,
  httpRouteOk,
  passed,
  passRate: total ? Number((passed / total * 100).toFixed(1)) : 0,
  exactCore,
  exactCoreRate: total ? Number((exactCore / total * 100).toFixed(1)) : 0,
  registryLocked,
  registryRate: total ? Number((registryLocked / total * 100).toFixed(1)) : 0,
  averageScore,
  sports,
  serialNumbered: { tested: serialRows.length, correct: serialRows.filter((result) => result.fields.find((field) => field.field === "serial")?.pass).length },
  rookies: { tested: rookieRows.length, correct: rookieRows.filter((result) => result.fields.find((field) => field.field === "rookie")?.pass).length },
  nonBaseParallels: { tested: parallelRows.length, correct: parallelRows.filter((result) => result.fields.find((field) => field.field === "parallel")?.pass).length },
  positiveAutos: { tested: autoRows.length, correct: autoRows.filter((result) => result.fields.find((field) => field.field === "auto")?.pass).length },
  positiveRelics: { tested: relicRows.length, correct: relicRows.filter((result) => result.fields.find((field) => field.field === "relic")?.pass).length },
  criticalErrors: results.reduce((sum, result) => sum + result.critical.length, 0),
  majorErrors: results.reduce((sum, result) => sum + result.major.length, 0),
  safeRefusals: results.filter((result) => !result.http.ok || !result.routeOk || !result.registryLock).length,
  fieldAccuracy,
};

const finalReport = {
  schema: "tcos.instacomp.direct25LiveMixed.v1",
  startedAt,
  completedAt: new Date().toISOString(),
  summary,
  grading: "100 points: player15 year10 brand8 set10 card#12 parallel10 serial8 team6 sport4 rookie5 auto4 relic3 confidence5. PASS requires no critical player/year/card# mismatch, no major parallel/serial mismatch, score >=85, route success, and Registry lock.",
  results,
};

fs.writeFileSync(reportPath, JSON.stringify(finalReport, null, 2));
console.log(`INSTACOMP_DIRECT_25_SUMMARY=${JSON.stringify(summary)}`);
if (total !== 25) throw new Error(`Incomplete audit: ${total}/25.`);
