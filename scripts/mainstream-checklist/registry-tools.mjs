import { createClient } from "@supabase/supabase-js";

import { buildChecklistIdentityFingerprint } from "../../src/lib/checklist-registry/identity.ts";
import {
  buildChecklistSourceStorageReceipt,
  CHECKLIST_SOURCE_BUCKET,
} from "../../src/lib/checklist-registry/storage.ts";
import { normalized, sha256, slug } from "./source-tools.mjs";

export const ARCHIVE_BUCKET = "tcos-checklist-universal-archive";
const ARCHIVE_PREFIX = "backlog/mainstream-2000-plus";
const MAX_SOURCE_BYTES = 50 * 1024 * 1024;

export function dbClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Mainstream checklist ingestion requires Supabase service-role access.");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function inferSetType(name) {
  const value = normalized(name).toLowerCase();
  if (!value || /^(base|base set|base cards)$/.test(value)) return "base";
  if (/autograph|signature|signed/.test(value)) return "autograph";
  if (/relic|memorabilia|patch|swatch|jersey/.test(value)) return "memorabilia";
  if (/insert|subset|rookie|prospect|variation|short print|sp\b/.test(value)) return "insert";
  return "other";
}

function effectiveAuthority(entry, source) {
  if (entry.authority !== "official_manufacturer") return entry.authority;
  const selected = String(source.selectedUrl || source.finalUrl || entry.sourceUrl);
  const hostname = new URL(selected).hostname.toLowerCase();
  if (
    hostname.endsWith("topps.com") ||
    hostname.endsWith("upperdeck.com") ||
    hostname.endsWith("cdn.shopify.com")
  ) {
    return "official_manufacturer";
  }
  return "approved_reference_dataset";
}

export function buildPlan(entry, parsed, source, retrievedAt) {
  const release = entry.release;
  const authority = effectiveAuthority(entry, source);
  const evidenceUrl = String(source.selectedUrl || source.finalUrl || entry.sourceUrl);
  const releaseSlug = slug(
    `${release.season || release.releaseYear}-${release.manufacturer}-${release.product}-${release.sport}`,
  );
  const storage = buildChecklistSourceStorageReceipt({
    manufacturerSlug: release.manufacturer,
    releaseSlug,
    originalFilename: source.filename,
    mimeType: source.mimeType,
    content: source.bytes,
  });

  const setNames = [...new Set(parsed.cards.map((card) => card.setName))];
  const sets = setNames.map((name, index) => ({
    sourceKey: `set-${index + 1}-${slug(name)}`,
    name,
    normalizedName: normalized(name).toLowerCase(),
    setType: inferSetType(name),
  }));
  const setByName = new Map(sets.map((set) => [set.name, set]));
  const cards = parsed.cards.map((card, index) => ({
    sourceKey: `card-${index + 1}-${slug(card.setName)}-${slug(card.cardNumber)}`,
    setSourceKey: setByName.get(card.setName).sourceKey,
    cardNumber: card.cardNumber,
    players: card.players,
    teams: card.teams,
    rookieDesignation: card.rookieDesignation,
    firstBowmanDesignation: card.firstBowmanDesignation,
    autographStatus: card.autographStatus,
    memorabiliaStatus: card.memorabiliaStatus,
    variation: card.variation,
    sourceNotes: card.sourceNotes,
  }));

  const cardBySet = new Map();
  for (const card of cards) {
    const list = cardBySet.get(card.setSourceKey) || [];
    list.push(card);
    cardBySet.set(card.setSourceKey, list);
  }

  const parallelRows = parsed.parallels
    .map((parallel, index) => {
      const set =
        setByName.get(parallel.setName) ||
        sets.find((value) => value.setType === "base") ||
        sets[0];
      if (!set) return null;
      return {
        sourceKey: `parallel-${index + 1}-${slug(set.name)}-${slug(parallel.name)}`,
        setSourceKey: set.sourceKey,
        name: parallel.name,
        serialRun: parallel.serialRun,
        configurationExclusivity: parallel.configurationExclusivity,
        appliesToAllCards: Boolean(parallel.appliesToAllCards),
      };
    })
    .filter(Boolean);

  const identities = [];
  for (const card of cards) {
    const set = sets.find((value) => value.sourceKey === card.setSourceKey);
    identities.push({
      cardSourceKey: card.sourceKey,
      parallelSourceKey: null,
      fingerprint: buildChecklistIdentityFingerprint({
        releaseYear: release.releaseYear,
        season: release.season,
        manufacturer: release.manufacturer,
        brand: release.brand,
        product: release.product,
        sport: release.sport,
        league: release.league,
        setName: set.name,
        cardNumber: card.cardNumber,
        players: card.players,
        teams: card.teams,
        parallel: null,
        variation: card.variation,
        serialRun: null,
        autographStatus: card.autographStatus,
        memorabiliaStatus: card.memorabiliaStatus,
        configurationExclusivity: null,
      }),
    });
  }

  for (const parallel of parallelRows) {
    if (!parallel.appliesToAllCards) continue;
    for (const card of cardBySet.get(parallel.setSourceKey) || []) {
      const set = sets.find((value) => value.sourceKey === card.setSourceKey);
      identities.push({
        cardSourceKey: card.sourceKey,
        parallelSourceKey: parallel.sourceKey,
        fingerprint: buildChecklistIdentityFingerprint({
          releaseYear: release.releaseYear,
          season: release.season,
          manufacturer: release.manufacturer,
          brand: release.brand,
          product: release.product,
          sport: release.sport,
          league: release.league,
          setName: set.name,
          cardNumber: card.cardNumber,
          players: card.players,
          teams: card.teams,
          parallel: parallel.name,
          variation: card.variation,
          serialRun: parallel.serialRun,
          autographStatus: card.autographStatus,
          memorabiliaStatus: card.memorabiliaStatus,
          configurationExclusivity: parallel.configurationExclusivity,
        }),
      });
    }
  }

  const issues = [...parsed.warnings, ...parsed.errors];
  const errors = issues.filter((issue) => issue.severity === "error");
  return {
    schema: "tcos.checklist.importPlan.v1",
    adapterId: "mainstream-reference-checklist-v1",
    adapterVersion: "1.0.0",
    source: {
      sourceUrl: evidenceUrl,
      retrievedAt,
      authority,
      redistributionAllowed: Boolean(entry.redistributionAllowed),
      privateArchiveRequired: true,
      normalizedFactsInternalOnly: true,
      storage,
    },
    release: {
      manufacturer: release.manufacturer,
      brand: release.brand,
      product: release.product,
      releaseYear: release.releaseYear,
      season: release.season,
      sport: release.sport,
      league: release.league,
      releaseSlug,
    },
    sets,
    cards,
    parallels: parallelRows.map(({ appliesToAllCards, ...parallel }) => parallel),
    identities,
    validation: {
      status: errors.length ? "validation_required" : "passed",
      issues,
      counts: {
        sets: sets.length,
        cards: cards.length,
        parallels: parallelRows.length,
        identities: identities.length,
      },
    },
  };
}

