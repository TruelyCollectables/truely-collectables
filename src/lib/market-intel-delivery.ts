import "server-only";

import { Resend } from "resend";
import {
  type MarketIntelAlertRow,
  type MarketIntelReportRun,
} from "./market-intel-reporting";
import { createSupabaseServerClient } from "./supabase-server";

type DeliveryConfig = {
  configured: boolean;
  enabled: boolean;
  apiKey: string | null;
  from: string | null;
  recipients: string[];
  missing: string[];
};

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeAlert(row: Record<string, unknown>): MarketIntelAlertRow {
  return {
    id: String(row.id),
    listing_id: String(row.listing_id),
    deal_score_id: row.deal_score_id ? String(row.deal_score_id) : null,
    alert_fingerprint: String(row.alert_fingerprint),
    alert_type: String(row.alert_type),
    status: String(row.status),
    deal_label: row.deal_label ? String(row.deal_label) : null,
    title: String(row.title),
    summary: row.summary ? String(row.summary) : null,
    direct_url: String(row.direct_url),
    delivered_cost: nullableNumber(row.delivered_cost),
    market_value: nullableNumber(row.market_value),
    expected_net_profit: nullableNumber(row.expected_net_profit),
    buy_score: nullableNumber(row.buy_score),
    first_qualified_at: String(row.first_qualified_at),
    last_qualified_at: String(row.last_qualified_at),
    sent_at: row.sent_at ? String(row.sent_at) : null,
    dismissed_at: row.dismissed_at ? String(row.dismissed_at) : null,
    metadata: (row.metadata || {}) as Record<string, unknown>,
    created_at: String(row.created_at),
  };
}

function normalizeReport(row: Record<string, unknown>): MarketIntelReportRun {
  return {
    id: String(row.id),
    report_date: String(row.report_date),
    report_type: String(row.report_type),
    status: String(row.status),
    headline: row.headline ? String(row.headline) : null,
    report_markdown: String(row.report_markdown),
    report_json: (row.report_json || {}) as Record<string, unknown>,
    generated_at: String(row.generated_at),
    delivered_at: row.delivered_at ? String(row.delivered_at) : null,
    error_message: row.error_message ? String(row.error_message) : null,
    metadata: (row.metadata || {}) as Record<string, unknown>,
  };
}

function splitRecipients(value: string | undefined) {
  return Array.from(
    new Set(
      String(value || "")
        .split(/[;,\n]/)
        .map((entry) => entry.trim())
        .filter((entry) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(entry)),
    ),
  );
}

export function getMarketIntelDeliveryConfig(): DeliveryConfig {
  const apiKey = process.env.RESEND_API_KEY?.trim() || null;
  const from = process.env.MARKET_INTEL_FROM_EMAIL?.trim() || null;
  const recipients = splitRecipients(process.env.MARKET_INTEL_ALERT_EMAIL);
  const enabled =
    String(process.env.MARKET_INTEL_EMAIL_ENABLED || "true")
      .trim()
      .toLowerCase() !== "false";
  const missing = [
    !apiKey ? "RESEND_API_KEY" : null,
    !from ? "MARKET_INTEL_FROM_EMAIL" : null,
    recipients.length === 0 ? "MARKET_INTEL_ALERT_EMAIL" : null,
  ].filter((value): value is string => Boolean(value));

  return {
    configured: missing.length === 0,
    enabled,
    apiKey,
    from,
    recipients,
    missing,
  };
}

function escapeHtml(value: string | null | undefined) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function money(value: number | null | undefined) {
  return value === null || value === undefined
    ? "—"
    : `$${Number(value).toFixed(2)}`;
}

function label(value: string | null | undefined) {
  return String(value || "watch").replaceAll("_", " ").toUpperCase();
}

function alertPriority(value: string | null | undefined) {
  const priorities: Record<string, number> = {
    too_good_to_be_true: 100,
    steal: 90,
    great_buy: 80,
    good_buy: 70,
    wholesale_opportunity: 60,
    mislisted: 55,
    watch: 10,
  };
  return priorities[String(value || "watch")] || 0;
}

