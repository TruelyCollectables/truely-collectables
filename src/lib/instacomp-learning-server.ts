import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { InstaCompCatalogEvidenceSnapshot } from "./instacomp-catalog-identity";

type ScanActor = {
  type: "admin" | "seller";
  storeId: string;
  sellerAccountId?: string | null;
};

type CacheRow = {
  id: string;
  scan_id: string | null;
  knowledge_entry_id: string | null;
  response_payload: Record<string, any>;
  identity_confidence: number | null;
  trusted_for_pricing: boolean;
  confirmation_status: string;
  observed_at: string;
  market_expires_at: string;
  hit_count: number;
};

type RegistryMatch = {
  identityId: string;
  fingerprintSha256: string;
  sourceLabel: string;
  score: number;
  player: string | null;
  year: string | null;
  setName: string | null;
  cardNumber: string | null;
  parallel: string | null;
  serialRun: number | null;
  matchedEvidence: string[];
};

const CACHE_TABLE = "instacomp_scan_knowledge_cache";
const OBSERVATION_TABLE = "tcos_card_knowledge_observations";
const ENTRY_TABLE = "tcos_card_knowledge_entries";

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("InstaComp learning requires Supabase service-role access.");
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function normalizedText(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}/]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedCardNumber(value: unknown) {
  return normalizedText(value).replace(/[\s-]/g, "");
}

function yearStart(value: unknown) {
  return normalizedText(value).match(/\b((?:19|20)\d{2})\b/)?.[1] || "";
}

function meaningfulTokens(value: unknown) {
  return normalizedText(value)
    .split(" ")
    .filter(Boolean)
    .filter(
      (token) =>
        ![
          "the",
          "and",
          "card",
          "cards",
          "trading",
          "base",
          "set",
          "series",
          "upper",
          "deck",
          "panini",
        ].includes(token),
    );
}

function isBaseParallel(value: unknown) {
  const normalized = normalizedText(value);
  return !normalized || ["base", "base card", "standard", "regular"].includes(normalized);
}

function checklistParallelTokens(value: unknown) {
  return normalizedText(value)
    .replace(/\bcracked\s+ice\b/g, "ice")
    .split(" ")
    .filter(Boolean)
    .filter(
      (token) =>
        ![
          "prizm",
          "prizms",
          "parallel",
          "variation",
          "rookie",
          "card",
        ].includes(token),
    );
}

function asNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export async function sha256File(file: File | null) {
  if (!(file instanceof File) || file.size <= 0) return null;
  const bytes = Buffer.from(await file.arrayBuffer());
  return createHash("sha256").update(bytes).digest("hex");
}

export function buildImageFingerprint(frontHash: string, backHash: string | null) {
  return `${frontHash}:${backHash || "front-only"}`;
}

export async function findFreshInstaCompCache(params: {
  frontHash: string;
  backHash: string | null;
  forceFresh?: boolean;
}) {
  if (params.forceFresh) return null;

  const supabase = serviceClient();
  const imageFingerprint = buildImageFingerprint(params.frontHash, params.backHash);
  const { data, error } = await supabase
    .from(CACHE_TABLE)
    .select(
      "id,scan_id,knowledge_entry_id,response_payload,identity_confidence,trusted_for_pricing,confirmation_status,observed_at,market_expires_at,hit_count",
    )
    .eq("image_fingerprint", imageFingerprint)
    .gt("market_expires_at", new Date().toISOString())
    .maybeSingle();

  if (error) {
    if (["42P01", "42703", "PGRST205"].includes(String(error.code || ""))) return null;
    console.error("InstaComp learning cache lookup failed:", error);
    return null;
  }

  const row = data as CacheRow | null;
  if (!row) return null;

  const operatorTrusted = ["operator_confirmed", "catalog_confirmed"].includes(
    row.confirmation_status,
  );
  const evidenceTrusted =
    row.trusted_for_pricing && Number(row.identity_confidence || 0) >= 0.97;

  if (!operatorTrusted && !evidenceTrusted) return null;
  if (!row.response_payload || row.response_payload.ok === false) return null;

  return row;
}

