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

function transientServiceError(value) {
  const message = String(value?.message || value || '');
  return /schema cache|retrying|fetch failed|network|timeout|timed out|connection|ECONN|ENOTFOUND|\b5\d\d\b|cloudflare|web server is down/i.test(message);
}

async function retryService(label, operation, attempts = 6) {
  let last = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await operation();
      last = result;
      if (!result?.error) return result;
      if (!transientServiceError(result.error) || attempt === attempts) return result;
    } catch (error) {
      last = { error };
      if (!transientServiceError(error) || attempt === attempts) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(8_000, 500 * (2 ** (attempt - 1)))));
  }
  return last;
}

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
    hostname.endsWith("paniniamerica.net") ||
    hostname.endsWith("leaftradingcards.com") ||
    hostname === "cdn.shopify.com" ||
    hostname === "cdn.prod.website-files.com"
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

  const buildIssues = [];
  const dbNormalizedName = (value) => String(value || '')
    .trim().toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9/]+/g, ' ');
  const dbNormalizedCardNumber = (value) => String(value || '')
    .trim().toLowerCase().replace(/[^a-z0-9/]+/g, '');

  // Collapse source labels that normalize to the same Registry set key before persistence.
  const sets = [];
  const setByName = new Map();
  const setByNormalized = new Map();
  for (const name of [...new Set(parsed.cards.map((card) => card.setName))]) {
    const normalizedName = normalized(name).toLowerCase();
    let set = setByNormalized.get(normalizedName);
    if (!set) {
      set = {
        sourceKey: `set-${sets.length + 1}-${slug(name)}`,
        name,
        normalizedName,
        setType: inferSetType(name),
      };
      sets.push(set);
      setByNormalized.set(normalizedName, set);
    } else if (set.name !== name) {
      buildIssues.push({
        code:'reference_duplicate_set_normalized', severity:'warning',
        message:`Collapsed duplicate set label ${name} into ${set.name} because both normalize to ${normalizedName}.`,
      });
    }
    setByName.set(name, set);
  }

  // The Registry intentionally allows only one card per version/set/number/variation.
  // Exact duplicate source rows are harmless; conflicting subjects fail closed as validation.
  const cards = [];
  const cardByRegistryKey = new Map();
  for (const [index, card] of parsed.cards.entries()) {
    const set = setByName.get(card.setName);
    if (!set) continue;
    const row = {
      sourceKey: `card-${index + 1}-${slug(card.setName)}-${slug(card.cardNumber)}`,
      setSourceKey: set.sourceKey,
      cardNumber: card.cardNumber,
      players: card.players,
      teams: card.teams,
      rookieDesignation: card.rookieDesignation,
      firstBowmanDesignation: card.firstBowmanDesignation,
      autographStatus: card.autographStatus,
      memorabiliaStatus: card.memorabiliaStatus,
      variation: card.variation,
      sourceNotes: card.sourceNotes,
      baseIdentity: card.baseIdentity !== false,
    };
    const key = `${row.setSourceKey}::${dbNormalizedCardNumber(row.cardNumber)}::${dbNormalizedName(row.variation || '')}`;
    const prior = cardByRegistryKey.get(key);
    if (!prior) {
      cardByRegistryKey.set(key, row);
      cards.push(row);
      continue;
    }
    const priorSubjects = [...(prior.players || [])].map(v => normalized(v).toLowerCase()).sort().join('|');
    const nextSubjects = [...(row.players || [])].map(v => normalized(v).toLowerCase()).sort().join('|');
    const priorTeams = [...(prior.teams || [])].map(v => normalized(v).toLowerCase()).sort().join('|');
    const nextTeams = [...(row.teams || [])].map(v => normalized(v).toLowerCase()).sort().join('|');
    if (priorSubjects !== nextSubjects || priorTeams !== nextTeams || prior.autographStatus !== row.autographStatus || prior.memorabiliaStatus !== row.memorabiliaStatus) {
      buildIssues.push({
        code:'reference_card_number_subject_conflict', severity:'error',
        message:`${set.name} #${row.cardNumber} maps to conflicting source identities for the same Registry card key.`,
      });
    } else {
      buildIssues.push({
        code:'reference_duplicate_card_row_deduplicated', severity:'warning',
        message:`Deduplicated repeated source row for ${set.name} #${row.cardNumber}.`,
      });
    }
  }

  const cardBySet = new Map();
  for (const card of cards) {
    const list = cardBySet.get(card.setSourceKey) || [];
    list.push(card);
    cardBySet.set(card.setSourceKey, list);
  }

  const mappedParallels = parsed.parallels
    .map((parallel) => {
      const set =
        setByName.get(parallel.setName) ||
        sets.find((value) => value.setType === "base") ||
        sets[0];
      if (!set) return null;
      return {
        setSourceKey: set.sourceKey,
        setName: set.name,
        name: normalized(parallel.name),
        serialRun: parallel.serialRun,
        configurationExclusivity: parallel.configurationExclusivity,
        appliesToAllCards: Boolean(parallel.appliesToAllCards),
        memberKeys: Array.isArray(parallel.memberKeys) ? [...new Set(parallel.memberKeys)] : [],
      };
    })
    .filter(Boolean);

  const parallelRows = [];
  const parallelByRegistryKey = new Map();
  for (const parallel of mappedParallels) {
    const key = `${parallel.setSourceKey}::${normalized(parallel.name).toLowerCase()}::${parallel.serialRun || ""}`;
    const prior = parallelByRegistryKey.get(key);
    if (!prior) {
      const row = {
        ...parallel,
        sourceKey: `parallel-${parallelRows.length + 1}-${slug(parallel.setName)}-${slug(parallel.name)}`,
      };
      parallelByRegistryKey.set(key, row);
      parallelRows.push(row);
      continue;
    }
    const priorConfig = normalized(prior.configurationExclusivity || '').toLowerCase();
    const nextConfig = normalized(parallel.configurationExclusivity || '').toLowerCase();
    if (priorConfig && nextConfig && priorConfig !== nextConfig) {
      buildIssues.push({
        code:'reference_parallel_configuration_conflict',
        severity:'error',
        message:`${parallel.name} on ${parallel.setName} has conflicting configuration evidence: ${prior.configurationExclusivity} vs ${parallel.configurationExclusivity}.`,
      });
    }
    if (!prior.configurationExclusivity && parallel.configurationExclusivity) prior.configurationExclusivity = parallel.configurationExclusivity;
    prior.appliesToAllCards = Boolean(prior.appliesToAllCards || parallel.appliesToAllCards);
    prior.memberKeys = [...new Set([...(prior.memberKeys || []), ...(parallel.memberKeys || [])])];
  }

  const planMemberKey = (card) => {
    const subject = [...(card.players || [])].map((value) => normalized(value).toLowerCase()).sort().join('+');
    return `${normalized(card.cardNumber).toLowerCase()}::${subject}`;
  };
  const identities = [];
  for (const card of cards) {
    if (card.baseIdentity === false) continue;
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
    const setCards = cardBySet.get(parallel.setSourceKey) || [];
    const wanted = new Set(parallel.memberKeys || []);
    const parallelCards = parallel.appliesToAllCards
      ? setCards
      : setCards.filter((card) => wanted.has(planMemberKey(card)));
    if (!parallel.appliesToAllCards && wanted.size > 0 && parallelCards.length !== wanted.size) {
      buildIssues.push({
        code: 'reference_parallel_member_unresolved',
        severity: 'error',
        message: `${parallel.name} on ${sets.find((value) => value.sourceKey === parallel.setSourceKey)?.name || 'unknown set'} resolved ${parallelCards.length}/${wanted.size} source-listed cards.`,
      });
    }
    if (!parallel.appliesToAllCards && wanted.size === 0) {
      buildIssues.push({
        code:'reference_parallel_without_members',
        severity:'warning',
        message:`${parallel.name} on ${sets.find((value) => value.sourceKey === parallel.setSourceKey)?.name || 'unknown set'} has no deterministic card membership.`,
      });
      continue;
    }
    if (parallelCards.length === 0) {
      buildIssues.push({
        code:'reference_parallel_without_members',
        severity:'error',
        message:`${parallel.name} on ${sets.find((value) => value.sourceKey === parallel.setSourceKey)?.name || 'unknown set'} resolved to zero cards.`,
      });
      continue;
    }
    for (const card of parallelCards) {
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

  const identityByFingerprint = new Map();
  for (const identity of identities) {
    const key = `${identity.fingerprint.schema || 'tcos.checklist.identity.v1'}::${identity.fingerprint.fingerprintSha256}`;
    if (!identityByFingerprint.has(key)) identityByFingerprint.set(key, identity);
    else buildIssues.push({
      code:'reference_duplicate_identity_fingerprint_deduplicated', severity:'warning',
      message:`Deduplicated repeated identity fingerprint ${identity.fingerprint.fingerprintSha256}.`,
    });
  }
  const dedupedIdentities = [...identityByFingerprint.values()];
  const issues = [...parsed.warnings, ...parsed.errors, ...buildIssues];
  const errors = issues.filter((issue) => issue.severity === "error");
  return {
    schema: "tcos.checklist.importPlan.v1",
    adapterId: "mainstream-reference-checklist-v1",
    adapterVersion: "1.0.1",
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
    cards: cards.map(({ baseIdentity, ...card }) => card),
    parallels: parallelRows.map(({ appliesToAllCards, memberKeys, ...parallel }) => parallel),
    identities: dedupedIdentities,
    validation: {
      status: errors.length ? "validation_required" : "passed",
      issues,
      counts: {
        sets: sets.length,
        cards: cards.length,
        parallels: parallelRows.length,
        identities: dedupedIdentities.length,
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
  const existing = await retryService("archive bucket read", () => db.storage.getBucket(ARCHIVE_BUCKET));
  if (existing.error || !existing.data) {
    const created = await retryService("archive bucket create", () => db.storage.createBucket(ARCHIVE_BUCKET, options));
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
  const uploaded = await retryService("archive source upload", () => db.storage.from(ARCHIVE_BUCKET).upload(objectPath, source.bytes, {
    contentType: source.mimeType,
    cacheControl: "0",
    upsert: false,
  }));
  if (uploaded.error && !/already exists|duplicate|409/i.test(uploaded.error.message || "")) {
    throw new Error(`Could not archive source: ${uploaded.error.message}`);
  }
  return { digest, objectPath, bytes: source.bytes.byteLength };
}

async function uploadRegistrySource(db, plan, bytes) {
  const storage = plan.source.storage;
  const uploaded = await retryService("registry source upload", () => db.storage.from(CHECKLIST_SOURCE_BUCKET).upload(storage.objectPath, bytes, {
    contentType: storage.mimeType,
    cacheControl: "0",
    upsert: false,
  }));
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
  const { error } = await retryService("source catalog upsert", () => db
    .from("checklist_source_catalog")
    .upsert(values, { onConflict: "source_url" }));
  if (error) throw new Error(`Could not update checklist source catalog: ${error.message}`);
}

export async function persistPlan(db, plan, bytes) {
  await uploadRegistrySource(db, plan, bytes);
  const storage = plan.source.storage;
  const { data, error } = await retryService("registry import rpc", () => db.rpc("tcos_apply_checklist_import_plan", {
    p_plan: plan,
    p_original_filename: storage.originalFilename,
    p_mime_type: storage.mimeType,
    p_size_bytes: storage.sizeBytes,
    p_sha256: storage.sha256,
    p_storage_bucket: storage.bucket,
    p_storage_object_path: storage.objectPath,
  }));
  if (error) throw new Error(`Checklist Registry transaction failed: ${error.message}`);
  return data;
}
