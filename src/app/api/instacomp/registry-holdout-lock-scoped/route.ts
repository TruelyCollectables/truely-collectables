import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireInstaCompJobActor } from "../../../../lib/instacomp-job-server";
import { assertTrustedInstaCompMutationRequest } from "../../../../lib/instacomp-mutation-security";
import { isValidInstaCompSentinelArchiveRequest } from "../../../../lib/instacomp-sentinel-auth";
import { getActiveStoreId } from "../../../../lib/stores";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const QUERY_CHUNK_SIZE = 80;
const MAX_RELEASE_ROWS = 2000;
const MAX_SCOPED_CARD_ROWS = 250;

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
  return (
    target.length > 0 &&
    target.length === registry.length &&
    target.every((subject, index) => subject === registry[index])
  );
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

function relationName(value: any) {
  if (Array.isArray(value)) return value[0]?.name || null;
  return value?.name || null;
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

function uniqueStrings(values: unknown[]) {
  return Array.from(
    new Set(values.map((value) => String(value || "")).filter(Boolean)),
  );
}

function serviceClient(): any {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Scoped trusted holdout Registry lookup requires Supabase service-role access.",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function result(reason: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({
    ok: true,
    resolver: "trustedHoldoutRegistryBootstrapScoped",
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
  filters?: (query: any) => any;
}) {
  const rows: any[] = [];
  for (let start = 0; start < params.ids.length; start += QUERY_CHUNK_SIZE) {
    const ids = params.ids.slice(start, start + QUERY_CHUNK_SIZE);
    if (!ids.length) continue;
    let query: any = params.client
      .from(params.table)
      .select(params.select)
      .in(params.column, ids);
    if (params.filters) query = params.filters(query);
    const response: any = await query;
    if (response.error) return { data: [] as any[], error: response.error };
    rows.push(...(response.data || []));
  }
  return { data: rows, error: null as any };
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

    if (
      !player.length ||
      !cardNumber ||
      !targetYear ||
      !targetBrand ||
      !targetSetTokens.length ||
      evidenceTextIsUncertain(body.player) ||
      evidenceTextIsUncertain(body.cardNumber) ||
      evidenceTextIsUncertain(body.year) ||
      evidenceTextIsUncertain(body.brand || body.manufacturer)
    ) {
      return result("trusted_holdout_scoped_requires_v20_ready_release_identity", {
        resolverStatus: "input_incomplete",
        status: "input_incomplete",
      });
    }

    const supabase: any = serviceClient();
    const releaseSelect =
      "id,product_name,release_year,season,manufacturer:checklist_manufacturers(name),brand:checklist_brands(name),sport:checklist_sports(name),league:checklist_leagues(name)";
    const [yearResult, seasonResult]: any[] = await Promise.all([
      supabase
        .from("checklist_releases")
        .select(releaseSelect)
        .eq("release_year", targetYear)
        .limit(MAX_RELEASE_ROWS + 1),
      supabase
        .from("checklist_releases")
        .select(releaseSelect)
        .ilike("season", `${targetYear}%`)
        .limit(MAX_RELEASE_ROWS + 1),
    ]);
    const releaseError = yearResult.error || seasonResult.error;
    if (releaseError) {
      return result(
        `trusted_holdout_scoped_release_lookup_failed:${String(
          releaseError.code || "unknown",
        )}`,
        { resolverStatus: "lookup_unavailable", status: "lookup_unavailable" },
      );
    }
    if (
      (yearResult.data || []).length > MAX_RELEASE_ROWS ||
      (seasonResult.data || []).length > MAX_RELEASE_ROWS
    ) {
      return result("trusted_holdout_scoped_release_scope_exceeded_safe_bound", {
        resolverStatus: "lookup_unavailable",
        status: "lookup_unavailable",
      });
    }

    const releaseById = new Map<string, any>();
    for (const value of [...(yearResult.data || []), ...(seasonResult.data || [])]) {
      const release: any = value;
      const manufacturer = relationName(release.manufacturer);
      const rawBrand = relationName(release.brand);
      const product = release.product_name || null;
      const sport = relationName(release.sport);
      const league = relationName(release.league);
      const searchableBrand = normalizedText(
        [manufacturer, rawBrand, product].filter(Boolean).join(" "),
      );
      if (!searchableBrand.includes(targetBrand)) continue;
      if (targetSport && normalizedText(sport) !== targetSport) continue;
      if (targetLeague && normalizedText(league) !== targetLeague) continue;
      releaseById.set(String(release.id), release);
    }

    const releaseIds = [...releaseById.keys()];
    if (!releaseIds.length) {
      return result("trusted_holdout_scoped_release_not_found");
    }

    const versionResult = await chunkedInSelect({
      client: supabase,
      table: "checklist_versions",
      select: "id,release_id,is_active,status",
      column: "release_id",
      ids: releaseIds,
      filters: (query) => query.eq("is_active", true).eq("status", "live"),
    });
    if (versionResult.error) {
      return result(
        `trusted_holdout_scoped_version_lookup_failed:${String(
          versionResult.error.code || "unknown",
        )}`,
        { resolverStatus: "lookup_unavailable", status: "lookup_unavailable" },
      );
    }

    const versionIds = uniqueStrings(
      (versionResult.data || []).map((row: any) => row.id),
    );
    if (!versionIds.length) {
      return result("trusted_holdout_scoped_no_active_release_version");
    }

    const setResult = await chunkedInSelect({
      client: supabase,
      table: "checklist_sets",
      select: "id,name,normalized_name,release_id,version_id",
      column: "version_id",
      ids: versionIds,
    });
    if (setResult.error) {
      return result(
        `trusted_holdout_scoped_set_lookup_failed:${String(
          setResult.error.code || "unknown",
        )}`,
        { resolverStatus: "lookup_unavailable", status: "lookup_unavailable" },
      );
    }

    const scopedSets = (setResult.data || []).filter((set: any) => {
      const release: any = releaseById.get(String(set.release_id));
      if (!release) return false;
      const registryTokens = new Set(
        meaningfulTokens(
          [relationName(release.brand), release.product_name, set.name]
            .filter(Boolean)
            .join(" "),
        ),
      );
      return targetSetTokens.every((token) => registryTokens.has(token));
    });
    if (!scopedSets.length) {
      return result("trusted_holdout_scoped_set_not_found");
    }

    const setsByVersion = new Map<string, string[]>();
    for (const set of scopedSets) {
      const versionId = String(set.version_id || "");
      const setId = String(set.id || "");
      if (!versionId || !setId) continue;
      const bucket = setsByVersion.get(versionId) || [];
      bucket.push(setId);
      setsByVersion.set(versionId, bucket);
    }

    const cardsById = new Map<string, any>();
    for (const [versionId, rawSetIds] of setsByVersion) {
      const setIds = uniqueStrings(rawSetIds);
      for (let start = 0; start < setIds.length; start += QUERY_CHUNK_SIZE) {
        const ids = setIds.slice(start, start + QUERY_CHUNK_SIZE);
        const cardResult: any = await supabase
          .from("checklist_cards")
          .select(
            "id,release_id,version_id,set_id,card_number,normalized_card_number,variation,autograph_status,memorabilia_status",
          )
          .eq("version_id", versionId)
          .in("set_id", ids)
          .eq("normalized_card_number", cardNumber)
          .limit(MAX_SCOPED_CARD_ROWS + 1);
        if (cardResult.error) {
          return result(
            `trusted_holdout_scoped_card_lookup_failed:${String(
              cardResult.error.code || "unknown",
            )}`,
            { resolverStatus: "lookup_unavailable", status: "lookup_unavailable" },
          );
        }
        for (const card of cardResult.data || []) {
          cardsById.set(String(card.id), card);
          if (cardsById.size > MAX_SCOPED_CARD_ROWS) {
            return result("trusted_holdout_scoped_card_scope_exceeded_safe_bound", {
              resolverStatus: "lookup_unavailable",
              status: "lookup_unavailable",
            });
          }
        }
      }
    }

    const cards = [...cardsById.values()];
    if (!cards.length) {
      return result("trusted_holdout_scoped_card_number_absent_from_release_scope");
    }

    const cardIds = uniqueStrings(cards.map((card: any) => card.id));
    const [playerResult, teamResult, identityResult] = await Promise.all([
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
    ]);
    const detailError =
      playerResult.error || teamResult.error || identityResult.error;
    if (detailError) {
      return result(
        `trusted_holdout_scoped_detail_lookup_failed:${String(
          detailError.code || "unknown",
        )}`,
        { resolverStatus: "lookup_unavailable", status: "lookup_unavailable" },
      );
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
    const setById = new Map<string, any>(
      scopedSets.map((set: any) => [String(set.id), set]),
    );

    const matches = new Map<string, any>();
    for (const card of cards) {
      const registryPlayers = normalizedSubjects(
        (playersByCard.get(String(card.id)) || [])
          .map((link: any) => relationName(link.player))
          .filter(Boolean)
          .join(" / "),
      );
      if (!subjectsMatch(player, registryPlayers)) continue;

      const release: any = releaseById.get(String(card.release_id));
      const set: any = setById.get(String(card.set_id));
      if (!release || !set) continue;
      const releaseYear = release.release_year || release.season || null;
      const manufacturer = relationName(release.manufacturer);
      const rawBrand = relationName(release.brand);
      const product = release.product_name || null;
      const rawSetName = set.name || null;
      const brand = rawBrand || manufacturer || product || null;
      const setName = rawSetName || product || null;
      const sport = relationName(release.sport);
      const league = relationName(release.league);

      const teams = (teamsByCard.get(String(card.id)) || [])
        .map((link: any) => relationName(link.team))
        .filter(Boolean);
      if (
        targetTeam &&
        !teams.some((team: string) => normalizedText(team) === targetTeam)
      ) {
        continue;
      }

      for (const identity of identitiesByCard.get(String(card.id)) || []) {
        const fingerprint = String(identity.fingerprint_sha256 || "")
          .trim()
          .toLowerCase();
        const identityId = String(identity.id || "").trim();
        if (!fingerprint || !identityId) continue;

        const parallelName = relationName(identity.parallel) || "Base";
        const parallelRow = Array.isArray(identity.parallel)
          ? identity.parallel[0]
          : identity.parallel;
        const serialRun = Number(parallelRow?.serial_run || 0) || null;
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

        matches.set(fingerprint, {
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
        });
      }
    }

    if (matches.size !== 1) {
      return result(
        matches.size > 1
          ? "trusted_holdout_scoped_registry_identity_ambiguous"
          : "trusted_holdout_scoped_registry_no_identity_matches_visible_truth",
        { candidateCount: matches.size },
      );
    }

    const match = [...matches.values()][0];
    return NextResponse.json({
      ok: true,
      resolver: "trustedHoldoutRegistryBootstrapScoped",
      resolverStatus: "internal_exact_match",
      status: "exact_match",
      reasons: [
        "trusted_holdout_release_scoped_query_resolved_one_unique_active_registry_identity",
        "bootstrap_identity_requires_normal_v20_registry_and_physical_revalidation_before_benchmark_admission",
      ],
      bootstrapMode: "strict_release_evidence_scoped",
      candidateCount: 1,
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
        "trusted_holdout_release_scoped_registry_bootstrap_pending_v20_revalidation",
    });
  } catch (error) {
    console.error("Scoped trusted holdout Registry bootstrap error:", error);
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Scoped trusted holdout Registry bootstrap failed.",
      },
      { status: 500 },
    );
  }
}
