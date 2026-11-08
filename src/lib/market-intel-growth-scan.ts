import "server-only";

import { growthProfessionalCardEligibility } from "./market-intel-card-scope";
import { scanEbayForMarketIntel } from "./market-intel-ebay";
import { growthIdentityEligibility } from "./market-intel-growth";
import { createSupabaseServerClient } from "./supabase-server";

type GrowthWatchRow = {
  subject_id: string | null;
  priority: number | null;
  notes: string | null;
};

type GrowthSubjectRow = {
  id: string;
  priority: number | null;
  sport_or_category: string | null;
  league_or_brand: string | null;
};

type GrowthIdentityRow = {
  id: string;
  subject_id: string | null;
  sport_or_category: string | null;
  manufacturer: string | null;
  brand: string | null;
  product_line: string | null;
  set_name: string | null;
  display_name: string;
  parallel_name: string | null;
  insert_name: string | null;
  variation_name: string | null;
  serial_numbered_to: number | null;
  autograph: boolean | null;
  memorabilia: boolean | null;
};

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isGrowthProspect(notes: string | null | undefined) {
  return String(notes || "").includes("[GROWTH_PROSPECT]");
}

export async function scanEbayForGrowthSpecIdentities(options?: {
  maxTargets?: number;
  resultsPerTarget?: number;
  minimumConfidence?: number;
}) {
  const supabase = createSupabaseServerClient({ admin: true });
  const maxTargets = Math.max(1, Math.min(25, Math.round(options?.maxTargets || 25)));

  const { data: watchData, error: watchError } = await supabase
    .from("tcos_mi_watchlist")
    .select("subject_id,priority,notes")
    .eq("active", true)
    .not("subject_id", "is", null);
  if (watchError) throw new Error(watchError.message);

  const growthWatch = ((watchData || []) as GrowthWatchRow[]).filter((row) =>
    isGrowthProspect(row.notes),
  );
  const subjectIds = Array.from(
    new Set(
      growthWatch
        .map((row) => row.subject_id)
        .filter((value): value is string => Boolean(value)),
    ),
  );

  if (subjectIds.length === 0) {
    return {
      eligibleIdentityCount: 0,
      selectedIdentityIds: [] as string[],
      scan: null,
      message: "No active Growth Prospect subjects are available.",
    };
  }

  const [subjectResult, identityResult] = await Promise.all([
    supabase
      .from("tcos_mi_subjects")
      .select("id,priority,sport_or_category,league_or_brand")
      .in("id", subjectIds),
    supabase
      .from("tcos_mi_collectible_identities")
      .select(
        "id,subject_id,sport_or_category,manufacturer,brand,product_line,set_name,display_name,parallel_name,insert_name,variation_name,serial_numbered_to,autograph,memorabilia",
      )
      .eq("active", true)
      .in("subject_id", subjectIds),
  ]);
  if (subjectResult.error) throw new Error(subjectResult.error.message);
  if (identityResult.error) throw new Error(identityResult.error.message);

  const subjects = (subjectResult.data || []) as GrowthSubjectRow[];
  const subjectById = new Map(subjects.map((subject) => [subject.id, subject]));
  const watchPriorityBySubject = new Map(
    growthWatch
      .filter((row): row is GrowthWatchRow & { subject_id: string } => Boolean(row.subject_id))
      .map((row) => [row.subject_id, numberValue(row.priority)]),
  );

  const eligible = ((identityResult.data || []) as GrowthIdentityRow[])
    .filter((identity) => {
      const nonBase = growthIdentityEligibility(identity);
      if (!nonBase.eligible) return false;
      const subject = identity.subject_id
        ? subjectById.get(identity.subject_id)
        : null;
      const professional = growthProfessionalCardEligibility({
        sportOrCategory:
          subject?.sport_or_category || identity.sport_or_category,
        leagueOrBrand: subject?.league_or_brand,
        manufacturer: identity.manufacturer,
        brand: identity.brand,
        productLine: identity.product_line,
        setName: identity.set_name,
        displayName: identity.display_name,
      });
      return professional.eligible;
    })
    .sort((left, right) => {
      const leftPriority = left.subject_id
        ? Math.max(
            watchPriorityBySubject.get(left.subject_id) || 0,
            numberValue(subjectById.get(left.subject_id)?.priority),
          )
        : 0;
      const rightPriority = right.subject_id
        ? Math.max(
            watchPriorityBySubject.get(right.subject_id) || 0,
            numberValue(subjectById.get(right.subject_id)?.priority),
          )
        : 0;
      return rightPriority - leftPriority || left.display_name.localeCompare(right.display_name);
    });

  const selectedIdentityIds = eligible
    .slice(0, maxTargets)
    .map((identity) => identity.id);

  if (selectedIdentityIds.length === 0) {
    return {
      eligibleIdentityCount: 0,
      selectedIdentityIds,
      scan: null,
      message:
        "Growth Prospect players are loaded, but no licensed-professional non-base exact identities exist yet.",
    };
  }

  const scan = await scanEbayForMarketIntel({
    identityIds: selectedIdentityIds,
    maxTargets,
    resultsPerTarget: Math.max(
      1,
      Math.min(25, Math.round(options?.resultsPerTarget || 15)),
    ),
    minimumConfidence: Math.max(
      0,
      Math.min(100, numberValue(options?.minimumConfidence, 80)),
    ),
  });

  return {
    eligibleIdentityCount: eligible.length,
    selectedIdentityIds,
    scan,
    message: null,
  };
}
