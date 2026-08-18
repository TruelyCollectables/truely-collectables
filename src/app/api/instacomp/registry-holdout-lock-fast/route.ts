import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireInstaCompJobActor } from "../../../../lib/instacomp-job-server";
import { assertTrustedInstaCompMutationRequest } from "../../../../lib/instacomp-mutation-security";
import { isValidInstaCompSentinelArchiveRequest } from "../../../../lib/instacomp-sentinel-auth";
import { getActiveStoreId } from "../../../../lib/stores";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERSION_CHUNK_SIZE = 100;
const DETAIL_CHUNK_SIZE = 100;
const MAX_ACTIVE_CARD_ROWS = 1500;

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

function normalizedSubjects(value: unknown) {
  return Array.from(
    new Set(
      String(value ?? "")
        .split(/\s*(?:\/|;|,|&|\band\b)\s*/i)
        .map(normalizedText)
        .filter(Boolean),
    ),
  ).sort();
}

function subjectsMatch(target: string[], registry: string[]) {
  if (!target.length || target.length !== registry.length) return false;
  return target.every((subject, index) => subject === registry[index]);
}

function yearStart(value: unknown) {
  return normalizedText(value).match(/\b((?:19|20)\d{2})\b/)?.[1] || "";
}

function evidenceTextIsUncertain(value: unknown) {
  return /\b(uncertain|unknown|unsure|not sure|cannot confirm|ambiguous|maybe|possibly|exact type uncertain)\b/i.test(
    String(value || ""),
  );
}

function meaningfulTokens(value: unknown) {
  return normalizedText(value)
    .replace(/\b(?:19|20)\d{2}\s+(?:\d{2}|(?:19|20)\d{2})\b/g, " ")
    .replace(/\b(?:19|20)\d{2}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
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

function parallelSignature(value: unknown) {
  if (isBaseParallel(value)) return "base";
  return [...new Set(
    normalizedText(value)
      .replace(/\bcracked\s+ice\b/g, "ice")
      .replace(/\bfoil\b/g, "holo")
      .replace(/\bx[-\s]*fractor\b/g, "xfractor")
      .split(" ")
      .filter(Boolean)
      .filter(
        (token) =>
          ![
            "prism",
            "prizm",
            "prizms",
            "parallel",
            "variation",
            "rookie",
            "card",
          ].includes(token),
      ),
  )].sort().join(" ");
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

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Trusted holdout Registry lookup requires Supabase service-role access.");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function result(reason: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({
    ok: true,
    resolver: "trustedHoldoutRegistryBootstrapFast",
    resolverStatus: "internal_set_present_no_exact_match",
    status: "set_present_no_exact_match",
    reasons: [reason],
    candidateCount: 0,
    registryIdentityId: null,
    registryFingerprintSha256: null,
    lockedFields: null,
    ...extra,
  });
}

async function chunkedInSelect(params: {
  client: any;
  table: string;
  select: string;
  column: string;
  ids: string[];
}) {
  const rows: any[] = [];
  for (let start = 0; start < params.ids.length; start += DETAIL_CHUNK_SIZE) {
    const ids = params.ids.slice(start, start + DETAIL_CHUNK_SIZE);
    if (!ids.length) continue;
    const query = await params.client
      .from(params.table)
      .select(params.select)
      .in(params.column, ids);
    if (query.error) return { data: [] as any[], error: query.error };
    rows.push(...(query.data || []));
  }
  return { data: rows, error: null as any };
}

async function activeCardsForNumber(
  client: any,
  cardNumber: string,
  activeVersionIds: string[],
) {
  const rows: any[] = [];
  for (let start = 0; start < activeVersionIds.length; start += VERSION_CHUNK_SIZE) {
    const versions = activeVersionIds.slice(start, start + VERSION_CHUNK_SIZE);
    if (!versions.length) continue;
    const query = await client
      .from("checklist_cards")
      .select(
        "id,release_id,version_id,set_id,card_number,normalized_card_number,variation,autograph_status,memorabilia_status",
      )
      .eq("normalized_card_number", cardNumber)
      .in("version_id", versions)
      .limit(MAX_ACTIVE_CARD_ROWS + 1);
    if (query.error) return { data: [] as any[], error: query.error, overflow: false };
    rows.push(...(query.data || []));
    if (rows.length > MAX_ACTIVE_CARD_ROWS) {
      return { data: [] as any[], error: null as any, overflow: true };
    }
  }
  return { data: rows, error: null as any, overflow: false };
}

