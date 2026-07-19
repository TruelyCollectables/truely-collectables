import { createClient } from "@supabase/supabase-js";
import {
  evaluateMarketIntelEbayIdentityMatch,
  type MarketIntelEbayCandidateIdentity,
} from "../src/lib/market-intel-ebay-candidate-match";

type JsonRecord = Record<string, unknown>;

type CandidateRow = {
  id: string;
  source_slug: string;
  collectible_identity_id: string | null;
  external_listing_id: string | null;
  direct_url: string;
  original_title: string;
  description: string | null;
  listing_format: string;
  query_mode: string | null;
  status: string;
  evidence: JsonRecord | null;
};

type IdentityRow = Omit<MarketIntelEbayCandidateIdentity, "subject_name"> & {
  id: string;
  subject_id: string | null;
};

function requiredEnv(name: string) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function recordValue(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function sourceKey(candidate: CandidateRow) {
  return candidate.external_listing_id
    ? `${candidate.source_slug}|${candidate.external_listing_id}`
    : `${candidate.source_slug}|url:${candidate.direct_url}`;
}

const supabase = createClient(
  requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
  requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const { data: candidateData, error: candidateError } = await supabase
  .from("tcos_mi_search_candidates")
  .select(
    "id,source_slug,collectible_identity_id,external_listing_id,direct_url,original_title,description,listing_format,query_mode,status,evidence",
  )
  .in("status", ["pending_review", "probable_exact", "conflict_detected"])
  .is("reviewed_at", null)
  .limit(1000);
if (candidateError) throw new Error(candidateError.message);

const candidates = (candidateData || []) as CandidateRow[];
const identityIds = Array.from(
  new Set(
    candidates
      .map((candidate) => candidate.collectible_identity_id)
      .filter((value): value is string => Boolean(value)),
  ),
);

const { data: identityData, error: identityError } = identityIds.length
  ? await supabase
      .from("tcos_mi_collectible_identities")
      .select(
        "id,subject_id,season_year,manufacturer,product_line,set_name,insert_name,card_number,parallel_name,variation_name,condition_type,grading_company,grade,autograph,memorabilia,serial_numbered_to",
      )
      .in("id", identityIds)
  : { data: [], error: null };
if (identityError) throw new Error(identityError.message);

const identityRows = (identityData || []) as IdentityRow[];
const subjectIds = Array.from(
  new Set(
    identityRows
      .map((identity) => identity.subject_id)
      .filter((value): value is string => Boolean(value)),
  ),
);
const { data: subjectData, error: subjectError } = subjectIds.length
  ? await supabase.from("tcos_mi_subjects").select("id,name").in("id", subjectIds)
  : { data: [], error: null };
if (subjectError) throw new Error(subjectError.message);
const subjectById = new Map<string, string>(
  (subjectData || []).map((subject: { id: string; name: string }) => [
    String(subject.id),
    String(subject.name),
  ]),
);
const identityById = new Map(
  identityRows.map((identity) => [
    identity.id,
    {
      ...identity,
      subject_name: subjectById.get(String(identity.subject_id)) || "Tracked subject",
    },
  ]),
);
const groups = new Map<string, CandidateRow[]>();
for (const candidate of candidates) {
  const key = sourceKey(candidate);
  const rows = groups.get(key) || [];
  rows.push(candidate);
  groups.set(key, rows);
}

let updated = 0;
let conflicts = 0;
let lots = 0;
let crossIdentity = 0;
let skippedMissingIdentity = 0;

for (const candidate of candidates) {
  const identity = candidate.collectible_identity_id
    ? identityById.get(candidate.collectible_identity_id)
    : null;
  if (!identity) {
    skippedMissingIdentity += 1;
    continue;
  }

  const evidence = recordValue(candidate.evidence);
  const match = evaluateMarketIntelEbayIdentityMatch(identity, {
    title: candidate.original_title,
    shortDescription: candidate.description || undefined,
    condition: evidence.ebay_condition ? String(evidence.ebay_condition) : undefined,
  });
  const requiresLotWorkflow =
    candidate.listing_format === "lot" ||
    candidate.query_mode === "lot" ||
    match.lotListing;
  const siblings = groups.get(sourceKey(candidate)) || [];
  const siblingIdentityIds = Array.from(
    new Set(
      siblings
        .map((row) => row.collectible_identity_id)
        .filter((value): value is string => Boolean(value)),
    ),
  );
  const hasCrossIdentityConflict = siblingIdentityIds.length > 1;
  const shouldQuarantine =
    match.hardConflict || requiresLotWorkflow || hasCrossIdentityConflict;
  if (!shouldQuarantine) continue;

  if (match.hardConflict) conflicts += 1;
  if (requiresLotWorkflow) lots += 1;
  if (hasCrossIdentityConflict) crossIdentity += 1;

  const { error: updateError } = await supabase
    .from("tcos_mi_search_candidates")
    .update({
      status: "conflict_detected",
      evidence: {
        ...evidence,
        worker_schema: "tcos.marketIntel.externalWorker.v2",
        identity_match_conflicts: match.conflicts,
        requires_lot_workflow: requiresLotWorkflow,
        cross_identity_listing_conflict: hasCrossIdentityConflict,
        sibling_identity_ids: siblingIdentityIds,
        automated_quarantine_at: new Date().toISOString(),
        automated_quarantine_source: "candidate_reclassification_v2",
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", candidate.id)
    .is("reviewed_at", null);
  if (updateError) throw new Error(updateError.message);
  updated += 1;
}

console.log(
  JSON.stringify(
    {
      script: "tcos.marketIntel.candidateReclassification.v2",
      read: candidates.length,
      updated,
      conflictSignals: conflicts,
      lotQuarantines: lots,
      crossIdentityQuarantines: crossIdentity,
      skippedMissingIdentity,
      ownerDecisionsChanged: 0,
      promoted: 0,
      rejected: 0,
      purchasesCreated: 0,
    },
    null,
    2,
  ),
);
