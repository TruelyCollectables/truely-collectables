import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  ARCHIVE_BUCKET,
  assertPlanComplexity,
  buildPlan,
  dbClient,
  ensureArchiveBucket,
  limitedIssues,
  persistPlan,
  uploadArchive,
  upsertCatalog,
} from "./mainstream-checklist/registry-tools.mjs";
import { normalized } from "./mainstream-checklist/source-tools.mjs";

const OUTPUT = resolve(
  process.cwd(),
  process.env.HOCKEY_2021PLUS_OUTPUT || ".checklist-discovery/hockey-2021plus-priority-receipt.json",
);

const TARGETS = [
  {
    id: "hockey-2021-22-upper-deck-sp-authentic-official",
    sourceName: "Upper Deck",
    sourceUrl: "https://upperdeck.com/checklist/2021-22-sp-authentic-checklist/",
    authority: "official_manufacturer",
    redistributionAllowed: false,
    disposition: "promote",
    minimumCardRows: 200,
    release: {
      exactSetKey: "hockey|2021-22|upper-deck|sp-authentic",
      canonicalName: "2021-22 Upper Deck SP Authentic Hockey",
      manufacturer: "Upper Deck",
      brand: "SP Authentic",
      product: "SP Authentic",
      releaseYear: 2021,
      season: "2021-22",
      sport: "hockey",
      league: "NHL",
    },
    proofCards: [
      { cardNumber: "136", subject: "Tanner Laczynski" },
      { cardNumber: "184", subject: "Benoit-Olivier Groulx" },
      { cardNumber: "188", subject: "Cole Sillinger" },
      { cardNumber: "TR-12", subject: "Alex Newhook" },
    ],
  },
  {
    id: "hockey-2024-25-upper-deck-artifacts-official",
    sourceName: "Upper Deck",
    sourceUrl: "https://upperdeck.com/checklist/2024-25-artifacts-checklist/",
    authority: "official_manufacturer",
    redistributionAllowed: false,
    disposition: "promote",
    minimumCardRows: 100,
    release: {
      exactSetKey: "hockey|2024-25|upper-deck|artifacts",
      canonicalName: "2024-25 Upper Deck Artifacts Hockey",
      manufacturer: "Upper Deck",
      brand: "Upper Deck",
      product: "Artifacts",
      releaseYear: 2024,
      season: "2024-25",
      sport: "hockey",
      league: "NHL",
    },
    proofCards: [{ cardNumber: "1", subject: "Quinton Byfield" }],
  },
  {
    id: "hockey-2025-26-upper-deck-star-rookies-box-set-official",
    sourceName: "Upper Deck",
    sourceUrl: "https://upperdeck.com/checklist/2025-2026-nhl-star-rookies-box-set-checklist/",
    authority: "official_manufacturer",
    redistributionAllowed: false,
    disposition: "promote",
    minimumCardRows: 20,
    release: {
      exactSetKey: "hockey|2025-26|upper-deck|star-rookies-box-set",
      canonicalName: "2025-26 Upper Deck Star Rookies Box Set Hockey",
      manufacturer: "Upper Deck",
      brand: "Upper Deck",
      product: "Star Rookies Box Set",
      releaseYear: 2025,
      season: "2025-26",
      sport: "hockey",
      league: "NHL",
    },
    proofCards: [{ cardNumber: "1", subject: "Ivan Demidov" }],
  },
];

const TRANSIENT = /timeout|timed out|too many connections|connection|fetch failed|520|502|503|504|gateway|cloudflare|socket|network|econn|undici/i;

function writeReceipt(receipt) {
  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(receipt, null, 2));
}

function decodeEntities(value) {
  const named = {
    amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"',
    ndash: "-", mdash: "-", rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"',
    hellip: "…", trade: "™", reg: "®",
  };
  return String(value || "").replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, entity) => {
    if (/^#x/i.test(entity)) {
      const code = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    if (entity.startsWith("#")) {
      const code = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return named[entity.toLowerCase()] ?? whole;
  });
}

function cellText(value) {
  return normalized(
    decodeEntities(
      String(value || "")
        .replace(/<br\s*\/?>/gi, " ")
        .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
        .replace(/<[^>]+>/g, " "),
    ),
  );
}