export function buildChecklistRegistryCatalogEvidence(
  match: RegistryMatch,
): InstaCompCatalogEvidenceSnapshot {
  const source = "instacomp_checklist_registry";
  const sourceUrl = `tcos://instacomp/checklist-registry/${match.identityId}`;
  const serialRun = match.serialRun ? `/${match.serialRun}` : null;
  const identity = {
    player: match.player,
    year: match.year,
    setName: match.setName,
    cardNumber: match.cardNumber,
    parallel: match.parallel,
    variation: match.parallel,
    serialRun,
  };
  const matchExplanation = [
    "Exact Checklist Registry identity confirmed.",
    ...match.matchedEvidence,
  ].join(" ");

  return {
    schema: "tcos.instacomp.catalogEvidence.v1",
    capturedAt: new Date().toISOString(),
    status: "catalog_confirmed",
    operatorState: "ready_for_exact_comps",
    catalogConfirmed: true,
    selectedMatch: {
      catalogId: match.identityId,
      source,
      sourceLabel: match.sourceLabel,
      sourceUrl,
      score: match.score,
      matchedEvidence: match.matchedEvidence,
      mismatchedEvidence: [],
      missingEvidence: [],
      criticalMismatch: false,
      identity,
    },
    alternateMatches: [],
    providerSummaries: [
      {
        source,
        sourceLabel: match.sourceLabel,
        policyStatus: "approved",
        resultStatus: "fulfilled",
        candidateCount: 1,
        usableCandidateCount: 1,
        reasons: ["Private normalized checklist identity matched exactly."],
      },
    ],
    providerWarnings: [],
    reviewReasons: [],
    suggestedQuestion: null,
    operatorAction: "Checklist Registry exact identity confirmed.",
    safeUseBoundary:
      "The Registry confirms identity. Market price still comes only from included live and sold evidence.",
    actionPermissions: {
      exactCompSearchAllowed: true,
      trustedForExactComps: true,
      publicListingClaimAllowed: true,
      autoPriceAllowed: true,
      tradeValueRecommendationAllowed: true,
    },
    compIdentity: {
      ...identity,
      catalogId: match.identityId,
      catalogSource: source,
      catalogSourceLabel: match.sourceLabel,
      catalogSourceUrl: sourceUrl,
      catalogMatchExplanation: matchExplanation,
    },
    sourceAttribution: {
      source,
      sourceLabel: match.sourceLabel,
      sourceUrl,
      catalogId: match.identityId,
    },
    auditFlags: [
      "private_registry_source",
      "exact_identity_fingerprint",
      "pricing_requires_live_market_evidence",
    ],
  };
}

