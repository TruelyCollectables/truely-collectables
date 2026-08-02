import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { InstaCompCatalogEvidenceSnapshot } from "./instacomp-catalog-identity";

export type ScanActor = {
  type: "admin" | "seller";
  storeId: string;
  sellerAccountId?: string | null;
};

export type CacheRow = {
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
  submitted_store_id?: string | null;
  submitted_by_actor_type?: string | null;
  submitted_by_account_id?: string | null;
};

export type RegistryMatch = {
  identityId: string;
  fingerprintSha256: string;
  sourceLabel: string;
  score: number;
  manufacturer: string | null;
  brand: string | null;
  product: string | null;
  player: string | null;
  year: string | null;
  setName: string | null;
  cardNumber: string | null;
  parallel: string | null;
  variation: string | null;
  serialRun: number | null;
  team: string | null;
  sport: string | null;
  league: string | null;
  languageCode: string | null;
  configurationExclusivity: string | null;
  isAuto: boolean;
  isRelic: boolean;
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

function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
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
          "topps",
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

function statusIsPositive(value: unknown, kind: "auto" | "relic") {
  const normalized = normalizedText(value);
  if (!normalized) return false;
  return kind === "auto"
    ? /\b(auto|autograph|autographed|signed|signature)\b/.test(normalized) &&
        !/\b(non auto|no auto|none|false)\b/.test(normalized)
    : /\b(relic|memorabilia|patch|jersey|swatch)\b/.test(normalized) &&
        !/\b(non memorabilia|non relic|no relic|none|false)\b/.test(normalized);
}

function canonicalField(canonicalKey: unknown, field: string) {
  const prefix = `${field}=`;
  return String(canonicalKey || "")
    .split("|")
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length)
    .replace(/^∅$/, "") || "";
}

function cacheActorScope(actor: ScanActor) {
  const account =
    actor.type === "seller" ? actor.sellerAccountId || "missing-seller" : "admin";
  return `${actor.storeId}:${actor.type}:${account}`;
}

function scopeCacheQuery<T>(query: T, actor: ScanActor): T {
  let scoped = (query as any)
    .eq("submitted_store_id", actor.storeId)
    .eq("submitted_by_actor_type", actor.type);

  scoped =
    actor.type === "seller"
      ? scoped.eq("submitted_by_account_id", actor.sellerAccountId)
      : scoped.is("submitted_by_account_id", null);

  return scoped as T;
}

export async function sha256File(file: File | null) {
  if (!(file instanceof File) || file.size <= 0) return null;
  const bytes = Buffer.from(await file.arrayBuffer());
  return createHash("sha256").update(bytes).digest("hex");
}

export function buildImageFingerprint(
  frontHash: string,
  backHash: string | null,
  actor?: ScanActor,
) {
  const imageFingerprint = `${frontHash}:${backHash || "front-only"}`;
  if (!actor) return imageFingerprint;
  return createHash("sha256")
    .update(`${cacheActorScope(actor)}:${imageFingerprint}`, "utf8")
    .digest("hex");
}

export function sanitizeInstaCompCachePayload(payload: Record<string, any>) {
  const sanitized = JSON.parse(JSON.stringify(payload || {})) as Record<string, any>;
  for (const key of [
    "scanId",
    "knowledge",
    "queue",
    "benchmarkDiagnostics",
    "operatorCorrections",
  ]) {
    delete sanitized[key];
  }

  const diagnostics = record(sanitized.ocrDiagnostics);
  delete diagnostics.operatorSerialNumberOverride;
  if (Object.keys(diagnostics).length) sanitized.ocrDiagnostics = diagnostics;

  sanitized.cachePayloadSchema = "instacomp.cachePayload.v2";
  return sanitized;
}

