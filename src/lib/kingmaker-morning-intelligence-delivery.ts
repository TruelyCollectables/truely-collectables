import "server-only";

import { randomUUID } from "node:crypto";
import { Resend } from "resend";
import { getMarketIntelDeliveryConfig } from "./market-intel-delivery";
import { createSupabaseServerClient } from "./supabase-server";
import { renderKingmakerMorningIntelligenceEmail } from "./kingmaker-morning-intelligence-email";
import { buildLiveKingmakerMorningIntelligence } from "./kingmaker-morning-intelligence-live";

const STATE_SCHEMA = "tcos.kingmakerMorningIntelligenceDelivery.v2";
const TIME_ZONE = "America/Denver";
const CLAIM_TTL_SECONDS = 15 * 60;

type DeliveryMode = "full" | "compact" | "withheld";

type DeliveryClaim = {
  id: string;
  delivery_key: string;
  status: string;
  claim_token: string;
  claimed_at: string;
};

function safeErrorCode(value: unknown, fallback: string) {
  const raw = value instanceof Error ? value.message : String(value ?? "");
  const normalized = raw.toLowerCase();
  if (normalized.includes("resend")) return "email_provider_failure";
  if (normalized.includes("timeout")) return "upstream_timeout";
  if (normalized.includes("permission") || normalized.includes("unauthorized")) {
    return "authorization_failure";
  }
  if (normalized.includes("relation") || normalized.includes("column") || normalized.includes("schema")) {
    return "delivery_ledger_unavailable";
  }
  return fallback;
}

function mountainDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function deliverySummary(payload: {
  mode: DeliveryMode;
  reason: string;
  actionableDeals: unknown[];
  meaningfulChanges: unknown[];
  portfolioMovements: unknown[];
  warnings: unknown[];
}) {
  return {
    schema: STATE_SCHEMA,
    reason: payload.reason,
    counts: {
      actionable: payload.actionableDeals.length,
      changes: payload.meaningfulChanges.length,
      portfolio: payload.portfolioMovements.length,
      warnings: payload.warnings.length,
    },
  };
}

