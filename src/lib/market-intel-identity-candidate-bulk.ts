import "server-only";

import {
  approveIdentityCandidate,
  rejectIdentityCandidate,
  type CandidateApprovalInput,
} from "./market-intel-identity-candidates";
import { normalizeDuplicateIdentityKey } from "./market-intel-identity-duplicate-guard";
import { normalizeDiscoveryApprovalInput } from "./market-intel-discovery-repair";
import { createSupabaseServerClient } from "./supabase-server";

type CandidateRow = {
  id: string;
  status: string;
  detected_year: string | null;
  detected_manufacturer: string | null;
  detected_brand: string | null;
  detected_product_line: string | null;
  detected_set_name: string | null;
  detected_insert_name: string | null;
  detected_card_number: string | null;
  detected_parallel_name: string | null;
  detected_variation_name: string | null;
  serial_numbered_to: number | null;
  autograph: boolean;
  memorabilia: boolean;
  rookie_designation: boolean;
  condition_type: string;
  grading_company: string | null;
  grade: string | null;
  quantity: number;
};

export type BulkCandidateResult = {
  requested: number;
  approved: number;
  rejected: number;
  skipped: number;
  errors: Array<{ candidateId: string; message: string }>;
};

function cleanIds(candidateIds: string[]) {
  return Array.from(
    new Set(
      candidateIds
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  ).slice(0, 50);
}

function required(value: string | null | undefined, label: string) {
  const cleaned = String(value || "").trim();
  if (!cleaned) throw new Error(`${label} is missing.`);
  return cleaned;
}

async function approveFromDetected(candidate: CandidateRow) {
  if (candidate.status !== "pending") {
    throw new Error(`Candidate is already ${candidate.status}.`);
  }

  const seasonYear = required(candidate.detected_year, "Year");
  const manufacturer = required(
    candidate.detected_manufacturer,
    "Manufacturer",
  );
  const productLine = required(
    candidate.detected_product_line,
    "Product line",
  );
  const cardNumber = required(candidate.detected_card_number, "Exact card number");
  const conditionType: CandidateApprovalInput["conditionType"] =
    candidate.condition_type === "graded" ? "graded" : "raw";

  const submitted: CandidateApprovalInput = {
    candidateId: candidate.id,
    seasonYear,
    manufacturer,
    brand: String(candidate.detected_brand || manufacturer),
    productLine,
    setName: String(candidate.detected_set_name || productLine),
    insertName: String(candidate.detected_insert_name || ""),
    cardNumber,
    parallelName: String(candidate.detected_parallel_name || "Base"),
    variationName: String(candidate.detected_variation_name || ""),
    serialNumberedTo: candidate.serial_numbered_to,
    autograph: Boolean(candidate.autograph),
    memorabilia: Boolean(candidate.memorabilia),
    rookieDesignation: Boolean(candidate.rookie_designation),
    conditionType,
    gradingCompany: String(candidate.grading_company || ""),
    grade: String(candidate.grade || ""),
    quantity: Math.max(1, Math.round(Number(candidate.quantity || 1))),
  };

  const approval = await normalizeDiscoveryApprovalInput(submitted);
  await normalizeDuplicateIdentityKey(approval);
  await approveIdentityCandidate(approval);
}

export async function bulkApproveIdentityCandidates(
  candidateIds: string[],
): Promise<BulkCandidateResult> {
  const ids = cleanIds(candidateIds);
  const result: BulkCandidateResult = {
    requested: ids.length,
    approved: 0,
    rejected: 0,
    skipped: 0,
    errors: [],
  };
  if (ids.length === 0) return result;

  const supabase = createSupabaseServerClient({ admin: true });
  const { data, error } = await supabase
    .from("tcos_mi_identity_candidates")
    .select(
      "id,status,detected_year,detected_manufacturer,detected_brand,detected_product_line,detected_set_name,detected_insert_name,detected_card_number,detected_parallel_name,detected_variation_name,serial_numbered_to,autograph,memorabilia,rookie_designation,condition_type,grading_company,grade,quantity",
    )
    .in("id", ids);
  if (error) throw new Error(error.message);

  const candidateById = new Map(
    ((data || []) as CandidateRow[]).map((candidate) => [candidate.id, candidate]),
  );

  for (const candidateId of ids) {
    const candidate = candidateById.get(candidateId);
    if (!candidate) {
      result.skipped += 1;
      result.errors.push({
        candidateId,
        message: "Candidate was not found.",
      });
      continue;
    }

    try {
      await approveFromDetected(candidate);
      result.approved += 1;
    } catch (error) {
      result.skipped += 1;
      result.errors.push({
        candidateId,
        message:
          error instanceof Error ? error.message : "Bulk approval failed.",
      });
    }
  }

  return result;
}

export async function bulkRejectIdentityCandidates(
  candidateIds: string[],
  reason = "Bulk rejected during Discovery Desk review.",
): Promise<BulkCandidateResult> {
  const ids = cleanIds(candidateIds);
  const result: BulkCandidateResult = {
    requested: ids.length,
    approved: 0,
    rejected: 0,
    skipped: 0,
    errors: [],
  };

  for (const candidateId of ids) {
    try {
      await rejectIdentityCandidate(candidateId, reason);
      result.rejected += 1;
    } catch (error) {
      result.skipped += 1;
      result.errors.push({
        candidateId,
        message:
          error instanceof Error ? error.message : "Bulk rejection failed.",
      });
    }
  }

  return result;
}