export async function findFreshInstaCompCache(params: {
  frontHash: string;
  backHash: string | null;
  actor: ScanActor;
  forceFresh?: boolean;
}) {
  if (params.forceFresh) return null;

  const supabase = serviceClient();
  const imageFingerprint = buildImageFingerprint(
    params.frontHash,
    params.backHash,
    params.actor,
  );
  let query = supabase
    .from(CACHE_TABLE)
    .select(
      "id,scan_id,knowledge_entry_id,response_payload,identity_confidence,trusted_for_pricing,confirmation_status,observed_at,market_expires_at,hit_count,submitted_store_id,submitted_by_actor_type,submitted_by_account_id",
    )
    .eq("image_fingerprint", imageFingerprint)
    .gt("market_expires_at", new Date().toISOString());
  query = scopeCacheQuery(query, params.actor);
  const { data, error } = await query.maybeSingle();

  if (error) {
    if (["42P01", "42703", "PGRST205"].includes(String(error.code || ""))) return null;
    console.error("InstaComp learning cache lookup failed:", error);
    return null;
  }

  const row = data as CacheRow | null;
  if (!row) return null;
  if (!["operator_confirmed", "catalog_confirmed"].includes(row.confirmation_status)) {
    return null;
  }
  if (!row.response_payload || row.response_payload.ok === false) return null;

  return {
    ...row,
    response_payload: sanitizeInstaCompCachePayload(row.response_payload),
  } satisfies CacheRow;
}

export function buildChecklistRegistryCatalogEvidence(
  match: RegistryMatch,
): InstaCompCatalogEvidenceSnapshot {
  const source = "instacomp_checklist_registry";
  const sourceUrl = `tcos://instacomp/checklist-registry/${match.identityId}`;
  const serialRun = match.serialRun ? `/${match.serialRun}` : null;
  const identity = {
    manufacturer: match.manufacturer,
    brand: match.brand,
    product: match.product,
    player: match.player,
    year: match.year,
    setName: match.setName,
    cardNumber: match.cardNumber,
    parallel: match.parallel,
    variation: match.variation,
    serialRun,
    team: match.team,
    sport: match.sport,
    league: match.league,
    languageCode: match.languageCode,
    configurationExclusivity: match.configurationExclusivity,
    isAuto: match.isAuto,
    isRelic: match.isRelic,
  };
  const matchExplanation = [
    "Active validated Checklist Registry identity confirmed.",
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
        reasons: [
          "Private normalized checklist identity matched one active live version across every available identity-critical field.",
        ],
      },
    ],
    providerWarnings: [],
    reviewReasons: [],
    suggestedQuestion: null,
    operatorAction: "Checklist Registry exact identity confirmed.",
    safeUseBoundary:
      "The Registry confirms identity only. Transaction value still requires independently verified completed sales.",
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
      "active_live_registry_version",
      "full_identity_compatibility",
      "pricing_requires_verified_completed_sales",
    ],
  };
}

