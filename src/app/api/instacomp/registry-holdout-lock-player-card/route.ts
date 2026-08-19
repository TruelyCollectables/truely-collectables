import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireInstaCompJobActor } from "../../../../lib/instacomp-job-server";
import { assertTrustedInstaCompMutationRequest } from "../../../../lib/instacomp-mutation-security";
import { isValidInstaCompSentinelArchiveRequest } from "../../../../lib/instacomp-sentinel-auth";
import { getActiveStoreId } from "../../../../lib/stores";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PLAYER_CARD_CANDIDATES = 1500;

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
  return Array.from(
    new Set(
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
    ),
  )
    .sort()
    .join(" ");
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

function serviceClient(): any {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Trusted player/card holdout Registry lookup requires Supabase service-role access.");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function result(reason: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({
    ok: true,
    resolver: "trustedHoldoutRegistryPlayerCardBootstrap",
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

async function candidatesForSubjects(
  client: any,
  subjects: string[],
  cardNumber: string,
) {
  const bySubject: Array<Map<string, any[]>> = [];
  for (const subject of subjects) {
    const response = await client.rpc("instacomp_holdout_player_card_candidates_v1", {
      p_player: subject,
      p_card_number: cardNumber,
      p_limit: MAX_PLAYER_CARD_CANDIDATES,
    });
    if (response.error) {
      return { data: [] as any[], error: response.error, overflow: false };
    }
    const rows = response.data || [];
    const cards = new Map<string, any[]>();
    for (const row of rows) {
      const cardId = String(row.card_id || "");
      if (!cardId) continue;
      const bucket = cards.get(cardId) || [];
      bucket.push(row);
      cards.set(cardId, bucket);
    }
    if (cards.size > MAX_PLAYER_CARD_CANDIDATES) {
      return { data: [] as any[], error: null as any, overflow: true };
    }
    bySubject.push(cards);
  }

  if (!bySubject.length) {
    return { data: [] as any[], error: null as any, overflow: false };
  }

  const commonCardIds = [...bySubject[0].keys()].filter((cardId) =>
    bySubject.every((cards) => cards.has(cardId)),
  );
  if (commonCardIds.length > MAX_PLAYER_CARD_CANDIDATES) {
    return { data: [] as any[], error: null as any, overflow: true };
  }

  const identities = new Map<string, any>();
  for (const cardId of commonCardIds) {
    for (const row of bySubject[0].get(cardId) || []) {
      const identityId = String(row.identity_id || "");
      if (identityId) identities.set(identityId, row);
    }
  }
  return { data: [...identities.values()], error: null as any, overflow: false };
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
    const candidateResult = await candidatesForSubjects(supabase, player, cardNumber);
    if (candidateResult.error) {
      return result(
        `trusted_holdout_player_card_candidate_lookup_failed:${String(
          candidateResult.error.code || "unknown",
        )}`,
        { resolverStatus: "lookup_unavailable", status: "lookup_unavailable" },
      );
    }
    if (candidateResult.overflow) {
      return result("trusted_holdout_player_card_scope_exceeded_safe_bound", {
        resolverStatus: "lookup_unavailable",
        status: "lookup_unavailable",
      });
    }
    const candidates = candidateResult.data || [];
    if (!candidates.length) {
      return result("trusted_holdout_player_card_absent_from_active_registry");
    }

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
    const targetSerialRun =
      String(body.serialNumber || "").match(/\/(\d{1,7})\b/)?.[1] || null;
    const targetAuto = body.isAuto === true;
    const targetRelic = body.isRelic === true;

    const strictMatches = new Map<string, any>();
    const relaxedMatches = new Map<string, any>();

    for (const row of candidates) {
      const registryPlayers = normalizedSubjects(
        Array.isArray(row.players) ? row.players.join(" / ") : row.players,
      );
      if (!subjectsMatch(player, registryPlayers)) continue;

      const releaseYear = row.release_year || row.season || null;
      const manufacturer = row.manufacturer || null;
      const rawBrand = row.brand || null;
      const product = row.product_name || null;
      const rawSetName = row.set_name || null;
      const brand = rawBrand || manufacturer || product || null;
      const setName = rawSetName || product || null;
      const sport = row.sport || null;
      const league = row.league || null;

      if (!yearStart(releaseYear) || !brand || !meaningfulTokens(setName).length) continue;
      if (targetSport && normalizedText(sport) !== targetSport) continue;
      if (targetLeague && normalizedText(league) !== targetLeague) continue;

      const teams = Array.isArray(row.teams) ? row.teams.filter(Boolean) : [];
      if (
        targetTeam &&
        !teams.some((team: string) => normalizedText(team) === targetTeam)
      ) {
        continue;
      }

      const releaseEvidenceMatches = (() => {
        if (targetYear && yearStart(releaseYear) !== targetYear) return false;
        if (
          targetBrand &&
          !normalizedText(
            [manufacturer, rawBrand, product, rawSetName].filter(Boolean).join(" "),
          ).includes(targetBrand)
        ) {
          return false;
        }
        if (targetSetTokens.length) {
          const registrySetTokens = new Set(
            meaningfulTokens([rawBrand, product, rawSetName].filter(Boolean).join(" ")),
          );
          if (!targetSetTokens.every((token) => registrySetTokens.has(token))) {
            return false;
          }
        }
        return true;
      })();

      const fingerprint = String(row.fingerprint_sha256 || "").trim().toLowerCase();
      const identityId = String(row.identity_id || "").trim();
      if (!fingerprint || !identityId) continue;

      const parallelName = row.parallel || "Base";
      const serialRun = Number(row.serial_run || 0) || null;
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

      const variation = normalizedText(row.variation);
      if (targetVariation && variation !== targetVariation) continue;
      const registryAuto = statusIsPositive(row.autograph_status, "auto");
      const registryRelic = statusIsPositive(row.memorabilia_status, "relic");
      if (registryAuto !== targetAuto || registryRelic !== targetRelic) continue;

      const candidate = {
        identityId,
        fingerprintSha256: fingerprint,
        manufacturer,
        brand,
        player: registryPlayers.join(" / "),
        year: releaseYear,
        setName,
        cardNumber: row.card_number || null,
        parallel: parallelName,
        variation: row.variation || null,
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

    let match: any | null = null;
    let bootstrapMode:
      | "strict_release_evidence"
      | "unique_identity_release_recovery"
      | null = null;
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
      resolver: "trustedHoldoutRegistryPlayerCardBootstrap",
      resolverStatus: "internal_exact_match",
      status: "exact_match",
      reasons: [
        "trusted_holdout_indexed_player_card_query_resolved_one_unique_active_registry_identity",
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
      identificationPath:
        "trusted_holdout_indexed_player_card_registry_bootstrap_pending_v20_revalidation",
    });
  } catch (error) {
    console.error("Indexed player/card trusted holdout Registry bootstrap error:", error);
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Indexed player/card trusted holdout Registry bootstrap failed.",
      },
      { status: 500 },
    );
  }
}
