import "server-only";

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
    const title = candidate.original_title;
    const normalized = normalize(title);
    const patch: Record<string, unknown> = {};

    if (normalized.includes("bowman s best") || normalized.includes("bowmans best")) {
      if (!candidate.detected_product_line) patch.detected_product_line = "Bowman's Best";
      if (!candidate.detected_set_name) patch.detected_set_name = "Bowman's Best";
    }

    if (normalized.includes("best of 2024 autographs")) {
      patch.detected_product_line = "Bowman's Best";
      patch.detected_set_name = "Bowman's Best";
      patch.detected_insert_name = "Best of 2024 Autographs";
      patch.autograph = true;
    } else if (
      /\bauto(?:graph(?:ed|s)?)?\b/i.test(title) ||
      /\bau\b/i.test(title) ||
      /\bsigned\b/i.test(title)
    ) {
      patch.autograph = true;
    }

    if (
      candidate.serial_numbered_to &&
      !hasRealSerialSignal(title) &&
      normalized.includes(`of ${candidate.serial_numbered_to}`)
    ) {
      patch.serial_numbered_to = null;
    }

    if (Object.keys(patch).length === 0) continue;
    const now = new Date().toISOString();
    const { error: updateError } = await supabase
      .from("tcos_mi_identity_candidates")
      .update({
        ...patch,
        metadata: {
          ...(candidate.metadata || {}),
          parser_repair_version: "discovery-parser-repair-v1",
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