function isCardNumber(value) {
  const card = normalized(value).replace(/^#\s*/, "");
  if (!card || card.length > 28) return false;
  return /^\d{1,4}[A-Za-z]?$/.test(card) ||
    (/^[A-Z]{1,12}-?[A-Z0-9]{1,18}$/i.test(card) && /\d/.test(card)) ||
    /^(?:NNO|NO#|NO NUMBER)$/i.test(card);
}

function multiSubjectSet(name) {
  return /\b(?:dual|triple|quad|quartet|quint|sextet|octet|multi|combo|book|booklet|ensemble)\b/i.test(name) &&
    /\b(?:autograph|signature|relic|memorabilia|patch|swatch|jersey|book|booklet)\b/i.test(name);
}

function parseUpperDeckHtml(html, target) {
  const parsed = [];
  const errors = [];
  const warnings = [];
  for (const match of String(html).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...match[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((item) => cellText(item[1]));
    if (cells.length < 3) continue;
    const setName = normalized(cells[0]);
    const cardNumber = normalized(cells[1]).replace(/^#\s*/, "");
    const subject = normalized(cells[2]);
    if (!setName || /^set name$/i.test(setName) || !isCardNumber(cardNumber) || !subject || /^description$/i.test(subject)) continue;
    if (setName.length > 160 || subject.length > 220) continue;
    const city = normalized(cells[3] || "");
    const teamName = normalized(cells[4] || "");
    const team = normalized([city, teamName].filter(Boolean).join(" "));
    const tail = cells.slice(5).join(" ");
    parsed.push({
      setName,
      cardNumber,
      players: [subject],
      teams: team ? [team] : [],
      rookieDesignation: /\brookie\b/i.test(tail),
      firstBowmanDesignation: false,
      autographStatus: /\bauto\b|autograph/i.test(tail) || /autograph|signature/i.test(setName) ? "autograph" : "non-auto",
      memorabiliaStatus: /\b(?:mem|mem\/tech|jsy|jersey|patch|relic|swatch)\b/i.test(tail) || /memorabilia|patch|relic|jersey|swatch/i.test(setName) ? "memorabilia" : "non-memorabilia",
      variation: null,
      sourceNotes: `Official Upper Deck table: ${setName}`,
    });
  }

  const deduped = [];
  const byKey = new Map();
  for (const card of parsed) {
    const key = `${card.setName.toLowerCase()}::${card.cardNumber.toLowerCase()}`;
    const prior = byKey.get(key);
    if (!prior) {
      byKey.set(key, card);
      deduped.push(card);
      continue;
    }
    const priorSubject = prior.players.map((v) => v.toLowerCase()).sort().join("+");
    const nextSubject = card.players.map((v) => v.toLowerCase()).sort().join("+");
    if (priorSubject === nextSubject) continue;
    if (multiSubjectSet(card.setName)) {
      prior.players = [...new Set([...prior.players, ...card.players])];
      prior.teams = [...new Set([...prior.teams, ...card.teams])];
      prior.rookieDesignation ||= card.rookieDesignation;
      if (card.autographStatus === "autograph") prior.autographStatus = "autograph";
      if (card.memorabiliaStatus === "memorabilia") prior.memorabiliaStatus = "memorabilia";
      prior.sourceNotes += "; source-proven multi-subject row";
      continue;
    }
    errors.push({
      code: "upperdeck_card_number_subject_conflict",
      severity: "error",
      message: `${card.setName} #${card.cardNumber} maps to both ${prior.players.join(" / ")} and ${card.players.join(" / ")}.`,
    });
  }

  if (deduped.length < target.minimumCardRows) {
    errors.push({
      code: "upperdeck_checklist_insufficient_rows",
      severity: "error",
      message: `${target.release.canonicalName} parsed ${deduped.length} rows; minimum is ${target.minimumCardRows}.`,
    });
  }
  const setNames = new Set(deduped.map((card) => card.setName));
  if (!setNames.size) {
    errors.push({ code: "upperdeck_no_sets", severity: "error", message: "No deterministic Upper Deck checklist sets were parsed." });
  }
  return { cards: deduped, parallels: [], warnings, errors };
}

async function retry(label, operation, attempts = 5) {
  let last;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      last = error;
      const message = error instanceof Error ? error.message : String(error);
      if (!TRANSIENT.test(message) || attempt === attempts) throw error;
      const delay = Math.min(20_000, 2_000 * attempt * attempt);
      console.warn(`${label} transient failure ${attempt}/${attempts}: ${message}; retrying in ${delay}ms`);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, delay));
    }
  }
  throw last;
}

