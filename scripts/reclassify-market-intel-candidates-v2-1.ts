import { createClient } from "@supabase/supabase-js";
import {
  evaluateMarketIntelEbayIdentityMatch,
  type MarketIntelEbayCandidateIdentity,
} from "../src/lib/market-intel-ebay-candidate-match.ts";

type JsonRecord = Record<string, unknown>;
type Candidate = {
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
type Identity = Omit<MarketIntelEbayCandidateIdentity, "subject_name"> & {
  id: string;
  subject_id: string | null;
};

function env(name: string) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}
function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}
function key(row: Candidate) {
  return row.external_listing_id
    ? `${row.source_slug}|${row.external_listing_id}`
    : `${row.source_slug}|url:${row.direct_url}`;
}
function cleanEvidence(value: JsonRecord) {
  const output = { ...value };
  for (const field of [
    "automated_quarantine_at",
    "automated_quarantine_source",
    "cross_identity_listing_conflict",
    "sibling_identity_ids",
    "requires_lot_workflow",
    "identity_match_conflicts",
  ]) {
    delete output[field];
  }
  return output;
}

const supabase = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
});
const candidateResult = await supabase
  .from("tcos_mi_search_candidates")
  .select("id,source_slug,collectible_identity_id,external_listing_id,direct_url,original_title,description,listing_format,query_mode,status,evidence")
  .in("status", ["pending_review", "probable_exact", "conflict_detected"])
  .is("reviewed_at", null)
  .limit(1000);
if (candidateResult.error) throw new Error(candidateResult.error.message);
const candidates = (candidateResult.data || []) as Candidate[];
const identityIds = Array.from(new Set(candidates.map((row) => row.collectible_identity_id).filter(Boolean))) as string[];
const identityResult = identityIds.length
  ? await supabase
      .from("tcos_mi_collectible_identities")
      .select("id,subject_id,season_year,manufacturer,product_line,set_name,insert_name,card_number,parallel_name,variation_name,condition_type,grading_company,grade,autograph,memorabilia,serial_numbered_to")
      .in("id", identityIds)
  : { data: [], error: null };
if (identityResult.error) throw new Error(identityResult.error.message);
const identities = (identityResult.data || []) as Identity[];
const subjectIds = Array.from(new Set(identities.map((row) => row.subject_id).filter(Boolean))) as string[];
const subjectResult = subjectIds.length
  ? await supabase.from("tcos_mi_subjects").select("id,name").in("id", subjectIds)
  : { data: [], error: null };
if (subjectResult.error) throw new Error(subjectResult.error.message);
const subjects = new Map((subjectResult.data || []).map((row) => [String(row.id), String(row.name)]));
const identityById = new Map(
  identities.map((identity) => [
    identity.id,
    { ...identity, subject_name: subjects.get(String(identity.subject_id)) || "Tracked subject" },
  ]),
);
const groups = new Map<string, Candidate[]>();
for (const row of candidates) groups.set(key(row), [...(groups.get(key(row)) || []), row]);

let updated = 0;
let restored = 0;
let quarantined = 0;
let staleLotFormatsCleared = 0;

for (const candidate of candidates) {
  const identity = candidate.collectible_identity_id
    ? identityById.get(candidate.collectible_identity_id)
    : null;
  if (!identity) continue;
  const evidence = record(candidate.evidence);
  const match = evaluateMarketIntelEbayIdentityMatch(identity, {
    title: candidate.original_title,
    shortDescription: candidate.description || undefined,
    condition: evidence.ebay_condition ? String(evidence.ebay_condition) : undefined,
  });
  const staleLot =
    candidate.listing_format === "lot" &&
    candidate.query_mode !== "lot" &&
    evidence.requires_lot_workflow === true &&
    !match.lotListing;
  const listingFormat = staleLot ? "unknown" : candidate.listing_format;
  const requiresLot = listingFormat === "lot" || candidate.query_mode === "lot" || match.lotListing;
  const siblingIds = Array.from(
    new Set((groups.get(key(candidate)) || []).map((row) => row.collectible_identity_id).filter(Boolean)),
  );
  const crossIdentity = siblingIds.length > 1;
  const quarantine = match.hardConflict || requiresLot || crossIdentity;
  const automated = String(evidence.automated_quarantine_source || "").startsWith("candidate_reclassification_v");
  const now = new Date().toISOString();

  if (!quarantine && candidate.status === "conflict_detected" && automated) {
    const result = await supabase
      .from("tcos_mi_search_candidates")
      .update({
        status: "pending_review",
        listing_format: listingFormat,
        evidence: {
          ...cleanEvidence(evidence),
          worker_schema: "tcos.marketIntel.externalWorker.v2.1",
          identity_match_conflicts: [],
          requires_lot_workflow: false,
          cross_identity_listing_conflict: false,
          sibling_identity_ids: siblingIds,
          automated_restore_at: now,
          automated_restore_source: "candidate_reclassification_v2_1",
        },
        updated_at: now,
      })
      .eq("id", candidate.id)
      .is("reviewed_at", null);
    if (result.error) throw new Error(result.error.message);
    updated += 1;
    restored += 1;
    if (staleLot) staleLotFormatsCleared += 1;
    continue;
  }
  if (!quarantine) continue;

  const result = await supabase
    .from("tcos_mi_search_candidates")
    .update({
      status: "conflict_detected",
      listing_format: listingFormat,
      evidence: {
        ...cleanEvidence(evidence),
        worker_schema: "tcos.marketIntel.externalWorker.v2.1",
        identity_match_conflicts: match.conflicts,
        requires_lot_workflow: requiresLot,
        cross_identity_listing_conflict: crossIdentity,
        sibling_identity_ids: siblingIds,
        automated_quarantine_at: now,
        automated_quarantine_source: "candidate_reclassification_v2_1",
      },
      updated_at: now,
    })
    .eq("id", candidate.id)
    .is("reviewed_at", null);
  if (result.error) throw new Error(result.error.message);
  updated += 1;
  quarantined += 1;
  if (staleLot) staleLotFormatsCleared += 1;
}

console.log(JSON.stringify({
  script: "tcos.marketIntel.candidateReclassification.v2.1",
  read: candidates.length,
  updated,
  restoredToPendingReview: restored,
  quarantined,
  staleLotFormatsCleared,
  ownerDecisionsChanged: 0,
  promoted: 0,
  rejected: 0,
  purchasesCreated: 0,
}, null, 2));