async function latestSentFingerprint() {
  const supabase = createSupabaseServerClient({ admin: true });
  const { data, error } = await supabase
    .from("tcos_kingmaker_delivery_runs")
    .select("fingerprint")
    .eq("status", "sent")
    .order("delivered_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`KINGMAKER delivery ledger read failed: ${error.message}`);
  const value = String(data?.fingerprint || "").trim();
  return value || null;
}

async function claimDelivery(input: {
  deliveryKey: string;
  deliveryDate: string;
  fingerprint: string;
  mode: DeliveryMode;
  claimToken: string;
}) {
  const supabase = createSupabaseServerClient({ admin: true });
  const { data, error } = await supabase.rpc("tcos_claim_kingmaker_delivery", {
    p_delivery_key: input.deliveryKey,
    p_delivery_date: input.deliveryDate,
    p_fingerprint: input.fingerprint,
    p_mode: input.mode,
    p_claim_token: input.claimToken,
    p_claim_ttl_seconds: CLAIM_TTL_SECONDS,
  });
  if (error) throw new Error(`KINGMAKER delivery claim failed: ${error.message}`);
  const claim = Array.isArray(data) ? data[0] : data;
  return claim ? (claim as DeliveryClaim) : null;
}

async function updateClaim(
  claim: DeliveryClaim,
  values: Record<string, unknown>,
) {
  const supabase = createSupabaseServerClient({ admin: true });
  const { error } = await supabase
    .from("tcos_kingmaker_delivery_runs")
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq("id", claim.id)
    .eq("claim_token", claim.claim_token)
    .eq("status", "claimed");
  if (error) throw new Error(`KINGMAKER delivery ledger update failed: ${error.message}`);
}

export type DeliverKingmakerMorningIntelligenceOptions = {
  forceFull?: boolean;
  sendEmail?: boolean;
  now?: Date;
};

export async function deliverKingmakerMorningIntelligence(
  options: DeliverKingmakerMorningIntelligenceOptions = {},
) {
  const now = options.now || new Date();
  let previousFingerprint: string | null = null;
  try {
    previousFingerprint = await latestSentFingerprint();
  } catch (error) {
    return {
      ok: false,
      attempted: false,
      delivered: false,
      skipped: true,
      reason: safeErrorCode(error, "delivery_ledger_unavailable"),
      errorCode: safeErrorCode(error, "delivery_ledger_unavailable"),
    };
  }

  const payload = await buildLiveKingmakerMorningIntelligence({
    generatedAt: now.toISOString(),
    previousFingerprint,
    forceFull: options.forceFull,
  });

  if (!payload.shouldDeliver) {
    return {
      ok: true,
      attempted: false,
      delivered: false,
      skipped: true,
      reason: payload.reason,
      payload,
    };
  }

  if (!options.sendEmail) {
    return {
      ok: true,
      attempted: false,
      delivered: false,
      skipped: true,
      reason: "dry_run",
      deliveryDate: mountainDate(now),
      payload,
    };
  }

  const config = getMarketIntelDeliveryConfig();
  if (!config.enabled || !config.configured || !config.apiKey || !config.from) {
    return {
      ok: false,
      attempted: false,
      delivered: false,
      skipped: true,
      reason: "email_configuration_unavailable",
      errorCode: "email_configuration_unavailable",
      payload,
    };
  }

  const deliveryDate = mountainDate(now);
  const deliveryKey = ["kingmaker-morning", deliveryDate, payload.mode, payload.fingerprint].join(":");
  const claimToken = randomUUID();
  let claim: DeliveryClaim | null = null;
  try {
    claim = await claimDelivery({
      deliveryKey,
      deliveryDate,
      fingerprint: payload.fingerprint,
      mode: payload.mode,
      claimToken,
    });
  } catch (error) {
    const errorCode = safeErrorCode(error, "delivery_claim_failed");
    return {
      ok: false,
      attempted: false,
      delivered: false,
      skipped: true,
      reason: errorCode,
      errorCode,
      payload,
    };
  }

  if (!claim) {
    return {
      ok: true,
      attempted: false,
      delivered: false,
      skipped: true,
      reason: "delivery_already_claimed_or_sent",
      deliveryKey,
      payload,
    };
  }

  const email = renderKingmakerMorningIntelligenceEmail(payload);
  const resend = new Resend(config.apiKey);
  const { data, error } = await resend.emails.send({
    from: config.from,
    to: config.recipients,
    subject: email.subject,
    text: email.text,
    html: email.html,
  });

  if (error || !data?.id) {
    const errorCode = safeErrorCode(error, "email_provider_failure");
    try {
      await updateClaim(claim, {
        status: "failed",
        error_code: errorCode,
        payload_summary: deliverySummary(payload),
      });
    } catch {
      // The send already failed; preserve the safe provider result without leaking ledger details.
    }
    return {
      ok: false,
      attempted: true,
      delivered: false,
      skipped: false,
      reason: errorCode,
      errorCode,
      deliveryKey,
      payload,
    };
  }

  const deliveredAt = new Date().toISOString();
  try {
    await updateClaim(claim, {
      status: "sent",
      delivered_at: deliveredAt,
      email_id: data.id,
      error_code: null,
      payload_summary: deliverySummary(payload),
    });
  } catch (error) {
    return {
      ok: false,
      attempted: true,
      delivered: true,
      skipped: false,
      reason: "email_sent_ledger_confirmation_failed",
      errorCode: safeErrorCode(error, "delivery_ledger_confirmation_failed"),
      emailId: data.id,
      deliveredAt,
      deliveryKey,
      payload,
    };
  }

  return {
    ok: true,
    attempted: true,
    delivered: true,
    skipped: false,
    reason: payload.reason,
    emailId: data.id,
    deliveredAt,
    deliveryDate,
    deliveryKey,
    payload,
  };
}