function buildAlertEmail(alerts: MarketIntelAlertRow[]) {
  const sorted = [...alerts].sort(
    (left, right) =>
      alertPriority(right.deal_label) - alertPriority(left.deal_label) ||
      numberValue(right.buy_score) - numberValue(left.buy_score),
  );
  const strongest = sorted[0];
  const subject =
    sorted.length === 1
      ? `${label(strongest.deal_label)}: ${strongest.title.replace(/^.*?—\s*/, "")}`
      : `${label(strongest.deal_label)} + ${sorted.length - 1} more TCOS Market Intel deal${sorted.length - 1 === 1 ? "" : "s"}`;

  const htmlCards = sorted
    .map((alert, index) => {
      const metadata = alert.metadata || {};
      const discount = nullableNumber(metadata.discount_pct);
      const confidence = nullableNumber(metadata.confidence_score);
      const liquidity = nullableNumber(metadata.liquidity_score);
      const risk = nullableNumber(metadata.risk_score);

      return `
        <section style="border:1px solid #d4d4d4;border-radius:12px;padding:18px;margin:0 0 16px;background:#ffffff;">
          <div style="font-size:12px;font-weight:800;letter-spacing:.08em;color:#525252;text-transform:uppercase;">#${index + 1} ${escapeHtml(label(alert.deal_label))}</div>
          <h2 style="font-size:20px;line-height:1.3;margin:8px 0;color:#111111;">${escapeHtml(alert.title.replace(/^.*?—\s*/, ""))}</h2>
          <p style="font-size:14px;line-height:1.6;color:#404040;margin:0 0 12px;">${escapeHtml(alert.summary || "Qualified Beta One opportunity.")}</p>
          <table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 14px;">
            <tr>
              <td style="padding:6px 8px;background:#f5f5f5;font-size:12px;font-weight:700;">Delivered<br><span style="font-size:16px;color:#111;">${escapeHtml(money(alert.delivered_cost))}</span></td>
              <td style="padding:6px 8px;background:#f5f5f5;font-size:12px;font-weight:700;">Market<br><span style="font-size:16px;color:#111;">${escapeHtml(money(alert.market_value))}</span></td>
              <td style="padding:6px 8px;background:#f5f5f5;font-size:12px;font-weight:700;">Net Profit<br><span style="font-size:16px;color:#111;">${escapeHtml(money(alert.expected_net_profit))}</span></td>
              <td style="padding:6px 8px;background:#f5f5f5;font-size:12px;font-weight:700;">Buy Score<br><span style="font-size:16px;color:#111;">${alert.buy_score === null ? "—" : numberValue(alert.buy_score).toFixed(0)}</span></td>
            </tr>
          </table>
          <p style="font-size:12px;color:#525252;margin:0 0 14px;">Discount ${discount === null ? "—" : `${discount.toFixed(1)}%`} · Confidence ${confidence === null ? "—" : confidence.toFixed(0)} · Liquidity ${liquidity === null ? "—" : liquidity.toFixed(0)} · Risk ${risk === null ? "—" : risk.toFixed(0)}</p>
          <a href="${escapeHtml(alert.direct_url)}" style="display:inline-block;background:#111111;color:#ffffff;text-decoration:none;font-size:14px;font-weight:800;padding:11px 16px;border-radius:7px;">OPEN LISTING</a>
        </section>`;
    })
    .join("");

  const text = sorted
    .map(
      (alert, index) =>
        `${index + 1}. ${label(alert.deal_label)} — ${alert.title.replace(/^.*?—\s*/, "")}\nDelivered: ${money(alert.delivered_cost)} | Market: ${money(alert.market_value)} | Expected net: ${money(alert.expected_net_profit)} | Buy Score: ${alert.buy_score?.toFixed(0) || "—"}\n${alert.summary || ""}\nOPEN LISTING: ${alert.direct_url}`,
    )
    .join("\n\n");

  return {
    subject,
    text: `TCOS Market Intel™ Beta One\n\n${text}`,
    html: `<!doctype html><html><body style="margin:0;background:#f4f1ea;font-family:Arial,Helvetica,sans-serif;color:#111;"><div style="max-width:760px;margin:0 auto;padding:24px;"><div style="background:#101418;color:#fff;border-radius:12px;padding:22px;margin-bottom:18px;"><div style="font-size:12px;font-weight:800;letter-spacing:.12em;color:#bef264;text-transform:uppercase;">TCOS Market Intel™ Beta One</div><h1 style="font-size:28px;margin:8px 0 0;">Qualified Deal Alert</h1><p style="color:#d4d4d4;margin:8px 0 0;">${sorted.length} actionable opportunit${sorted.length === 1 ? "y" : "ies"} with exact live listing links.</p></div>${htmlCards}<p style="font-size:11px;color:#737373;text-align:center;">Private market intelligence for Truely Collectables.</p></div></body></html>`,
  };
}

