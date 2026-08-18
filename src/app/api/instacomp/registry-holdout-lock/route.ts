import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireInstaCompJobActor } from "../../../../lib/instacomp-job-server";
import { assertTrustedInstaCompMutationRequest } from "../../../../lib/instacomp-mutation-security";
import { isValidInstaCompSentinelArchiveRequest } from "../../../../lib/instacomp-sentinel-auth";
import { getActiveStoreId } from "../../../../lib/stores";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

function canonicalField(canonicalKey: unknown, field: string) {
  const prefix = `${field}=`;
  return String(canonicalKey || "")
    .split("|")
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length)
    .replace(/^∅$/, "") || "";
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

function publicStatus(status: string) {
  if (status === "internal_exact_match") return "exact_match";
  if (status === "input_incomplete") return "input_incomplete";
  if (status === "lookup_unavailable") return "lookup_unavailable";
  return "set_present_no_exact_match";
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
      return NextResponse.json({
        ok: true,
        resolver: "trustedHoldoutRegistryBootstrap",
        resolverStatus: "input_incomplete",
        status: "input_incomplete",
        reasons: ["trusted_holdout_requires_exact_player_and_card_number"],
        candidateCount: 0,
        registryIdentityId: null,
        registryFingerprintSha256: null,
        lockedFields: null,
      });
    }

    const supabase = serviceClient();
    const versionResult = await supabase
      .from("checklist_versions")
      .select("id")
      .eq("is_active", true)
      .eq("status", "live")
      .limit(5000);
    if (versionResult.error) throw versionResult.error;
    const activeVersionIds = new Set(
      (versionResult.data || []).map((row: any) => String(row.id)).filter(Boolean),
    );

    const cardResult = await supabase
      .from("checklist_cards")
      .select(
        "id,release_id,version_id,set_id,card_number,normalized_card_number,variation,autograph_status,memorabilia_status",
      )
      .eq("normalized_card_number", cardNumber)
      .limit(1000);
    if (cardResult.error) throw cardResult.error;
    const cards = (cardResult.data || []).filter((card: any) =>
      activeVersionIds.has(String(card.version_id)),
    );
    if (!cards.length) {
      return NextResponse.json({
        ok: true,
        resolver: "trustedHoldoutRegistryBootstrap",
        resolverStatus: "internal_set_present_no_exact_match",
        status: "set_present_no_exact_match",
        reasons: ["trusted_holdout_card_number_absent_from_active_registry"],
        candidateCount: 0,
        registryIdentityId: null,
        registryFingerprintSha256: null,
        lockedFields: null,
      });
    }

    const unique = (values: unknown[]) =>
      Array.from(new Set(values.map((value) => String(value || "")).filter(Boolean)));
    const cardIds = unique(cards.map((card: any) => card.id));
    const releaseIds = unique(cards.map((card: any) => card.release_id));
    const setIds = unique(cards.map((card: any) => card.set_id));

    const [playerResult, teamResult, identityResult, releaseResult, setResult] =
      await Promise.all([
        supabase
          .from("checklist_card_players")
          .select("card_id,display_order,player:checklist_players(canonical_name)")
          .in("card_id", cardIds),
        supabase
          .from("checklist_card_teams")
          .select("card_id,display_order,team:checklist_teams(canonical_name)")
          .in("card_id", cardIds),
        supabase
          .from("checklist_card_identities")
          .select(
            "id,card_id,fingerprint_sha256,canonical_key,variation,autograph_status,memorabilia_status,configuration_exclusivity,metadata,parallel:checklist_parallels(name,serial_run)",
          )
          .in("card_id", cardIds),
        supabase
          .from("checklist_releases")
          .select(
            "id,product_name,release_year,season,manufacturer:checklist_manufacturers(name),brand:checklist_brands(name),sport:checklist_sports(name),league:checklist_leagues(name)",
          )
          .in("id", releaseIds),
        supabase
          .from("checklist_sets")
          .select("id,name,normalized_name,release_id,version_id")
          .in("id", setIds),
      ]);

    const detailError =
      playerResult.error ||
      teamResult.error ||
      identityResult.error ||
      releaseResult.error ||
      setResult.error;
    if (detailError) throw detailError;

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

    const matches = new Map<string, any>();
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
      const brand = release.brand?.name || null;
      const product = release.product_name || null;
      const setName = set.name || null;
      const sport = release.sport?.name || null;
      const league = release.league?.name || null;

      if (targetYear && yearStart(releaseYear) !== targetYear) continue;
      if (
        targetBrand &&
        !normalizedText([manufacturer, brand, product, setName].filter(Boolean).join(" ")).includes(targetBrand)
      ) {
        continue;
      }
      if (targetSetTokens.length) {
        const registrySetTokens = new Set(
          meaningfulTokens([brand, product, setName].filter(Boolean).join(" ")),
        );
        if (!targetSetTokens.every((token) => registrySetTokens.has(token))) continue;
      }
      if (targetSport && normalizedText(sport) !== targetSport) continue;
      if (targetLeague && normalizedText(league) !== targetLeague) continue;

      const teams = (teamsByCard.get(String(card.id)) || [])
        .map((link: any) => link?.team?.canonical_name)
        .filter(Boolean);
      if (
        targetTeam &&
        !teams.some((team: string) => normalizedText(team) === targetTeam)
      ) {
        continue;
      }

      for (const identity of identitiesByCard.get(String(card.id)) || []) {
        const fingerprint = String(identity.fingerprint_sha256 || "").trim().toLowerCase();
        if (!fingerprint) continue;
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
            // Missing parallel truth may bootstrap only the unique non-serial Base
            // identity. The downstream V20 physical witness must still confirm it.
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

        const languageCode = normalizedText(
          identity.metadata?.languageCode ||
            identity.metadata?.language_code ||
            canonicalField(identity.canonical_key, "language_code"),
        ) || null;
        const configurationExclusivity = normalizedText(
          identity.configuration_exclusivity ||
            canonicalField(identity.canonical_key, "configuration"),
        ) || null;

        matches.set(fingerprint, {
          identityId: String(identity.id),
          fingerprintSha256: fingerprint,
          manufacturer,
          brand,
          product,
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
          languageCode,
          configurationExclusivity,
          isAuto: registryAuto,
          isRelic: registryRelic,
        });
      }
    }

    const match = matches.size === 1 ? [...matches.values()][0] : null;
    const resolverStatus = match
      ? "internal_exact_match"
      : "internal_set_present_no_exact_match";
    const reasons = match
      ? [
          "trusted_holdout_player_card_number_and_available_operator_truth_resolved_one_unique_active_registry_identity",
          "bootstrap_identity_requires_normal_v20_registry_and_physical_revalidation_before_benchmark_admission",
        ]
      : [
          matches.size > 1
            ? "trusted_holdout_registry_identity_ambiguous"
            : "trusted_holdout_registry_no_identity_matches_available_operator_truth",
        ];

    return NextResponse.json({
      ok: true,
      resolver: "trustedHoldoutRegistryBootstrap",
      resolverStatus,
      status: publicStatus(resolverStatus),
      reasons,
      candidateCount: matches.size,
      registryIdentityId: match?.identityId || null,
      identityId: match?.identityId || null,
      registryFingerprintSha256: match?.fingerprintSha256 || null,
      fingerprintSha256: match?.fingerprintSha256 || null,
      lockedFields: match
        ? {
            sport: match.sport || null,
            league: match.league || null,
            year: match.year || null,
            manufacturer: match.manufacturer || null,
            brand: match.brand || null,
            setName: match.setName || match.product || null,
            player: match.player || null,
            team: match.team || null,
            cardNumber: match.cardNumber || null,
            parallel: match.parallel || null,
            variation: match.variation || null,
            serialRun: match.serialRun || null,
            isAuto: match.isAuto,
            isRelic: match.isRelic,
          }
        : null,
      identificationPath: match
        ? "trusted_holdout_registry_bootstrap_pending_v20_revalidation"
        : "review_required",
    });
  } catch (error) {
    console.error("Trusted holdout Registry bootstrap error:", error);
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Trusted holdout Registry bootstrap failed.",
      },
      { status: 500 },
    );
  }
}
