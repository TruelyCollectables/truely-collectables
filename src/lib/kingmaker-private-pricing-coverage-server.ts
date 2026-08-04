import { createClient } from "@supabase/supabase-js";
import {
  InstaCompJobServerError,
  type InstaCompJobActor,
} from "./instacomp-job-server";

export const KINGMAKER_PRIVATE_PRICING_GAP_TYPES = [
  "missing_release",
  "checklist_pending",
  "set_gap",
  "identity_gap",
] as const;

export type KingmakerPrivatePricingGapType =
  (typeof KINGMAKER_PRIVATE_PRICING_GAP_TYPES)[number];

export type KingmakerPrivatePricingCoverageInput = {
  limit?: unknown;
  offset?: unknown;
  gapType?: unknown;
  sport?: unknown;
  search?: unknown;
};

export type KingmakerPrivatePricingCoverageRow = {
  rank: number;
  gapType: KingmakerPrivatePricingGapType;
  sport: string;
  releaseYear: string;
  manufacturer: string;
  product: string;
  setName: string;
  potentialUnlock: number;
  unmatchedRows: number;
  ambiguousRows: number;
  distinctCardNumbers: number;
  guideCount: number;
  averageParseConfidence: number | null;
  latestReferenceDate: string | null;
  registryReleaseCount: number;
  activeVersionCount: number;
  matchingSetCount: number;
  activeIdentityCount: number;
  recommendedAction: string;
};

export type KingmakerPrivatePricingCoverage = {
  generatedAt: string;
  boundary: "aggregate_private_reference_only";
  filters: {
    gapType: KingmakerPrivatePricingGapType | null;
    sport: string | null;
    search: string | null;
  };
  summary: {
    totalGroups: number;
    unresolvedRows: number;
    unmatchedRows: number;
    ambiguousRows: number;
    missingReleaseRows: number;
    checklistPendingRows: number;
    setGapRows: number;
    identityGapRows: number;
    largestUnlock: number;
  };
  pagination: {
    limit: number;
    offset: number;
    returned: number;
    totalGroups: number;
    hasMore: boolean;
  };
  rows: KingmakerPrivatePricingCoverageRow[];
};

type JsonObject = Record<string, unknown>;

function databaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new InstaCompJobServerError(
      "Private pricing coverage is not configured.",
      503,
      "KINGMAKER_PRIVATE_PRICING_COVERAGE_NOT_CONFIGURED",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function requireAdministrator(actor: InstaCompJobActor) {
  if (actor.type !== "admin") {
    throw new InstaCompJobServerError(
      "Administrative access is required for private pricing coverage.",
      403,
      "KINGMAKER_PRIVATE_PRICING_COVERAGE_ADMIN_REQUIRED",
    );
  }
}

function integer(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  return Number.isInteger(parsed)
    ? Math.max(minimum, Math.min(maximum, parsed))
    : fallback;
}

function text(value: unknown, maximum: number) {
  return typeof value === "string"
    ? value.trim().slice(0, maximum) || null
    : null;
}

function gapType(value: unknown): KingmakerPrivatePricingGapType | null {
  const normalized = text(value, 40)?.toLowerCase().replaceAll("-", "_") || null;
  return KINGMAKER_PRIVATE_PRICING_GAP_TYPES.includes(
    normalized as KingmakerPrivatePricingGapType,
  )
    ? (normalized as KingmakerPrivatePricingGapType)
    : null;
}

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InstaCompJobServerError(
      `Private pricing coverage returned an invalid ${label}.`,
      500,
      "KINGMAKER_PRIVATE_PRICING_COVERAGE_INVALID_RESPONSE",
    );
  }
  return value as JsonObject;
}

function finiteNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function string(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function parseCoverage(value: unknown): KingmakerPrivatePricingCoverage {
  const payload = object(value, "payload");
  const filters = object(payload.filters, "filters");
  const summary = object(payload.summary, "summary");
  const pagination = object(payload.pagination, "pagination");
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  const boundary = string(payload.boundary);
  if (boundary !== "aggregate_private_reference_only") {
    throw new InstaCompJobServerError(
      "Private pricing coverage boundary verification failed.",
      500,
      "KINGMAKER_PRIVATE_PRICING_COVERAGE_BOUNDARY_INVALID",
    );
  }

  return {
    generatedAt: string(payload.generatedAt, new Date().toISOString()),
    boundary,
    filters: {
      gapType: gapType(filters.gapType),
      sport: text(filters.sport, 80),
      search: text(filters.search, 160),
    },
    summary: {
      totalGroups: finiteNumber(summary.totalGroups),
      unresolvedRows: finiteNumber(summary.unresolvedRows),
      unmatchedRows: finiteNumber(summary.unmatchedRows),
      ambiguousRows: finiteNumber(summary.ambiguousRows),
      missingReleaseRows: finiteNumber(summary.missingReleaseRows),
      checklistPendingRows: finiteNumber(summary.checklistPendingRows),
      setGapRows: finiteNumber(summary.setGapRows),
      identityGapRows: finiteNumber(summary.identityGapRows),
      largestUnlock: finiteNumber(summary.largestUnlock),
    },
    pagination: {
      limit: finiteNumber(pagination.limit, 100),
      offset: finiteNumber(pagination.offset),
      returned: finiteNumber(pagination.returned),
      totalGroups: finiteNumber(pagination.totalGroups),
      hasMore: pagination.hasMore === true,
    },
    rows: rows.map((value, index) => {
      const row = object(value, `row ${index + 1}`);
      const parsedGapType = gapType(row.gapType);
      if (!parsedGapType) {
        throw new InstaCompJobServerError(
          "Private pricing coverage returned an unsupported gap type.",
          500,
          "KINGMAKER_PRIVATE_PRICING_COVERAGE_GAP_INVALID",
        );
      }
      return {
        rank: finiteNumber(row.rank, index + 1),
        gapType: parsedGapType,
        sport: string(row.sport, "Unknown"),
        releaseYear: string(row.releaseYear, "Unknown"),
        manufacturer: string(row.manufacturer, "Unknown"),
        product: string(row.product, "Unknown"),
        setName: string(row.setName, "Base / Unspecified"),
        potentialUnlock: finiteNumber(row.potentialUnlock),
        unmatchedRows: finiteNumber(row.unmatchedRows),
        ambiguousRows: finiteNumber(row.ambiguousRows),
        distinctCardNumbers: finiteNumber(row.distinctCardNumbers),
        guideCount: finiteNumber(row.guideCount),
        averageParseConfidence: nullableNumber(row.averageParseConfidence),
        latestReferenceDate: text(row.latestReferenceDate, 40),
        registryReleaseCount: finiteNumber(row.registryReleaseCount),
        activeVersionCount: finiteNumber(row.activeVersionCount),
        matchingSetCount: finiteNumber(row.matchingSetCount),
        activeIdentityCount: finiteNumber(row.activeIdentityCount),
        recommendedAction: string(row.recommendedAction),
      } satisfies KingmakerPrivatePricingCoverageRow;
    }),
  };
}

export async function getKingmakerPrivatePricingCoverage(
  actor: InstaCompJobActor,
  input: KingmakerPrivatePricingCoverageInput = {},
) {
  requireAdministrator(actor);
  const limit = integer(input.limit, 100, 1, 250);
  const offset = integer(input.offset, 0, 0, 100000);
  const requestedGapType = gapType(input.gapType);
  const sport = text(input.sport, 80);
  const search = text(input.search, 160);

  const { data, error } = await databaseClient().rpc(
    "tcos_kingmaker_private_pricing_coverage_report",
    {
      p_limit: limit,
      p_offset: offset,
      p_gap_type: requestedGapType,
      p_sport: sport,
      p_search: search,
    },
  );

  if (error) {
    throw new InstaCompJobServerError(
      "Private pricing coverage could not be loaded.",
      500,
      "KINGMAKER_PRIVATE_PRICING_COVERAGE_QUERY_FAILED",
    );
  }

  return parseCoverage(data);
}
