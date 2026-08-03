import "server-only";

import { Resend } from "resend";
import { getMarketIntelDeliveryConfig } from "./market-intel-delivery";
import { createSupabaseServerClient } from "./supabase-server";
import { renderKingmakerMorningIntelligenceEmail } from "./kingmaker-morning-intelligence-email";
import { buildLiveKingmakerMorningIntelligence } from "./kingmaker-morning-intelligence-live";

const STATE_SCHEMA = "tcos.kingmakerMorningIntelligence.v1";
const REPORT_TYPE = "hourly_deals";

function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

async function latestReportRun() {
  const supabase = createSupabaseServerClient({ admin: true });
  const { data, error } = await supabase
    .from("tcos_mi_report_runs")
    .select("id,metadata,generated_at")
    .eq("report_type", REPORT_TYPE)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

async function persistDeliveryState(
  reportId: string,
  metadataValue: unknown,
  state: Record<string, unknown>,
) {
  const supabase = createSupabaseServerClient({ admin: true });
  const { error } = await supabase
    .from("tcos_mi_report_runs")
    .update({ metadata: { ...record(metadataValue), ...state } })
    .eq("id", reportId);
  if (error) throw new Error(error.message);
}

export type DeliverKingmakerMorningIntelligenceOptions = {
  forceFull?: boolean;
  sendEmail?: boolean;
};

export async function deliverKingmakerMorningIntelligence(
  options: DeliverKingmakerMorningIntelligenceOptions = {},
) {
  const report = await latestReportRun();
  const metadata = record(report?.metadata);
  const previousFingerprint = String(
    metadata.kingmaker_morning_fingerprint || "",
  ).trim() || null;

  const payload = await buildLiveKingmakerMorningIntelligence({
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
      reason: `Market Intel email is unavailable. Missing: ${config.missing.join(", ")}.`,
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
    return {
      ok: false,
      attempted: true,
      delivered: false,
      skipped: false,
      reason: error?.message || "Resend did not return an email ID.",
      payload,
    };
  }

  const deliveredAt = new Date().toISOString();
  let persistenceWarning: string | null = null;
  if (report?.id) {
    try {
      await persistDeliveryState(report.id, metadata, {
        kingmaker_morning_schema: STATE_SCHEMA,
        kingmaker_morning_fingerprint: payload.fingerprint,
        kingmaker_morning_email_id: data.id,
        kingmaker_morning_delivered_at: deliveredAt,
        kingmaker_morning_mode: payload.mode,
        kingmaker_morning_counts: {
          actionable: payload.actionableDeals.length,
          changes: payload.meaningfulChanges.length,
          portfolio: payload.portfolioMovements.length,
          warnings: payload.warnings.length,
        },
      });
    } catch (errorValue) {
      persistenceWarning = errorValue instanceof Error
        ? errorValue.message
        : String(errorValue);
    }
  } else {
    persistenceWarning = "Email delivered, but no current Market Intel report row existed for fingerprint persistence.";
  }

  return {
    ok: true,
    attempted: true,
    delivered: true,
    skipped: false,
    reason: payload.reason,
    emailId: data.id,
    deliveredAt,
    persistenceWarning,
    payload,
  };
}