export function assertPlanComplexity(plan) {
  const counts = plan.validation.counts;
  const serializedBytes = Buffer.byteLength(JSON.stringify(plan), "utf8");
  const violations = [];
  if (counts.sets > 10_000) violations.push(`sets ${counts.sets}/10000`);
  if (counts.cards > 100_000) violations.push(`cards ${counts.cards}/100000`);
  if (counts.parallels > 50_000) violations.push(`parallels ${counts.parallels}/50000`);
  if (counts.identities > 250_000) violations.push(`identities ${counts.identities}/250000`);
  if (plan.validation.issues.length > 20_000) violations.push("too many validation issues");
  if (serializedBytes > 64 * 1024 * 1024) violations.push("plan exceeds 64 MiB");
  if (violations.length) {
    throw new Error(`Checklist import complexity limit exceeded: ${violations.join(", ")}.`);
  }
  return { serializedBytes };
}

export async function ensureArchiveBucket(db) {
  const options = {
    public: false,
    fileSizeLimit: MAX_SOURCE_BYTES,
    allowedMimeTypes: [
      "text/html",
      "application/xhtml+xml",
      "application/pdf",
      "text/plain",
      "text/csv",
      "text/tab-separated-values",
      "application/json",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/octet-stream",
    ],
  };
  const existing = await db.storage.getBucket(ARCHIVE_BUCKET);
  if (existing.error || !existing.data) {
    const created = await db.storage.createBucket(ARCHIVE_BUCKET, options);
    if (created.error && !/already exists|duplicate|409/i.test(created.error.message || "")) {
      throw new Error(`Could not create archive bucket: ${created.error.message}`);
    }
  } else if (existing.data.public) {
    throw new Error(`${ARCHIVE_BUCKET} exists but is public.`);
  }
}

export async function uploadArchive(db, source) {
  const digest = sha256(source.bytes);
  const objectPath = `${ARCHIVE_PREFIX}/blobs/${digest.slice(0, 2)}/${digest}-${source.filename}`;
  const uploaded = await db.storage.from(ARCHIVE_BUCKET).upload(objectPath, source.bytes, {
    contentType: source.mimeType,
    cacheControl: "0",
    upsert: false,
  });
  if (uploaded.error && !/already exists|duplicate|409/i.test(uploaded.error.message || "")) {
    throw new Error(`Could not archive source: ${uploaded.error.message}`);
  }
  return { digest, objectPath, bytes: source.bytes.byteLength };
}

async function uploadRegistrySource(db, plan, bytes) {
  const storage = plan.source.storage;
  const uploaded = await db.storage.from(CHECKLIST_SOURCE_BUCKET).upload(storage.objectPath, bytes, {
    contentType: storage.mimeType,
    cacheControl: "0",
    upsert: false,
  });
  if (uploaded.error && !/already exists|duplicate|409/i.test(uploaded.error.message || "")) {
    throw new Error(`Could not archive validated Registry source: ${uploaded.error.message}`);
  }
}

export function limitedIssues(values) {
  return values.slice(0, 100).map((issue) => ({
    code: issue.code,
    severity: issue.severity,
    message: String(issue.message || "").slice(0, 500),
  }));
}

export async function upsertCatalog(db, values) {
  const { error } = await db
    .from("checklist_source_catalog")
    .upsert(values, { onConflict: "source_url" });
  if (error) throw new Error(`Could not update checklist source catalog: ${error.message}`);
}

export async function persistPlan(db, plan, bytes) {
  await uploadRegistrySource(db, plan, bytes);
  const storage = plan.source.storage;
  const { data, error } = await db.rpc("tcos_apply_checklist_import_plan", {
    p_plan: plan,
    p_original_filename: storage.originalFilename,
    p_mime_type: storage.mimeType,
    p_size_bytes: storage.sizeBytes,
    p_sha256: storage.sha256,
    p_storage_bucket: storage.bucket,
    p_storage_object_path: storage.objectPath,
  });
  if (error) throw new Error(`Checklist Registry transaction failed: ${error.message}`);
  return data;
}