async function fetchSource(target) {
  return retry(`download ${target.release.exactSetKey}`, async () => {
    const response = await fetch(target.sourceUrl, {
      redirect: "follow",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Cache-Control": "no-cache",
        "User-Agent": "TCOS-Checklist-Registry/1.0 (+official manufacturer ingestion)",
      },
      signal: AbortSignal.timeout(90_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.byteLength) throw new Error("Upper Deck returned an empty checklist page.");
    return {
      bytes,
      mimeType: "text/html",
      filename: `${target.release.season}-${target.release.product.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.html`,
      selectedUrl: target.sourceUrl,
      finalUrl: response.url || target.sourceUrl,
    };
  });
}

function assertProofCards(target, parsed) {
  const failures = [];
  for (const expected of target.proofCards || []) {
    const rows = parsed.cards.filter((card) => card.cardNumber.toLowerCase() === expected.cardNumber.toLowerCase());
    if (!rows.some((card) => card.players.some((player) => player.toLowerCase().includes(expected.subject.toLowerCase())))) {
      failures.push(`${expected.cardNumber} ${expected.subject}`);
    }
  }
  if (failures.length) throw new Error(`Official checklist proof rows missing: ${failures.join(", ")}`);
}

async function verifyVersion(db, target, plan, persistence) {
  const versionId = persistence?.versionId || persistence?.version_id;
  if (!versionId) throw new Error(`Registry writer did not return a version id for ${target.release.exactSetKey}.`);
  const expected = plan.cards.length;
  const { count, error: countError } = await db
    .from("checklist_cards")
    .select("id", { count: "exact", head: true })
    .eq("version_id", versionId);
  if (countError) throw new Error(`Could not verify card count: ${countError.message}`);
  if (Number(count) !== expected) throw new Error(`Production card count mismatch for ${target.release.exactSetKey}: expected ${expected}, found ${count}.`);

  const proofNumbers = [...new Set((target.proofCards || []).map((item) => item.cardNumber))];
  const { data: proofRows, error: proofError } = await db
    .from("checklist_cards")
    .select("card_number,players,set_id")
    .eq("version_id", versionId)
    .in("card_number", proofNumbers);
  if (proofError) throw new Error(`Could not verify proof cards: ${proofError.message}`);
  for (const expectedProof of target.proofCards || []) {
    const ok = (proofRows || []).some((row) =>
      String(row.card_number).toLowerCase() === expectedProof.cardNumber.toLowerCase() &&
      (row.players || []).some((player) => String(player).toLowerCase().includes(expectedProof.subject.toLowerCase()))
    );
    if (!ok) throw new Error(`Production proof card missing after import: ${expectedProof.cardNumber} ${expectedProof.subject}`);
  }
  return { ok: true, versionId, cards: Number(count), proofCards: target.proofCards.length };
}

async function processTarget(db, target) {
  const checkedAt = new Date().toISOString();
  const source = await fetchSource(target);
  const html = Buffer.from(source.bytes).toString("utf8");
  const parsed = parseUpperDeckHtml(html, target);
  assertProofCards(target, parsed);
  if (parsed.errors.length) throw new Error(`Upper Deck validation failed: ${parsed.errors.map((e) => e.message).slice(0, 4).join(" | ")}`);
  const archive = await retry(`archive ${target.release.exactSetKey}`, () => uploadArchive(db, source));
  const plan = buildPlan(target, parsed, source, checkedAt);
  // This parser understands Upper Deck's Set Name | Card | Description table explicitly.
  // Bump the parser version so a prior generic parse of the same official source cannot
  // incorrectly short-circuit this corrected version as idempotent.
  plan.adapterId = "upperdeck-official-table-v1";
  plan.adapterVersion = "1.0.0";
  assertPlanComplexity(plan);
  if (plan.validation.status !== "passed") {
    throw new Error(`Registry plan validation failed: ${limitedIssues(plan.validation.issues).map((e) => e.message).join(" | ")}`);
  }
  const persistence = await retry(`persist ${target.release.exactSetKey}`, () => persistPlan(db, plan, source.bytes), 4);
  const verification = await retry(`verify ${target.release.exactSetKey}`, () => verifyVersion(db, target, plan, persistence), 4);
  await retry(`catalog ${target.release.exactSetKey}`, () => upsertCatalog(db, {
    manufacturer: target.release.manufacturer,
    sport: target.release.sport,
    source_url: target.sourceUrl,
    source_sha256: archive.digest,
    release_slug: plan.release.releaseSlug,
    release_name: target.release.canonicalName,
    adapter_id: plan.adapterId,
    adapter_version: plan.adapterVersion,
    status: persistence?.idempotent ? "unchanged" : "imported",
    imported_at: checkedAt,
    last_seen_at: checkedAt,
    last_checked_at: checkedAt,
    validation_counts: plan.validation.counts,
    issue_summary: limitedIssues(plan.validation.issues),
    metadata: {
      exactSetKey: target.release.exactSetKey,
      rawArchived: true,
      archiveBucket: ARCHIVE_BUCKET,
      archiveObjectPath: archive.objectPath,
      officialUpperDeckTable: true,
      productionVerified: true,
      verifiedVersionId: verification.versionId,
    },
  }));
  return {
    exactSetKey: target.release.exactSetKey,
    status: "verified_persisted",
    counts: plan.validation.counts,
    persistence,
    verification,
  };
}

async function main() {
  const db = dbClient();
  await retry("archive bucket", () => ensureArchiveBucket(db));
  const startedAt = new Date().toISOString();
  const results = [];
  for (const target of TARGETS) {
    try {
      const result = await processTarget(db, target);
      results.push(result);
      console.log(`VERIFIED ${target.release.exactSetKey}: ${result.verification.cards} Production cards`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ exactSetKey: target.release.exactSetKey, status: "failed", message });
      console.error(`FAILED ${target.release.exactSetKey}: ${message}`);
    }
  }
  const verified = results.filter((result) => result.status === "verified_persisted").length;
  const receipt = {
    schema: "tcos.checklist.hockey2021PlusPriorityProductionReceipt.v1",
    startedAt,
    completedAt: new Date().toISOString(),
    expected: TARGETS.length,
    verified,
    failed: TARGETS.length - verified,
    results,
  };
  writeReceipt(receipt);
  if (verified !== TARGETS.length) process.exitCode = 1;
}

await main();
