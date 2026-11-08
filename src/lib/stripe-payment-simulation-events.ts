import type Stripe from "stripe";

const SIMULATION_FLAG = "tcos_payment_simulation";
const SIMULATION_RUN_ID = "tcos_simulation_run_id";
const E2E_FLAG = "tcos_e2e_checkout";

function metadataRunId(value: unknown) {
  if (!value || typeof value !== "object" || !("metadata" in value)) return null;
  const metadata = (value as { metadata?: Record<string, string> | null }).metadata;
  if (metadata?.[SIMULATION_FLAG] !== "true") return null;
  return metadata[SIMULATION_RUN_ID] || "tagged_without_run_id";
}

function e2eRunId(value: unknown) {
  if (!value || typeof value !== "object" || !("metadata" in value)) return null;
  const metadata = (value as { metadata?: Record<string, string> | null }).metadata;
  if (metadata?.[E2E_FLAG] !== "true") return null;
  return metadata[SIMULATION_RUN_ID] || "e2e_tagged_without_run_id";
}

function stripeId(value: unknown) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value) {
    return String((value as { id?: unknown }).id || "") || null;
  }
  return null;
}

export async function stripePaymentSimulationRunId(params: {
  stripe: Stripe;
  event: Stripe.Event;
}) {
  if (params.event.livemode) return null;
  if (params.event.id.startsWith("evt_tcos_e2e_process_")) return null;

  const object = params.event.data.object;
  const direct = metadataRunId(object);
  if (direct) return direct;
  const directE2E = e2eRunId(object);
  if (directE2E) return directE2E;

  if (params.event.type.startsWith("charge.dispute.")) {
    const dispute = object as Stripe.Dispute;
    const chargeId = stripeId(dispute.charge);
    if (!chargeId) return null;
    const charge = await params.stripe.charges.retrieve(chargeId);
    return metadataRunId(charge) || e2eRunId(charge);
  }

  return null;
}
