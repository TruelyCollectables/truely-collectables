import "server-only";

import { baseballPremiumCardEligibility } from "./market-intel-baseball-premium";
import { scanEbayForIdentityCandidates } from "./market-intel-identity-discovery";
import { createSupabaseServerClient } from "./supabase-server";

type SubjectRow = {
  id: string;
  name: string;
  sport_or_category: string | null;
  league_or_brand: string | null;
  notes: string | null;
};

type CandidateRow = {
  id: string;
  subject_id: string;
  status: string;
  original_title: string;
  detected_product_line: string | null;
  detected_set_name: string | null;
  detected_parallel_name: string | null;
  detected_insert_name: string | null;
  detected_variation_name: string | null;
  serial_numbered_to: number | null;
  autograph: boolean | null;
  memorabilia: boolean | null;
  metadata: Record<string, unknown> | null;
};

type IdentityRow = {
  id: string;
  subject_id: string | null;
  active: boolean;
  display_name: string;
  product_line: string | null;
  set_name: string | null;
  parallel_name: string | null;
  insert_name: string | null;
  variation_name: string | null;
  serial_numbered_to: number | null;
  autograph: boolean | null;
  memorabilia: boolean | null;
};

type AlertRow = {
  id: string;
  metadata: Record<string, unknown> | null;
};

function normalize(value: string | null | undefined) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isBaseballSubject(subject: SubjectRow) {
  const sport = normalize(subject.sport_or_category);
  const league = normalize(subject.league_or_brand);
  return sport.includes("baseball") || league.includes("mlb") || league.includes("miami marlins");
}

function isDillonHeadFirstBowmanOnly(subject: SubjectRow) {
  return (
    normalize(subject.name) === "dillon head" &&
    String(subject.notes || "").includes("[FIRST_BOWMAN_CHROME_ONLY]")
  );
}

function dillonHeadFirstBowmanEligibility(input: {
  subject: SubjectRow;
  title: string;
  productLine: string | null;
  setName: string | null;
  parallelName: string | null;
  insertName: string | null;
  variationName: string | null;
  serialNumberedTo: number | null;
  autograph: boolean | null;
  memorabilia: boolean | null;
}) {
  const premium = baseballPremiumCardEligibility({
    sportOrCategory: input.subject.sport_or_category,
    leagueOrBrand: input.subject.league_or_brand,
    title: input.title,
    productLine: input.productLine,
    setName: input.setName,
    parallelName: input.parallelName,
    insertName: input.insertName,
    variationName: input.variationName,
    serialNumberedTo: input.serialNumberedTo,
    autograph: input.autograph,
    memorabilia: input.memorabilia,
  });
  if (!premium.eligible) return premium;
  if (!isDillonHeadFirstBowmanOnly(input.subject)) return premium;

  const text = normalize(
    [
      input.title,
      input.productLine,
      input.setName,
      input.parallelName,
      input.insertName,
      input.variationName,
    ]
      .filter(Boolean)
      .join(" "),
  );
  const hasFirst = text.includes("1st bowman") || text.includes("first bowman");
  const hasBowman = text.includes("bowman");
  const hasChrome = text.includes("chrome");
  const blocked = [
    text.includes("mojo") ? "Dillon Head Mojo/Mega Box Mojo cards are blocked." : null,
    text.includes("paper") ? "Dillon Head paper cards are blocked." : null,
    !hasFirst ? "Dillon Head tracking requires an explicit 1st Bowman signal." : null,
    !hasBowman || !hasChrome
      ? "Dillon Head tracking is limited to 1st Bowman Chrome cards."
      : null,
  ].filter((value): value is string => Boolean(value));

  return blocked.length > 0
    ? {
        eligible: false,
        reasons: [],
        rejectionReasons: blocked,
      }
    : {
        ...premium,
        reasons: [
          ...premium.reasons,
          "Dillon Head 1st Bowman Chrome hoard scope confirmed",
        ],
      };
}