function chooseRegistryMatch(ai: Record<string, any>, rows: any[]): RegistryMatch | null {
  const targetPlayer = normalizedText(ai.player);
  const targetYear = yearStart(ai.year);
  const targetSetTokens = new Set(
    meaningfulTokens([ai.brand, ai.setName].filter(Boolean).join(" ")),
  );
  const targetParallel = normalizedText(ai.parallel);
  const targetParallelTokens = checklistParallelTokens(ai.parallel);
  const targetSerialRun = String(ai.serialNumber || "").match(/\/(\d{1,7})\b/)?.[1];

  const matches: RegistryMatch[] = [];

  for (const card of rows) {
    const players = Array.isArray(card.players)
      ? card.players
          .map((link: any) => link?.player?.canonical_name)
          .filter(Boolean)
      : [];
    const playerMatch = players.some(
      (player: string) => normalizedText(player) === targetPlayer,
    );
    if (targetPlayer && !playerMatch) continue;

    const release = card.release || {};
    const releaseYear = release.release_year || release.season || null;
    if (targetYear && yearStart(releaseYear) !== targetYear) continue;

    const setName = card.set?.name || null;
    const setTokens = meaningfulTokens(
      [release.brand?.name, release.product_name, setName].filter(Boolean).join(" "),
    );
    const setMatches =
      !targetSetTokens.size ||
      setTokens.filter((token) => targetSetTokens.has(token)).length >=
        Math.max(1, Math.min(2, targetSetTokens.size));
    if (!setMatches) continue;

    const identities = Array.isArray(card.identities) ? card.identities : [];
    for (const identity of identities) {
      const parallelName = identity.parallel?.name || "Base";
      const registryBase = isBaseParallel(parallelName);
      const targetBase = isBaseParallel(targetParallel);
      if (targetBase !== registryBase) continue;

      if (!targetBase) {
        const offered = new Set(checklistParallelTokens(parallelName));
        if (
          !targetParallelTokens.length ||
          !targetParallelTokens.every((token) => offered.has(token))
        ) {
          continue;
        }
      }

      const serialRun = asNumber(identity.parallel?.serial_run);
      // A numbered checklist parallel cannot be publicly confirmed unless the
      // physical card supplied a visible serial stamp. This prevents an
      // unnumbered Ice card from being “confirmed” as Mosaic /3.
      if (serialRun && !targetSerialRun) continue;
      if (targetSerialRun && serialRun !== Number(targetSerialRun)) continue;

      const evidence = [
        `card number ${card.card_number}`,
        playerMatch ? `player ${players.join(" / ")}` : null,
        releaseYear ? `release ${releaseYear}` : null,
        setName ? `set ${setName}` : null,
        `parallel ${parallelName}`,
        serialRun ? `serial run /${serialRun}` : null,
      ].filter(Boolean) as string[];
      const score = Math.min(
        100,
        50 +
          (playerMatch ? 20 : 0) +
          (targetYear ? 10 : 5) +
          (setMatches ? 10 : 0) +
          (!targetBase ? 10 : 5) +
          (targetSerialRun ? 10 : 0),
      );

      matches.push({
        identityId: String(identity.id),
        fingerprintSha256: String(identity.fingerprint_sha256),
        sourceLabel: "InstaComp Checklist Registry",
        score,
        player: players.join(" / ") || null,
        year: releaseYear,
        setName,
        cardNumber: card.card_number || null,
        parallel: parallelName,
        serialRun,
        matchedEvidence: evidence,
      });
    }
  }

  matches.sort((left, right) => right.score - left.score);
  if (!matches.length || matches[0].score < 85) return null;
  if (matches.length > 1 && matches[0].score === matches[1].score) return null;
  return matches[0];
}

export async function findChecklistRegistryMatch(ai: Record<string, any>) {
  const cardNumber = normalizedCardNumber(ai.cardNumber);
  if (!cardNumber || !normalizedText(ai.player)) return null;

  const supabase = serviceClient();
  const { data, error } = await supabase
    .from("checklist_cards")
    .select(
      [
        "id",
        "card_number",
        "normalized_card_number",
        "variation",
        "autograph_status",
        "memorabilia_status",
        "version:checklist_versions!inner(id,is_active,status)",
        "set:checklist_sets(id,name,normalized_name)",
        "release:checklist_releases(id,product_name,release_year,season,brand:checklist_brands(name),sport:checklist_sports(name),league:checklist_leagues(name))",
        "players:checklist_card_players(display_order,player:checklist_players(canonical_name))",
        "teams:checklist_card_teams(display_order,team:checklist_teams(canonical_name))",
        "identities:checklist_card_identities(id,fingerprint_sha256,canonical_key,variation,autograph_status,memorabilia_status,parallel:checklist_parallels(name,serial_run))",
      ].join(","),
    )
    .eq("normalized_card_number", cardNumber)
    .eq("version.is_active", true)
    .eq("version.status", "live")
    .limit(150);

  if (error) {
    if (["42P01", "42703", "PGRST205"].includes(String(error.code || ""))) return null;
    console.error("Checklist Registry lookup failed:", error);
    return null;
  }

  return chooseRegistryMatch(ai, data || []);
}