export async function POST(req: NextRequest) {
  try {
    const sentinelMacRequest = isValidInstaCompSentinelArchiveRequest(req);
    const actor = sentinelMacRequest
      ? {
          type: "admin" as const,
          storeId: getActiveStoreId(),
          sellerAccountId: null,
        }
      : await requireInstaCompJobActor(req);
    if (!sentinelMacRequest) {
      assertTrustedInstaCompMutationRequest({ request: req, actor });
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const player = normalizedSubjects(body.player);
    const cardNumber = normalizedCardNumber(body.cardNumber);
    if (
      !player.length ||
      !cardNumber ||
      evidenceTextIsUncertain(body.player) ||
      evidenceTextIsUncertain(body.cardNumber)
    ) {
      return result("trusted_holdout_requires_exact_player_and_card_number", {
        resolverStatus: "input_incomplete",
        status: "input_incomplete",
      });
    }

    const supabase = serviceClient();
    const versions = await supabase
      .from("checklist_versions")
      .select("id")
      .eq("is_active", true)
      .eq("status", "live")
      .limit(5000);
    if (versions.error) {
      return result(`trusted_holdout_active_version_lookup_failed:${String(versions.error.code || "unknown")}`, {
        resolverStatus: "lookup_unavailable",
        status: "lookup_unavailable",
      });
    }
    const activeVersionIds = (versions.data || [])
      .map((row: any) => String(row.id || ""))
      .filter(Boolean);
    if (!activeVersionIds.length) {
      return result("trusted_holdout_no_active_registry_versions", {
        resolverStatus: "lookup_unavailable",
        status: "lookup_unavailable",
      });
    }

    const cardResult = await activeCardsForNumber(supabase, cardNumber, activeVersionIds);
    if (cardResult.error) {
      return result(`trusted_holdout_active_card_lookup_failed:${String(cardResult.error.code || "unknown")}`, {
        resolverStatus: "lookup_unavailable",
        status: "lookup_unavailable",
      });
    }
    if (cardResult.overflow) {
      return result("trusted_holdout_active_card_scope_exceeded_safe_bound", {
        resolverStatus: "lookup_unavailable",
        status: "lookup_unavailable",
      });
    }
    const cards = cardResult.data || [];
    if (!cards.length) {
      return result("trusted_holdout_card_number_absent_from_active_registry");
    }

    const unique = (values: unknown[]) =>
      Array.from(new Set(values.map((value) => String(value || "")).filter(Boolean)));
    const cardIds = unique(cards.map((card: any) => card.id));
    const releaseIds = unique(cards.map((card: any) => card.release_id));
    const setIds = unique(cards.map((card: any) => card.set_id));

    const [playerResult, teamResult, identityResult, releaseResult, setResult] =
      await Promise.all([
        chunkedInSelect({
          client: supabase,
          table: "checklist_card_players",
          select: "card_id,display_order,player:checklist_players(canonical_name)",
          column: "card_id",
          ids: cardIds,
        }),
        chunkedInSelect({
          client: supabase,
          table: "checklist_card_teams",
          select: "card_id,display_order,team:checklist_teams(canonical_name)",
          column: "card_id",
          ids: cardIds,
        }),
        chunkedInSelect({
          client: supabase,
          table: "checklist_card_identities",
          select:
            "id,card_id,fingerprint_sha256,variation,autograph_status,memorabilia_status,parallel:checklist_parallels(name,serial_run)",
          column: "card_id",
          ids: cardIds,
        }),
        chunkedInSelect({
          client: supabase,
          table: "checklist_releases",
          select:
            "id,product_name,release_year,season,manufacturer:checklist_manufacturers(name),brand:checklist_brands(name),sport:checklist_sports(name),league:checklist_leagues(name)",
          column: "id",
          ids: releaseIds,
        }),
        chunkedInSelect({
          client: supabase,
          table: "checklist_sets",
          select: "id,name,release_id,version_id",
          column: "id",
          ids: setIds,
        }),
      ]);

    const detailError =
      playerResult.error ||
      teamResult.error ||
      identityResult.error ||
      releaseResult.error ||
      setResult.error;
    if (detailError) {
      return result(`trusted_holdout_active_detail_lookup_failed:${String(detailError.code || "unknown")}`, {
        resolverStatus: "lookup_unavailable",
        status: "lookup_unavailable",
      });
    }

    const groupByCard = (rows: any[]) => {
      const grouped = new Map<string, any[]>();
      for (const row of rows || []) {
        const key = String(row.card_id);
        const bucket = grouped.get(key) || [];
        bucket.push(row);
        grouped.set(key, bucket);
      }
      return grouped;
    };
    const playersByCard = groupByCard(playerResult.data || []);
    const teamsByCard = groupByCard(teamResult.data || []);
    const identitiesByCard = groupByCard(identityResult.data || []);
    const releaseById = new Map(
      (releaseResult.data || []).map((row: any) => [String(row.id), row]),
    );
    const setById = new Map(
      (setResult.data || []).map((row: any) => [String(row.id), row]),
    );

    const targetYear = yearStart(body.year);
    const targetBrand = normalizedText(body.brand || body.manufacturer);
    const targetSetTokens = evidenceTextIsUncertain(body.setName)
      ? []
      : meaningfulTokens(body.setName);
    const targetTeam = normalizedText(body.team);
    const targetSport = normalizedText(body.sport);
    const targetLeague = normalizedText(body.league);
    const targetVariation = normalizedText(body.variation);
    const targetParallelRaw = evidenceTextIsUncertain(body.parallel)
      ? ""
      : normalizedText(body.parallel);
    const targetParallel = parallelSignature(targetParallelRaw);
    const targetSerialRun = String(body.serialNumber || "").match(/\/(\d{1,7})\b/)?.[1] || null;
    const targetAuto = body.isAuto === true;
    const targetRelic = body.isRelic === true;

    const strictMatches = new Map<string, any>();
    const relaxedMatches = new Map<string, any>();

    for (const card of cards) {
      const registryPlayers = normalizedSubjects(
        (playersByCard.get(String(card.id)) || [])
          .map((link: any) => link?.player?.canonical_name)
          .filter(Boolean)
          .join(" / "),
      );
      if (!subjectsMatch(player, registryPlayers)) continue;

      const release = record(releaseById.get(String(card.release_id)));
      const set = record(setById.get(String(card.set_id)));
      const releaseYear = release.release_year || release.season || null;
      const manufacturer = release.manufacturer?.name || null;
      const rawBrand = release.brand?.name || null;
      const product = release.product_name || null;
      const rawSetName = set.name || null;
      const brand = rawBrand || manufacturer || product || null;
      const setName = rawSetName || product || null;
      const sport = release.sport?.name || null;
      const league = release.league?.name || null;

      if (!yearStart(releaseYear) || !brand || !meaningfulTokens(setName).length) continue;
      if (targetSport && normalizedText(sport) !== targetSport) continue;
      if (targetLeague && normalizedText(league) !== targetLeague) continue;

      const teams = (teamsByCard.get(String(card.id)) || [])
        .map((link: any) => link?.team?.canonical_name)
        .filter(Boolean);
      if (targetTeam && !teams.some((team: string) => normalizedText(team) === targetTeam)) {
        continue;
      }

      const releaseEvidenceMatches = (() => {
        if (targetYear && yearStart(releaseYear) !== targetYear) return false;
        if (
          targetBrand &&
          !normalizedText([manufacturer, rawBrand, product, rawSetName].filter(Boolean).join(" ")).includes(targetBrand)
        ) {
          return false;
        }
        if (targetSetTokens.length) {
          const registrySetTokens = new Set(
            meaningfulTokens([rawBrand, product, rawSetName].filter(Boolean).join(" ")),
          );
          if (!targetSetTokens.every((token) => registrySetTokens.has(token))) return false;
        }
        return true;
      })();

      for (const identity of identitiesByCard.get(String(card.id)) || []) {
        const fingerprint = String(identity.fingerprint_sha256 || "").trim().toLowerCase();
        const identityId = String(identity.id || "").trim();
        if (!fingerprint || !identityId) continue;

        const parallelName = identity.parallel?.name || "Base";
        const serialRun = Number(identity.parallel?.serial_run || 0) || null;
        if (targetSerialRun) {
          if (serialRun !== Number(targetSerialRun)) continue;
          if (!targetParallelRaw || targetParallel === "base") continue;
          if (parallelSignature(parallelName) !== targetParallel) continue;
        } else {
          if (serialRun) continue;
          if (targetParallelRaw) {
            if (targetParallel === "base") {
              if (!isBaseParallel(parallelName)) continue;
            } else if (parallelSignature(parallelName) !== targetParallel) {
              continue;
            }
          } else if (!isBaseParallel(parallelName)) {
            continue;
          }
        }

        const variation = normalizedText(identity.variation || card.variation);
        if (targetVariation && variation !== targetVariation) continue;
        const registryAuto = statusIsPositive(
          identity.autograph_status || card.autograph_status,
          "auto",
        );
        const registryRelic = statusIsPositive(
          identity.memorabilia_status || card.memorabilia_status,
          "relic",
        );
        if (registryAuto !== targetAuto || registryRelic !== targetRelic) continue;

        const candidate = {
          identityId,
          fingerprintSha256: fingerprint,
          manufacturer,
          brand,
          player: registryPlayers.join(" / "),
          year: releaseYear,
          setName,
          cardNumber: card.card_number || null,
          parallel: parallelName,
          variation: identity.variation || card.variation || null,
          serialRun,
          team: teams.join(" / ") || null,
          sport,
          league,
          isAuto: registryAuto,
          isRelic: registryRelic,
        };
        relaxedMatches.set(fingerprint, candidate);
        if (releaseEvidenceMatches) strictMatches.set(fingerprint, candidate);
      }
    }

    let match: any | null = null;
    let bootstrapMode: "strict_release_evidence" | "unique_identity_release_recovery" | null = null;
    if (strictMatches.size === 1) {
      match = [...strictMatches.values()][0];
      bootstrapMode = "strict_release_evidence";
    } else if (strictMatches.size === 0 && relaxedMatches.size === 1) {
      match = [...relaxedMatches.values()][0];
      bootstrapMode = "unique_identity_release_recovery";
    }

    if (!match) {
      return result(
        strictMatches.size > 1
          ? "trusted_holdout_registry_identity_ambiguous_under_available_release_truth"
          : relaxedMatches.size > 1
            ? "trusted_holdout_registry_identity_ambiguous_after_release_coordinate_recovery"
            : "trusted_holdout_registry_no_identity_matches_player_card_variant_truth",
        {
          candidateCount: Math.max(strictMatches.size, relaxedMatches.size),
          strictCandidateCount: strictMatches.size,
          relaxedCandidateCount: relaxedMatches.size,
        },
      );
    }

    return NextResponse.json({
      ok: true,
      resolver: "trustedHoldoutRegistryBootstrapFast",
      resolverStatus: "internal_exact_match",
      status: "exact_match",
      reasons: [
        bootstrapMode === "strict_release_evidence"
          ? "trusted_holdout_available_operator_truth_resolved_one_unique_active_registry_identity"
          : "trusted_holdout_stale_release_coordinates_recovered_one_unique_active_registry_identity",
        "bootstrap_identity_requires_normal_v20_registry_and_physical_revalidation_before_benchmark_admission",
      ],
      bootstrapMode,
      candidateCount: 1,
      strictCandidateCount: strictMatches.size,
      relaxedCandidateCount: relaxedMatches.size,
      registryIdentityId: match.identityId,
      identityId: match.identityId,
      registryFingerprintSha256: match.fingerprintSha256,
      fingerprintSha256: match.fingerprintSha256,
      lockedFields: {
        sport: match.sport || null,
        league: match.league || null,
        year: match.year || null,
        manufacturer: match.manufacturer || null,
        brand: match.brand || null,
        setName: match.setName || null,
        player: match.player || null,
        team: match.team || null,
        cardNumber: match.cardNumber || null,
        parallel: match.parallel || null,
        variation: match.variation || null,
        serialRun: match.serialRun || null,
        isAuto: match.isAuto,
        isRelic: match.isRelic,
      },
      identificationPath: "trusted_holdout_fast_registry_bootstrap_pending_v20_revalidation",
    });
  } catch (error) {
    console.error("Fast trusted holdout Registry bootstrap error:", error);
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Fast trusted holdout Registry bootstrap failed.",
      },
      { status: 500 },
    );
  }
}
