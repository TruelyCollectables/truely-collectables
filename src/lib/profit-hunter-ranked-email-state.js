import "server-only";

import { createSupabaseServerClient } from "./supabase-server";

const STATE_KEYS = Object.freeze([
  "ranked_shark_email_schema",
  "ranked_shark_email_fingerprint",
  "ranked_shark_email_id",
  "ranked_shark_email_sent_at",
  "ranked_shark_email_recipients",
  "ranked_shark_email_counts",
]);

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function stateFromMetadata(metadata) {
  const source = record(metadata);
  const state = {};
  for (const key of STATE_KEYS) {
    if (source[key] !== undefined) state[key] = source[key];
  }
  return state;
}

export async function readPriorRankedProfitHunterEmailState() {
  const supabase = createSupabaseServerClient({ admin: true });
  const { data, error } = await supabase
    .from("tcos_mi_report_runs")
    .select("id,metadata,generated_at")
    .eq("report_type", "hourly_deals")
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return {};
  return stateFromMetadata(data.metadata);
}

export async function restoreRankedProfitHunterEmailState(reportId, priorState) {
  const id = String(reportId || "").trim();
  const state = stateFromMetadata(priorState);
  if (!id || Object.keys(state).length === 0) {
    return { restored: false, reason: "No prior ranked-email state was available." };
  }

  const supabase = createSupabaseServerClient({ admin: true });
  const { data, error } = await supabase
    .from("tcos_mi_report_runs")
    .select("metadata")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    return { restored: false, reason: error.message };
  }

  const { error: updateError } = await supabase
    .from("tcos_mi_report_runs")
    .update({
      metadata: {
        ...record(data?.metadata),
        ...state,
      },
    })
    .eq("id", id);

  return updateError
    ? { restored: false, reason: updateError.message }
    : { restored: true, reason: null };
}
