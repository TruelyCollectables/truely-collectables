import "server-only";

import { Resend } from "resend";
import { getMarketIntelDeliveryConfig } from "./market-intel-delivery";
import { type MarketIntelReportRun } from "./market-intel-reporting";
import { createSupabaseServerClient } from "./supabase-server";

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function escapeHtml(value: string | null | undefined) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeReport(row: Record<string, unknown>): MarketIntelReportRun {
  return {
    id: String(row.id),
    report_date: String(row.report_date),
    report_type: String(row.report_type),
    status: String(row.status),
    headline: row.headline ? String(row.headline) : null,
    report_markdown: String(row.report_markdown),
    report_json: recordValue(row.report_json),
    generated_at: String(row.generated_at),
    delivered_at: row.delivered_at ? String(row.delivered_at) : null,
    error_message: row.error_message ? String(row.error_message) : null,
    metadata: recordValue(row.metadata),
  };
}

function inlineMarkdown(value: string) {
  return escapeHtml(value)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(
      /(https?:\/\/[^\s<]+)/g,
      '<a href="$1" style="color:#0369a1;font-weight:800;text-decoration:underline;">$1</a>',
    );
}

function renderMarkdownReport(markdown: string) {
  const lines = markdown.split(/\r?\n/);
  const output: string[] = [];
  let listOpen = false;

  const closeList = () => {
    if (!listOpen) return;
    output.push("</ul>");
    listOpen = false;
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) {
      closeList();
      continue;
    }

    if (trimmed.startsWith("# ")) {
      closeList();
      output.push(
        `<h2 style="font-size:24px;line-height:1.25;margin:24px 0 10px;color:#111111;">${inlineMarkdown(trimmed.slice(2))}</h2>`,
      );
      continue;
    }

    if (trimmed.startsWith("## ")) {
      closeList();
      output.push(
        `<h2 style="border-top:1px solid #e5e5e5;padding-top:20px;font-size:21px;line-height:1.3;margin:24px 0 10px;color:#111111;">${inlineMarkdown(trimmed.slice(3))}</h2>`,
      );
      continue;
    }

    if (trimmed.startsWith("### ")) {
      closeList();
      output.push(
        `<h3 style="font-size:17px;line-height:1.35;margin:18px 0 8px;color:#7f1d1d;">${inlineMarkdown(trimmed.slice(4))}</h3>`,
      );
      continue;
    }

    const bullet = trimmed.match(/^-\s+(.+)$/);
    if (bullet) {
      if (!listOpen) {
        output.push(
          '<ul style="margin:8px 0 16px;padding-left:22px;color:#262626;">',
        );
        listOpen = true;
      }
      output.push(
        `<li style="margin:6px 0;line-height:1.55;">${inlineMarkdown(bullet[1])}</li>`,
      );
      continue;
    }

    const numbered = trimmed.match(/^(\d+)\.\s+(.+)$/);
    if (numbered) {
      closeList();
      output.push(
        `<div style="border:1px solid #d4d4d4;border-radius:10px;padding:14px 16px;margin:12px 0;background:#fafafa;"><div style="font-size:12px;font-weight:900;color:#525252;text-transform:uppercase;letter-spacing:.08em;">Opportunity #${numbered[1]}</div><div style="font-size:16px;line-height:1.5;margin-top:5px;">${inlineMarkdown(numbered[2])}</div></div>`,
      );
      continue;
    }

    closeList();
    output.push(
      `<p style="font-size:14px;line-height:1.65;margin:8px 0;color:#404040;">${inlineMarkdown(trimmed)}</p>`,
    );
  }

  closeList();
  return output.join("");
}

function freshnessBanner(report: MarketIntelReportRun) {
  const freshness = recordValue(report.report_json.sourceFreshness);
  const status = String(freshness.status || "unknown").toLowerCase();
  const refreshedAt = freshness.refreshedAt
    ? new Date(String(freshness.refreshedAt)).toLocaleString("en-US", {
        timeZone: "America/Denver",
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      })
    : "Refresh time unavailable";
  const successful = Number(freshness.successfulTargetCount || 0);
  const active = Number(freshness.activeIdentityCount || 0);
  const complete = status === "complete";

  return `<section style="border:1px solid ${complete ? "#86efac" : "#fcd34d"};background:${complete ? "#f0fdf4" : "#fffbeb"};border-radius:12px;padding:16px 18px;margin:18px 0;"><div style="font-size:12px;font-weight:900;letter-spacing:.1em;text-transform:uppercase;color:${complete ? "#166534" : "#92400e"};">${complete ? "CURRENT SOURCE REFRESH" : "PARTIAL SOURCE REFRESH"}</div><div style="font-size:16px;font-weight:900;margin-top:6px;color:#111111;">${escapeHtml(refreshedAt)}</div><div style="font-size:13px;line-height:1.55;margin-top:5px;color:#404040;">${successful}/${active} active exact-card identities refreshed immediately before this report.</div></section>`;
}

function buildDailyReportEmail(report: MarketIntelReportRun) {
  const subject = `TCOS Market Intel Daily — ${report.report_date}${report.headline ? ` — ${report.headline}` : ""}`;
  const reportBody = renderMarkdownReport(report.report_markdown);

  return {
    subject,
    text: report.report_markdown,
    html: `<!doctype html><html><body style="margin:0;background:#f4f1ea;font-family:Arial,Helvetica,sans-serif;color:#111111;"><div style="max-width:820px;margin:0 auto;padding:24px;"><header style="background:#101418;color:#ffffff;border-radius:14px;padding:24px;"><div style="font-size:12px;font-weight:900;letter-spacing:.12em;color:#bef264;text-transform:uppercase;">TCOS Market Intel™ Beta One</div><h1 style="font-size:30px;line-height:1.2;margin:8px 0 0;">Daily Intelligence</h1><p style="color:#d4d4d4;margin:8px 0 0;line-height:1.5;">${escapeHtml(report.report_date)}${report.headline ? ` · ${escapeHtml(report.headline)}` : ""}</p></header>${freshnessBanner(report)}<main style="background:#ffffff;border:1px solid #d4d4d4;border-radius:14px;padding:22px;margin-top:18px;">${reportBody}</main><p style="font-size:11px;color:#737373;text-align:center;line-height:1.5;margin:18px 0 0;">Private market intelligence for Truely Collectables. Active asks never create verified sold-market value.</p></div></body></html>`,
  };
}

export async function deliverFreshDailyMarketIntelReport(reportId?: string) {
  const config = getMarketIntelDeliveryConfig();
  if (!config.enabled) {
    throw new Error("Market Intel email delivery is disabled.");
  }
  if (!config.configured || !config.apiKey || !config.from) {
    throw new Error(
      `Market Intel email delivery is not configured. Missing: ${config.missing.join(", ")}.`,
    );
  }

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
  const email = buildDailyReportEmail(report);
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
        renderer: "structured-market-intel-v2",
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
