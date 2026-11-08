import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClientIdentity } from "./client-identity";
import { getActiveStoreId } from "./stores";

export type TermsAcceptanceInput = {
  contextType: string;
  contextId?: string | number | null;
  tosKind: "buyer" | "seller";
  tosVersion: string;
  identity: ClientIdentity;
  storeId?: string;
};

export async function recordTermsAcceptance(
  supabase: SupabaseClient,
  input: TermsAcceptanceInput,
): Promise<string> {
  if (!input.identity.ipAddress) {
    throw new Error("Cannot record TOS acceptance without client IP address");
  }

  const storeId = input.storeId ?? getActiveStoreId();

  const { data, error } = await supabase
    .from("tos_acceptance_events")
    .insert({
      store_id: storeId,
      context_type: input.contextType,
      context_id:
        input.contextId === null || input.contextId === undefined
          ? null
          : String(input.contextId),
      tos_kind: input.tosKind,
      tos_version: input.tosVersion,
      ip_address: input.identity.ipAddress,
      user_agent: input.identity.userAgent,
      ip_risk: input.identity.risk,
      ip_block_reason: input.identity.blockReason,
      ip_evidence: input.identity.evidence,
    })
    .select("id")
    .single();

  if (error || !data?.id) {
    throw new Error(
      `Failed to record TOS acceptance identity evidence: ${
        error?.message || "missing audit id"
      }`,
    );
  }

  return String(data.id);
}
