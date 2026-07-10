import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export type CheckoutAttemptClaim = {
  rowId: string;
  requestStatus: "processing" | "session_created" | "failed";
  fingerprintMatches: boolean;
  claimed: boolean;
  attemptCount: number;
  stripeSessionId: string | null;
  tosAcceptanceEventId: string | null;
  tosAcceptedAt: string;
  identityMetadata: Record<string, string>;
};

export function isCheckoutAttemptId(value: unknown): value is string {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || ""),
  );
}

export function checkoutRequestFingerprint(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(value), "utf8")
    .digest("hex");
}

function stringMetadata(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      String(item ?? ""),
    ]),
  );
}

export async function claimCheckoutAttempt(params: {
  supabase: SupabaseClient;
  storeId: string;
  checkoutAttemptId: string;
  accountId: string | null;
  requestFingerprint: string;
  stripeIdempotencyKey: string;
  identityMetadata: Record<string, string>;
}): Promise<CheckoutAttemptClaim> {
  const { data, error } = await params.supabase.rpc(
    "tcos_claim_checkout_attempt",
    {
      p_store_id: params.storeId,
      p_checkout_attempt_id: params.checkoutAttemptId,
      p_account_id: params.accountId,
      p_request_fingerprint: params.requestFingerprint,
      p_stripe_idempotency_key: params.stripeIdempotencyKey,
      p_identity_metadata: params.identityMetadata,
    },
  );

  if (error) throw error;

  const row = (Array.isArray(data) ? data[0] : data) as
    | {
        checkout_attempt_row_id?: string;
        request_status?: CheckoutAttemptClaim["requestStatus"];
        fingerprint_matches?: boolean;
        claimed?: boolean;
        attempt_count?: number;
        stripe_session_id?: string | null;
        tos_acceptance_event_id?: string | null;
        tos_accepted_at?: string;
        identity_metadata?: unknown;
      }
    | null;

  if (!row?.checkout_attempt_row_id || !row.request_status || !row.tos_accepted_at) {
    throw new Error("Checkout attempt claim returned no durable request row.");
  }

  return {
    rowId: row.checkout_attempt_row_id,
    requestStatus: row.request_status,
    fingerprintMatches: row.fingerprint_matches === true,
    claimed: row.claimed === true,
    attemptCount: Number(row.attempt_count || 1),
    stripeSessionId: row.stripe_session_id || null,
    tosAcceptanceEventId: row.tos_acceptance_event_id || null,
    tosAcceptedAt: row.tos_accepted_at,
    identityMetadata: stringMetadata(row.identity_metadata),
  };
}

export async function attachCheckoutTosEvidence(params: {
  supabase: SupabaseClient;
  rowId: string;
  tosAcceptanceEventId: string;
}) {
  const { error } = await params.supabase
    .from("checkout_attempts")
    .update({
      tos_acceptance_event_id: params.tosAcceptanceEventId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.rowId)
    .eq("request_status", "processing");

  if (error) throw error;
}

export async function completeCheckoutAttempt(params: {
  supabase: SupabaseClient;
  rowId: string;
  stripeSessionId: string;
}) {
  const now = new Date().toISOString();
  const { error } = await params.supabase
    .from("checkout_attempts")
    .update({
      request_status: "session_created",
      stripe_session_id: params.stripeSessionId,
      session_created_at: now,
      lease_expires_at: null,
      last_error: null,
      updated_at: now,
    })
    .eq("id", params.rowId)
    .eq("request_status", "processing");

  if (error) throw error;
}

export async function failCheckoutAttempt(params: {
  supabase: SupabaseClient;
  rowId: string;
  error: unknown;
}) {
  const message =
    params.error instanceof Error
      ? params.error.message
      : String(params.error || "Checkout Session creation failed");
  const { error } = await params.supabase
    .from("checkout_attempts")
    .update({
      request_status: "failed",
      lease_expires_at: null,
      last_error: message.slice(0, 1000),
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.rowId)
    .eq("request_status", "processing");

  if (error) throw error;
}
