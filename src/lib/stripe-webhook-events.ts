import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

export type StripeWebhookClaim = {
  webhookEventId: string;
  eventStatus: "processing" | "processed" | "ignored" | "failed";
  claimed: boolean;
  attemptCount: number;
};

function eventObjectId(event: Stripe.Event) {
  const object = event.data?.object as { id?: unknown } | undefined;
  const id = String(object?.id || "").trim();
  return id || null;
}

function eventDedupeKey(event: Stripe.Event) {
  const objectId = eventObjectId(event);

  return event.type === "checkout.session.completed" && objectId
    ? `${event.type}:${objectId}`
    : null;
}

export function stripeWebhookPayloadHash(payload: string) {
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

export async function claimStripeWebhookEvent(params: {
  supabase: SupabaseClient;
  storeId: string;
  event: Stripe.Event;
  payloadSha256: string;
  endpointPath: string;
}): Promise<StripeWebhookClaim> {
  const { data, error } = await params.supabase.rpc(
    "tcos_claim_stripe_webhook_event",
    {
      p_store_id: params.storeId,
      p_stripe_event_id: params.event.id,
      p_event_type: params.event.type,
      p_object_id: eventObjectId(params.event),
      p_dedupe_key: eventDedupeKey(params.event),
      p_stripe_account_id:
        typeof params.event.account === "string" ? params.event.account : null,
      p_api_version: params.event.api_version || null,
      p_livemode: params.event.livemode === true,
      p_payload_sha256: params.payloadSha256,
      p_endpoint_path: params.endpointPath,
    },
  );

  if (error) throw error;

  const row = (Array.isArray(data) ? data[0] : data) as
    | {
        webhook_event_id?: string;
        event_status?: StripeWebhookClaim["eventStatus"];
        claimed?: boolean;
        attempt_count?: number;
      }
    | null;

  if (!row?.webhook_event_id || !row.event_status) {
    throw new Error("Stripe webhook event claim returned no durable event row.");
  }

  return {
    webhookEventId: row.webhook_event_id,
    eventStatus: row.event_status,
    claimed: row.claimed === true,
    attemptCount: Number(row.attempt_count || 1),
  };
}

export async function finishStripeWebhookEvent(params: {
  supabase: SupabaseClient;
  webhookEventId: string;
  status: "processed" | "ignored";
  metadata?: Record<string, unknown>;
}) {
  const now = new Date().toISOString();
  const { error } = await params.supabase
    .from("stripe_webhook_events")
    .update({
      event_status: params.status,
      processed_at: now,
      lease_expires_at: null,
      last_error: null,
      metadata: params.metadata || {},
      updated_at: now,
    })
    .eq("id", params.webhookEventId)
    .eq("event_status", "processing");

  if (error) throw error;
}

export async function failStripeWebhookEvent(params: {
  supabase: SupabaseClient;
  webhookEventId: string;
  error: unknown;
}) {
  const message =
    params.error instanceof Error
      ? params.error.message
      : String(params.error || "Stripe webhook processing failed");
  const { error } = await params.supabase
    .from("stripe_webhook_events")
    .update({
      event_status: "failed",
      lease_expires_at: null,
      last_error: message.slice(0, 1000),
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.webhookEventId)
    .eq("event_status", "processing");

  if (error) throw error;
}