export async function enforceBaseballPremiumPolicy() {
  const supabase = createSupabaseServerClient({ admin: true });
  const { data: subjectData, error: subjectError } = await supabase
    .from("tcos_mi_subjects")
    .select("id,name,sport_or_category,league_or_brand,notes")
    .eq("active", true);
  if (subjectError) throw new Error(subjectError.message);

  const baseballSubjects = ((subjectData || []) as SubjectRow[]).filter(isBaseballSubject);
  const subjectById = new Map(baseballSubjects.map((subject) => [subject.id, subject]));
  const subjectIds = baseballSubjects.map((subject) => subject.id);
  if (subjectIds.length === 0) {
    return { candidatesRejected: 0, identitiesDeactivated: 0, alertsExpired: 0 };
  }

  const [candidateResult, identityResult] = await Promise.all([
    supabase
      .from("tcos_mi_identity_candidates")
      .select(
        "id,subject_id,status,original_title,detected_product_line,detected_set_name,detected_parallel_name,detected_insert_name,detected_variation_name,serial_numbered_to,autograph,memorabilia,metadata",
      )
      .eq("status", "pending")
      .in("subject_id", subjectIds),
    supabase
      .from("tcos_mi_collectible_identities")
      .select(
        "id,subject_id,active,display_name,product_line,set_name,parallel_name,insert_name,variation_name,serial_numbered_to,autograph,memorabilia",
      )
      .eq("active", true)
      .in("subject_id", subjectIds),
  ]);
  if (candidateResult.error) throw new Error(candidateResult.error.message);
  if (identityResult.error) throw new Error(identityResult.error.message);

  let candidatesRejected = 0;
  let identitiesDeactivated = 0;
  const blockedIdentityIds: string[] = [];
  const now = new Date().toISOString();

  for (const candidate of (candidateResult.data || []) as CandidateRow[]) {
    const subject = subjectById.get(candidate.subject_id);
    if (!subject) continue;
    const policy = dillonHeadFirstBowmanEligibility({
      subject,
      title: candidate.original_title,
      productLine: candidate.detected_product_line,
      setName: candidate.detected_set_name,
      parallelName: candidate.detected_parallel_name,
      insertName: candidate.detected_insert_name,
      variationName: candidate.detected_variation_name,
      serialNumberedTo: candidate.serial_numbered_to,
      autograph: candidate.autograph,
      memorabilia: candidate.memorabilia,
    });
    if (policy.eligible) continue;
    const { error } = await supabase
      .from("tcos_mi_identity_candidates")
      .update({
        status: "rejected",
        rejection_reason: policy.rejectionReasons.join(" "),
        reviewed_at: now,
        metadata: {
          ...(candidate.metadata || {}),
          policy_engine: "baseball_premium_only_v2",
          policy_rejected_at: now,
          rejection_reasons: policy.rejectionReasons,
        },
      })
      .eq("id", candidate.id)
      .eq("status", "pending");
    if (error) throw new Error(error.message);
    candidatesRejected += 1;
  }

  for (const identity of (identityResult.data || []) as IdentityRow[]) {
    if (!identity.subject_id) continue;
    const subject = subjectById.get(identity.subject_id);
    if (!subject) continue;
    const policy = dillonHeadFirstBowmanEligibility({
      subject,
      title: identity.display_name,
      productLine: identity.product_line,
      setName: identity.set_name,
      parallelName: identity.parallel_name,
      insertName: identity.insert_name,
      variationName: identity.variation_name,
      serialNumberedTo: identity.serial_numbered_to,
      autograph: identity.autograph,
      memorabilia: identity.memorabilia,
    });
    if (policy.eligible) continue;
    const { error } = await supabase
      .from("tcos_mi_collectible_identities")
      .update({ active: false })
      .eq("id", identity.id)
      .eq("active", true);
    if (error) throw new Error(error.message);
    blockedIdentityIds.push(identity.id);
    identitiesDeactivated += 1;
  }

  let alertsExpired = 0;
  if (blockedIdentityIds.length > 0) {
    const { data: listingData, error: listingError } = await supabase
      .from("tcos_mi_listings")
      .select("id")
      .in("collectible_identity_id", blockedIdentityIds);
    if (listingError) throw new Error(listingError.message);
    const listingIds = (listingData || []).map((row) => String(row.id));
    if (listingIds.length > 0) {
      const { data: alertData, error: alertError } = await supabase
        .from("tcos_mi_alerts")
        .select("id,metadata")
        .eq("status", "pending")
        .in("listing_id", listingIds);
      if (alertError) throw new Error(alertError.message);
      for (const alert of (alertData || []) as AlertRow[]) {
        const { error } = await supabase
          .from("tcos_mi_alerts")
          .update({
            status: "expired",
            metadata: {
              ...(alert.metadata || {}),
              policy_engine: "baseball_premium_only_v2",
              policy_expired_at: now,
            },
          })
          .eq("id", alert.id)
          .eq("status", "pending");
        if (error) throw new Error(error.message);
        alertsExpired += 1;
      }
    }
  }

  return { candidatesRejected, identitiesDeactivated, alertsExpired };
}

export async function scanEbayForPremiumIdentityCandidates(options?: {
  maxSubjects?: number;
  resultsPerQuery?: number;
}) {
  await enforceBaseballPremiumPolicy();
  const scan = await scanEbayForIdentityCandidates(options);
  const enforcement = await enforceBaseballPremiumPolicy();
  return { ...scan, premiumPolicy: enforcement };
}

export async function assertCandidateBaseballPremiumPolicy(input: {
  candidateId: string;
  productLine: string;
  setName: string;
  parallelName: string;
  insertName: string;
  variationName: string;
  serialNumberedTo: number | null;
  autograph: boolean;
  memorabilia: boolean;
}) {
  const supabase = createSupabaseServerClient({ admin: true });
  const { data: candidate, error: candidateError } = await supabase
    .from("tcos_mi_identity_candidates")
    .select("subject_id,original_title")
    .eq("id", input.candidateId)
    .single();
  if (candidateError) throw new Error(candidateError.message);
  const { data: subject, error: subjectError } = await supabase
    .from("tcos_mi_subjects")
    .select("id,name,sport_or_category,league_or_brand,notes")
    .eq("id", candidate.subject_id)
    .single();
  if (subjectError) throw new Error(subjectError.message);

  const policy = dillonHeadFirstBowmanEligibility({
    subject: subject as SubjectRow,
    title: candidate.original_title,
    productLine: input.productLine,
    setName: input.setName,
    parallelName: input.parallelName,
    insertName: input.insertName,
    variationName: input.variationName,
    serialNumberedTo: input.serialNumberedTo,
    autograph: input.autograph,
    memorabilia: input.memorabilia,
  });
  if (!policy.eligible) {
    throw new Error(policy.rejectionReasons.join(" "));
  }
  return policy;
}