function buildReportEmail(report: MarketIntelReportRun) {
  const safeMarkdown = escapeHtml(report.report_markdown);
  return {
    subject: `TCOS Market Intel Daily — ${report.report_date}${report.headline ? ` — ${report.headline}` : ""}`,
    text: report.report_markdown,
    html: `<!doctype html><html><body style="margin:0;background:#f4f1ea;font-family:Arial,Helvetica,sans-serif;color:#111;"><div style="max-width:820px;margin:0 auto;padding:24px;"><div style="background:#101418;color:#fff;border-radius:12px;padding:22px;"><div style="font-size:12px;font-weight:800;letter-spacing:.12em;color:#bef264;text-transform:uppercase;">TCOS Market Intel™ Beta One</div><h1 style="font-size:28px;margin:8px 0 0;">Daily Intelligence</h1><p style="color:#d4d4d4;margin:8px 0 0;">${escapeHtml(report.report_date)}${report.headline ? ` · ${escapeHtml(report.headline)}` : ""}</p></div><pre style="white-space:pre-wrap;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.65;background:#fff;border:1px solid #d4d4d4;border-radius:12px;padding:22px;margin-top:18px;">${safeMarkdown}</pre><p style="font-size:11px;color:#737373;text-align:center;">Private market intelligence for Truely Collectables.</p></div></body></html>`,
  };
}

function requireConfiguredDelivery() {
  const config = getMarketIntelDeliveryConfig();
  if (!config.enabled) {
    throw new Error("Market Intel email delivery is disabled.");
  }
  if (!config.configured || !config.apiKey || !config.from) {
    throw new Error(
      `Market Intel email delivery is not configured. Missing: ${config.missing.join(", ")}.`,
    );
  }
  return config as DeliveryConfig & {
    configured: true;
    apiKey: string;
    from: string;
  };
}

export async function deliverPendingMarketIntelAlerts(limit = 10) {
  const config = requireConfiguredDelivery();
  const safeLimit = Math.max(1, Math.min(25, Math.round(limit)));
  const supabase = createSupabaseServerClient({ admin: true });
  const { data, error } = await supabase
    .from("tcos_mi_alerts")
    .select("*")
    .eq("status", "pending")
    .order("buy_score", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(safeLimit);
  if (error) throw new Error(error.message);

  const alerts = (data || []).map((row) =>
    normalizeAlert(row as Record<string, unknown>),
  );
  if (alerts.length === 0) {
    return {
      delivered: 0,
      alertIds: [] as string[],
      emailId: null as string | null,
      recipients: config.recipients,
    };
  }

  const resend = new Resend(config.apiKey);
  const email = buildAlertEmail(alerts);
  const { data: sent, error: sendError } = await resend.emails.send({
    from: config.from,
    to: config.recipients,
    subject: email.subject.slice(0, 180),
    html: email.html,
    text: email.text,
  });
  if (sendError || !sent?.id) {
    throw new Error(sendError?.message || "Resend did not return an email ID.");
  }

  const sentAt = new Date().toISOString();
  const alertIds = alerts.map((alert) => alert.id);
  for (const alert of alerts) {
    const metadata = {
      ...alert.metadata,
      email_delivery: {
        provider: "resend",
        email_id: sent.id,
        recipients: config.recipients,
        sent_at: sentAt,
      },
    };
    const { error: updateError } = await supabase
      .from("tcos_mi_alerts")
      .update({
        status: "sent",
        sent_at: sentAt,
        metadata,
      })
      .eq("id", alert.id);
    if (updateError) throw new Error(updateError.message);
  }

  return {
    delivered: alerts.length,
    alertIds,
    emailId: sent.id,
    recipients: config.recipients,
  };
}

export async function deliverDailyMarketIntelReport(reportId?: string) {
  const config = requireConfiguredDelivery();
  const supabase = createSupabaseServerClient({ admin: true });
  let query = supabase
    .from("tcos_mi_report_runs")
    .select("*")
    .eq("report_type", "daily_intelligence");
  query = reportId
    ? query.eq("id", reportId)
    : query.order("generated_at", { ascending: false }).limit(1);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("No generated daily Market Intel report was found.");

  const report = normalizeReport(data as Record<string, unknown>);
  if (report.status === "delivered" && report.delivered_at) {
    return {
      delivered: false,
      alreadyDelivered: true,
      reportId: report.id,
      emailId: String(report.metadata.email_id || "") || null,
      recipients: config.recipients,
    };
  }

  const resend = new Resend(config.apiKey);
  const email = buildReportEmail(report);
  const { data: sent, error: sendError } = await resend.emails.send({
    from: config.from,
    to: config.recipients,
    subject: email.subject.slice(0, 180),
    html: email.html,
    text: email.text,
  });
  if (sendError || !sent?.id) {
    throw new Error(sendError?.message || "Resend did not return an email ID.");
  }

  const deliveredAt = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("tcos_mi_report_runs")
    .update({
      status: "delivered",
      delivered_at: deliveredAt,
      error_message: null,
      metadata: {
        ...report.metadata,
        provider: "resend",
        email_id: sent.id,
        recipients: config.recipients,
        delivered_at: deliveredAt,
      },
    })
    .eq("id", report.id);
  if (updateError) throw new Error(updateError.message);

  return {
    delivered: true,
    alreadyDelivered: false,
    reportId: report.id,
    emailId: sent.id,
    recipients: config.recipients,
  };
}
