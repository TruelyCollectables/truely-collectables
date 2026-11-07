import "server-only";

import type { CandidateApprovalInput } from "./market-intel-identity-candidates";
import { createSupabaseServerClient } from "./supabase-server";

type CandidateRow = {
  id: string;
  original_title: string;
  detected_product_line: string | null;
  detected_set_name: string | null;
  detected_insert_name: string | null;
  serial_numbered_to: number | null;
  autograph: boolean | null;
  metadata: Record<string, unknown> | null;
};

function normalize(value: string | null | undefined) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasRealSerialSignal(title: string) {
  return (
    /\b\d{1,4}\s*\/\s*\d{1,4}\b/i.test(title) ||
    /\b(?:numbered(?:\s+to)?|serial(?:ly)?\s+numbered(?:\s+to)?|out\s+of)\s*\/?\s*\d{1,4}\b/i.test(
      title,
    ) ||
    /(?:^|\s)\/\s*\d{1,4}\b/i.test(title)
  );
}

function titleImpliesAutograph(title: string) {
  return (
    /\bauto(?:graph(?:ed|s)?)?\b/i.test(title) ||
    /\bau\b/i.test(title) ||
    /\bsigned\b/i.test(title)
  );
}

function repairedFields(candidate: CandidateRow) {
  const title = candidate.original_title;
  const normalizedTitle = normalize(title);
  const patch: Record<string, unknown> = {};

  if (
    normalizedTitle.includes("bowman s best") ||
    normalizedTitle.includes("bowmans best")
  ) {
    if (!candidate.detected_product_line) {
      patch.detected_product_line = "Bowman's Best";
    }
    if (!candidate.detected_set_name) patch.detected_set_name = "Bowman's Best";
  }

  if (normalizedTitle.includes("best of 2024 autographs")) {
    patch.detected_product_line = "Bowman's Best";
    patch.detected_set_name = "Bowman's Best";
    patch.detected_insert_name = "Best of 2024 Autographs";
    patch.autograph = true;
  } else if (titleImpliesAutograph(title)) {
    patch.autograph = true;
  }

  if (
    candidate.serial_numbered_to &&
    !hasRealSerialSignal(title) &&
    normalizedTitle.includes(`of ${candidate.serial_numbered_to}`)
  ) {
    patch.serial_numbered_to = null;
  }

  return patch;
}

export async function repairPendingDiscoveryParsing() {
  const supabase = createSupabaseServerClient({ admin: true });
  const { data, error } = await supabase
    .from("tcos_mi_identity_candidates")
    .select(
      "id,original_title,detected_product_line,detected_set_name,detected_insert_name,serial_numbered_to,autograph,metadata",
    )
    .eq("status", "pending")
    .limit(500);
  if (error) throw new Error(error.message);

  let repaired = 0;
  for (const candidate of (data || []) as CandidateRow[]) {
    const patch = repairedFields(candidate);
    if (Object.keys(patch).length === 0) continue;
    const now = new Date().toISOString();
    const { error: updateError } = await supabase
      .from("tcos_mi_identity_candidates")
      .update({
        ...patch,
        metadata: {
          ...(candidate.metadata || {}),
          parser_repair_version: "discovery-parser-repair-v2",
          parser_repaired_at: now,
        },
      })
      .eq("id", candidate.id)
      .eq("status", "pending");
    if (updateError) throw new Error(updateError.message);
    repaired += 1;
  }

  return { repaired };
}

export async function normalizeDiscoveryApprovalInput(
  input: CandidateApprovalInput,
): Promise<CandidateApprovalInput> {
  const supabase = createSupabaseServerClient({ admin: true });
  const { data: rows, error } = await supabase
    .from("tcos_mi_identity_candidates")
    .select(
      "id,original_title,detected_product_line,detected_set_name,detected_insert_name,serial_numbered_to,autograph,metadata",
    )
    .eq("id", input.candidateId)
    .limit(2);
  if (error) throw new Error(error.message);
  if (!rows || rows.length !== 1) {
    throw new Error(
      rows?.length
        ? "The Discovery candidate ID is duplicated."
        : "The Discovery candidate no longer exists.",
    );
  }

  const candidate = rows[0] as CandidateRow;
  const title = candidate.original_title;
  const normalizedTitle = normalize(title);
  const normalizedInput: CandidateApprovalInput = { ...input };

  if (
    normalizedTitle.includes("bowman s best") ||
    normalizedTitle.includes("bowmans best")
  ) {
    if (!normalizedInput.productLine.trim()) {
      normalizedInput.productLine = "Bowman's Best";
    }
    if (!normalizedInput.setName.trim()) normalizedInput.setName = "Bowman's Best";
  }

  if (normalizedTitle.includes("best of 2024 autographs")) {
    normalizedInput.productLine = normalizedInput.productLine.trim() || "Bowman's Best";
    normalizedInput.setName = normalizedInput.setName.trim() || "Bowman's Best";
    normalizedInput.insertName =
      normalizedInput.insertName.trim() || "Best of 2024 Autographs";
    normalizedInput.autograph = true;
  } else if (titleImpliesAutograph(title)) {
    normalizedInput.autograph = true;
  }

  if (
    normalizedInput.serialNumberedTo &&
    !hasRealSerialSignal(title) &&
    normalizedTitle.includes(`of ${normalizedInput.serialNumberedTo}`)
  ) {
    normalizedInput.serialNumberedTo = null;
  }

  return normalizedInput;
}