export async function saveInstaCompLearningCache(params: {
  scanId: string;
  frontHash: string;
  backHash: string | null;
  payload: Record<string, any>;
  actor: ScanActor;
}) {
  const supabase = serviceClient();
  const imageFingerprint = buildImageFingerprint(params.frontHash, params.backHash);

  await supabase
    .from("instacomp_scans")
    .update({
      front_image_sha256: params.frontHash,
      back_image_sha256: params.backHash,
    })
    .eq("id", params.scanId);

  const { data: scanRow } = await supabase
    .from("instacomp_scans")
    .select("*")
    .eq("id", params.scanId)
    .maybeSingle();

  if (scanRow) {
    await supabase.rpc("tcos_instacomp_record_scan_knowledge_payload", {
      p_scan: scanRow,
    });
  }

  const registryMatch = await findChecklistRegistryMatch(params.payload.ai || {});
  const payload = registryMatch
    ? {
        ...params.payload,
        catalogEvidence: buildChecklistRegistryCatalogEvidence(registryMatch),
        checklistRegistry: {
          matched: true,
          identityId: registryMatch.identityId,
          fingerprintSha256: registryMatch.fingerprintSha256,
          score: registryMatch.score,
        },
      }
    : params.payload;

  const { data: observation } = await supabase
    .from(OBSERVATION_TABLE)
    .select("knowledge_entry_id")
    .eq("observation_key", `scan:${params.scanId}`)
    .maybeSingle();
  const entryId = observation?.knowledge_entry_id || null;
  const confirmationStatus = registryMatch
    ? "catalog_confirmed"
    : "scanner_observed";

  if (entryId && registryMatch) {
    await supabase
      .from(OBSERVATION_TABLE)
      .update({
        confirmation_status: "catalog_confirmed",
        catalog_evidence: payload.catalogEvidence,
        result_payload: payload,
      })
      .eq("observation_key", `scan:${params.scanId}`);
    await supabase
      .from(ENTRY_TABLE)
      .update({
        catalog_evidence: payload.catalogEvidence,
        result_payload: payload,
      })
      .eq("id", entryId);
    await supabase.rpc("tcos_instacomp_refresh_knowledge_entry", {
      p_entry_id: entryId,
    });
  }

  const confidence = asNumber(payload.ai?.confidence);
  const trustedForPricing = payload.review?.trustedForPricing === true;
  const expiresAt = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();

  const { data: cache, error } = await supabase
    .from(CACHE_TABLE)
    .upsert(
      {
        image_fingerprint: imageFingerprint,
        scan_id: params.scanId,
        knowledge_entry_id: entryId,
        front_image_sha256: params.frontHash,
        back_image_sha256: params.backHash,
        response_payload: payload,
        identity_confidence: confidence,
        trusted_for_pricing: trustedForPricing,
        confirmation_status: confirmationStatus,
        submitted_by_account_id:
          params.actor.type === "seller" ? params.actor.sellerAccountId || null : null,
        submitted_by_actor_type: params.actor.type,
        submitted_store_id: params.actor.storeId,
        observed_at: new Date().toISOString(),
        market_expires_at: expiresAt,
      },
      { onConflict: "image_fingerprint" },
    )
    .select("id,knowledge_entry_id,confirmation_status,market_expires_at")
    .single();

  if (error) {
    console.error("Could not save InstaComp learning cache:", error);
    return { payload, registryMatch, cache: null };
  }

  return { payload, registryMatch, cache };
}

export async function recordInstaCompCacheReplay(params: {
  cacheId: string;
  actor: ScanActor;
}) {
  const supabase = serviceClient();
  const observationKey = `cache-replay:${params.cacheId}:${randomUUID()}`;
  const { data, error } = await supabase.rpc("tcos_instacomp_record_cache_replay", {
    p_cache_id: params.cacheId,
    p_observation_key: observationKey,
    p_submitted_by_account_id:
      params.actor.type === "seller" ? params.actor.sellerAccountId || null : null,
    p_submitted_by_actor_type: params.actor.type,
    p_submitted_store_id: params.actor.storeId,
  });

  if (error) {
    console.error("Could not record InstaComp cache replay:", error);
    return null;
  }

  return data;
}

export async function confirmInstaCompKnowledge(params: {
  scanId: string;
  corrections: Record<string, unknown>;
  status: "operator_confirmed" | "operator_rejected" | "needs_more_info";
}) {
  const supabase = serviceClient();
  const { data, error } = await supabase.rpc(
    "tcos_instacomp_confirm_scan_knowledge",
    {
      p_scan_id: params.scanId,
      p_corrections: params.corrections,
      p_confirmation_status: params.status,
    },
  );

  if (error) throw new Error(error.message || "Could not confirm InstaComp knowledge.");
  return data;
}

export type { CacheRow, RegistryMatch, ScanActor };