export function chooseRegistryMatch(
  ai: Record<string, any>,
  rows: any[],
): RegistryMatch | null {
  const targetPlayer = normalizedText(ai.player);
  const targetYear = yearStart(ai.year);
  const targetBrand = normalizedText(ai.brand);
  const targetSetTokens = new Set(meaningfulTokens(ai.setName));
  const targetParallel = normalizedText(ai.parallel);
  const targetParallelTokens = checklistParallelTokens(ai.parallel);
  const targetVariation = normalizedText(ai.variation);
  const targetTeam = normalizedText(ai.team);
  const targetSport = normalizedText(ai.sport);
  const targetLeague = normalizedText(ai.league);
  const targetLanguage = normalizedText(ai.languageCode || ai.language);
  const targetConfiguration = normalizedText(ai.configurationExclusivity);
  const targetSerialRun = String(ai.serialNumber || "").match(/\/(\d{1,7})\b/)?.[1];
  const targetAuto = ai.isAuto === true;
  const targetRelic = ai.isRelic === true;

  if (!targetPlayer || !targetYear || !targetBrand || !targetSetTokens.size) {
    return null;
  }

  const matches = new Map<string, RegistryMatch>();

  for (const card of rows) {
    const players = Array.isArray(card.players)
      ? card.players
          .map((link: any) => link?.player?.canonical_name)
          .filter(Boolean)
      : [];
    if (!players.some((player: string) => normalizedText(player) === targetPlayer)) {
      continue;
    }

    const release = card.release || {};
    const releaseYear = release.release_year || release.season || null;
    if (yearStart(releaseYear) !== targetYear) continue;

    const manufacturer = release.manufacturer?.name || null;
    const brand = release.brand?.name || null;
    const product = release.product_name || null;
    const setName = card.set?.name || null;
    const registryBrandText = normalizedText(
      [manufacturer, brand, product].filter(Boolean).join(" "),
    );
    if (!registryBrandText.includes(targetBrand)) continue;

    const registrySetTokens = new Set(
      meaningfulTokens([brand, product, setName].filter(Boolean).join(" ")),
    );
    if (![...targetSetTokens].every((token) => registrySetTokens.has(token))) {
      continue;
    }

    const teams = Array.isArray(card.teams)
      ? card.teams
          .map((link: any) => link?.team?.canonical_name)
          .filter(Boolean)
      : [];
    if (teams.length && !targetTeam) continue;
    if (
      targetTeam &&
      !teams.some((team: string) => normalizedText(team) === targetTeam)
    ) {
      continue;
    }

    const registrySport = normalizedText(release.sport?.name);
    const registryLeague = normalizedText(release.league?.name);
    if (registrySport && (!targetSport || registrySport !== targetSport)) continue;
    if (registryLeague && targetLeague && registryLeague !== targetLeague) continue;

    const identities = Array.isArray(card.identities) ? card.identities : [];
    for (const identity of identities) {
      const parallelName = identity.parallel?.name || "Base";
      const registryBase = isBaseParallel(parallelName);
      const targetBase = isBaseParallel(targetParallel);
      if (!targetSerialRun) {
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
      }

      const registryVariation = normalizedText(identity.variation || card.variation);
      if (registryVariation || targetVariation) {
        if (!registryVariation || !targetVariation || registryVariation !== targetVariation) {
          continue;
        }
      }

      const registryAuto = statusIsPositive(
        identity.autograph_status || card.autograph_status,
        "auto",
      );
      const registryRelic = statusIsPositive(
        identity.memorabilia_status || card.memorabilia_status,
        "relic",
      );
      if (registryAuto !== targetAuto || registryRelic !== targetRelic) continue;

      const registryLanguage = normalizedText(
        identity.metadata?.languageCode ||
          identity.metadata?.language_code ||
          canonicalField(identity.canonical_key, "language_code"),
      );
      if (registryLanguage || targetLanguage) {
        if (!registryLanguage || !targetLanguage || registryLanguage !== targetLanguage) {
          continue;
        }
      }

      const registryConfiguration = normalizedText(
        identity.configuration_exclusivity ||
          canonicalField(identity.canonical_key, "configuration"),
      );
      if (registryConfiguration || targetConfiguration) {
        if (
          !registryConfiguration ||
          !targetConfiguration ||
          registryConfiguration !== targetConfiguration
        ) {
          continue;
        }
      }

      const serialRun = asNumber(identity.parallel?.serial_run);
      if (serialRun && !targetSerialRun) continue;
      if (targetSerialRun && serialRun !== Number(targetSerialRun)) continue;

      const fingerprint = String(identity.fingerprint_sha256 || "");
      if (!fingerprint) continue;
      const evidence = [
        `card number ${card.card_number}`,
        `player ${players.join(" / ")}`,
        `release ${releaseYear}`,
        `manufacturer ${manufacturer || "unknown"}`,
        `product ${product || "unknown"}`,
        `set ${setName || "unknown"}`,
        `parallel ${parallelName}`,
        registryVariation ? `variation ${identity.variation || card.variation}` : null,
        serialRun ? `serial run /${serialRun}` : null,
        teams.length ? `team ${teams.join(" / ")}` : null,
        registrySport ? `sport ${release.sport?.name}` : null,
        registryLanguage ? `language ${registryLanguage}` : null,
        registryConfiguration ? `configuration ${registryConfiguration}` : null,
        registryAuto ? "autograph status matched" : "non-autograph status matched",
        registryRelic ? "memorabilia status matched" : "non-memorabilia status matched",
      ].filter(Boolean) as string[];

      matches.set(fingerprint, {
        identityId: String(identity.id),
        fingerprintSha256: fingerprint,
        sourceLabel: "InstaComp Checklist Registry",
        score: 100,
        manufacturer,
        brand,
        product,
        player: players.join(" / ") || null,
        year: releaseYear,
        setName,
        cardNumber: card.card_number || null,
        parallel: parallelName,
        variation: identity.variation || card.variation || null,
        serialRun,
        team: teams.join(" / ") || null,
        sport: release.sport?.name || null,
        league: release.league?.name || null,
        languageCode: registryLanguage || null,
        configurationExclusivity: registryConfiguration || null,
        isAuto: registryAuto,
        isRelic: registryRelic,
        matchedEvidence: evidence,
      });
    }
  }

  return matches.size === 1 ? [...matches.values()][0] : null;
}

export async function findChecklistRegistryMatch(ai: Record<string, any>) {
  const cardNumber = normalizedCardNumber(ai.cardNumber);
  if (
    !cardNumber ||
    !normalizedText(ai.player) ||
    !yearStart(ai.year) ||
    !normalizedText(ai.brand) ||
    !meaningfulTokens(ai.setName).length
  ) {
    return null;
  }

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
        "release:checklist_releases(id,product_name,release_year,season,manufacturer:checklist_manufacturers(name),brand:checklist_brands(name),sport:checklist_sports(name),league:checklist_leagues(name))",
        "players:checklist_card_players(display_order,player:checklist_players(canonical_name))",
        "teams:checklist_card_teams(display_order,team:checklist_teams(canonical_name))",
        "identities:checklist_card_identities(id,fingerprint_sha256,canonical_key,variation,autograph_status,memorabilia_status,configuration_exclusivity,metadata,parallel:checklist_parallels(name,serial_run))",
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
  const warnings: string[] = [];
  const imageFingerprint = buildImageFingerprint(
    params.frontHash,
    params.backHash,
    params.actor,
  );

  const { error: hashError } = await supabase
    .from("instacomp_scans")
    .update({
      front_image_sha256: params.frontHash,
      back_image_sha256: params.backHash,
    })
    .eq("id", params.scanId);
  if (hashError) warnings.push(`scan_hash_update_failed:${hashError.message}`);

  const { data: scanRow, error: scanReadError } = await supabase
    .from("instacomp_scans")
    .select("*")
    .eq("id", params.scanId)
    .maybeSingle();
  if (scanReadError) warnings.push(`scan_read_failed:${scanReadError.message}`);

  if (scanRow) {
    const { error: recordError } = await supabase.rpc(
      "tcos_instacomp_record_scan_knowledge_payload",
      { p_scan: scanRow },
    );
    if (recordError) warnings.push(`knowledge_observation_failed:${recordError.message}`);
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

  const { data: observation, error: observationReadError } = await supabase
    .from(OBSERVATION_TABLE)
    .select("knowledge_entry_id")
    .eq("observation_key", `scan:${params.scanId}`)
    .maybeSingle();
  if (observationReadError) {
    warnings.push(`knowledge_observation_read_failed:${observationReadError.message}`);
  }

  const entryId = observation?.knowledge_entry_id || null;
  let registryPersisted = false;

  if (entryId && registryMatch) {
    const { error: observationUpdateError } = await supabase
      .from(OBSERVATION_TABLE)
      .update({
        confirmation_status: "catalog_confirmed",
        catalog_evidence: payload.catalogEvidence,
        result_payload: sanitizeInstaCompCachePayload(payload),
      })
      .eq("observation_key", `scan:${params.scanId}`);
    const { error: entryUpdateError } = await supabase
      .from(ENTRY_TABLE)
      .update({
        catalog_evidence: payload.catalogEvidence,
        result_payload: sanitizeInstaCompCachePayload(payload),
      })
      .eq("id", entryId);
    const { error: refreshError } = await supabase.rpc(
      "tcos_instacomp_refresh_knowledge_entry",
      { p_entry_id: entryId },
    );

    if (observationUpdateError) {
      warnings.push(`catalog_observation_persist_failed:${observationUpdateError.message}`);
    }
    if (entryUpdateError) {
      warnings.push(`catalog_entry_persist_failed:${entryUpdateError.message}`);
    }
    if (refreshError) warnings.push(`catalog_entry_refresh_failed:${refreshError.message}`);
    registryPersisted = !observationUpdateError && !entryUpdateError && !refreshError;
  }

  const confidence = asNumber(payload.ai?.confidence);
  const trustedForPricing = payload.review?.trustedForPricing === true;
  const confirmationStatus = registryPersisted
    ? "catalog_confirmed"
    : "scanner_observed";
  const expiresAt = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
  const cachePayload = sanitizeInstaCompCachePayload(payload);

  const { data: cache, error } = await supabase
    .from(CACHE_TABLE)
    .upsert(
      {
        image_fingerprint: imageFingerprint,
        scan_id: params.scanId,
        knowledge_entry_id: entryId,
        front_image_sha256: params.frontHash,
        back_image_sha256: params.backHash,
        response_payload: cachePayload,
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
    warnings.push(`cache_write_failed:${error.message}`);
    return { payload, registryMatch, cache: null, warnings };
  }

  return { payload, registryMatch, cache, warnings };
}

export async function materializeInstaCompCacheReplay(params: {
  cache: CacheRow;
  actor: ScanActor;
}) {
  const supabase = serviceClient();
  const payload = sanitizeInstaCompCachePayload(params.cache.response_payload);
  const ai = record(payload.ai);
  const stats = record(payload.stats);
  const soldStats = record(payload.soldStats);
  const links = record(payload.links);
  const providers = Array.isArray(payload.providers) ? payload.providers : [];
  const allResults = providers.flatMap((provider: any) =>
    Array.isArray(provider?.results) ? provider.results : [],
  );

  const { data, error } = await supabase
    .from("instacomp_scans")
    .insert({
      image_filename: "exact-image-cache-replay",
      player: ai.player || null,
      year: ai.year || null,
      brand: ai.brand || null,
      set_name: ai.setName || null,
      card_number: ai.cardNumber || null,
      parallel: ai.parallel || null,
      serial_number: ai.serialNumber || null,
      team: ai.team || null,
      sport: ai.sport || null,
      is_rookie: ai.isRookie === true,
      is_auto: ai.isAuto === true,
      is_relic: ai.isRelic === true,
      condition_guess: ai.conditionGuess || null,
      confidence: asNumber(ai.confidence),
      search_query: payload.searchQuery || null,
      backup_queries: Array.isArray(payload.backupQueries)
        ? payload.backupQueries
        : [],
      active_low: asNumber(stats.low),
      active_median: asNumber(stats.median),
      active_average: asNumber(stats.average),
      active_high: asNumber(stats.high),
      suggested_price: asNumber(stats.suggestedPrice),
      ebay_sold_url: links.ebaySoldUrl || null,
      ebay_active_url: links.ebayActiveUrl || null,
      one30point_url: links.one30pointUrl || null,
      comc_url: links.comcUrl || null,
      myslabs_url: links.myslabsUrl || null,
      pwcc_url: links.pwccUrl || null,
      goldin_url: links.goldinUrl || null,
      fanatics_url: links.fanaticsUrl || null,
      raw_ai_result: ai,
      raw_comp_results: {
        providers,
        allResults,
        sourceCoverage: Array.isArray(payload.sourceCoverage)
          ? payload.sourceCoverage
          : [],
        marketValueComps: Array.isArray(payload.marketValueComps)
          ? payload.marketValueComps
          : [],
        soldComps: Array.isArray(payload.soldComps) ? payload.soldComps : [],
        soldStats,
        remainingCards: Array.isArray(payload.remainingCards)
          ? payload.remainingCards
          : [],
        sourceLinks: links,
        catalogEvidence: payload.catalogEvidence || {},
        cacheReplay: {
          schema: "instacomp.cacheReplay.v2",
          cacheId: params.cache.id,
          priorScanId: params.cache.scan_id,
          actorType: params.actor.type,
          storeId: params.actor.storeId,
        },
      },
    })
    .select("id")
    .single();

  if (error || !data?.id) {
    throw new Error(
      `Could not materialize cached InstaComp scan: ${error?.message || "missing scan id"}`,
    );
  }

  let hitUpdate = supabase
    .from(CACHE_TABLE)
    .update({
      hit_count: Math.max(0, Number(params.cache.hit_count || 0)) + 1,
      last_hit_at: new Date().toISOString(),
    })
    .eq("id", params.cache.id);
  hitUpdate = scopeCacheQuery(hitUpdate, params.actor);
  const { error: hitError } = await hitUpdate;
  if (hitError) {
    throw new Error(`Could not record cache replay: ${hitError.message}`);
  }

  return {
    scanId: String(data.id),
    payload: {
      ...payload,
      ok: true,
      scanId: String(data.id),
    },
  };
}

export async function recordInstaCompCacheReplay(params: {
  cacheId: string;
  actor: ScanActor;
}) {
  const supabase = serviceClient();
  let lookup = supabase.from(CACHE_TABLE).select("id").eq("id", params.cacheId);
  lookup = scopeCacheQuery(lookup, params.actor);
  const { data: scopedCache, error: lookupError } = await lookup.maybeSingle();
  if (lookupError || !scopedCache) return null;

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
