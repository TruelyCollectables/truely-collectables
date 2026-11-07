import "server-only";

import { Resend } from "resend";
import { getMarketIntelDeliveryConfig } from "./market-intel-delivery";
import { createSupabaseServerClient } from "./supabase-server";

type GrowthAlertRow = {
  id: string;
  deal_label: string | null;
  title: string;
  summary: string | null;
  direct_url: string;
  delivered_cost: number | null;
  market_value: number | null;
  expected_net_profit: number | null;
  buy_score: number | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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

function percent(value: number | null | undefined) {
  return value === null || value === undefined
    ? "—"
    : `${Number(value).toFixed(0)}%`;
}

function multiple(value: number | null | undefined) {
  return value === null || value === undefined
    ? "—"
    : `${Number(value).toFixed(1)}×`;
}

function tierLabel(value: string | null | undefined) {
  return value === "get_your_dick_hard_deal"
    ? "GET YOUR DICK HARD DEAL"
    : "MUST BUY";
}

function tierPriority(value: string | null | undefined) {
  return value === "get_your_dick_hard_deal" ? 200 : 100;
}

function cleanTitle(value: string) {
  return value.replace(/^.*?—\s*/, "");
}

function buildGrowthAlertEmail(alerts: GrowthAlertRow[]) {
  const sorted = [...alerts].sort(
    (left, right) =>
      tierPriority(right.deal_label) - tierPriority(left.deal_label) ||
      numberValue(right.buy_score) - numberValue(left.buy_score),
  );
  const strongest = sorted[0];
  const strongestLabel = tierLabel(strongest.deal_label);
  const subject =
    sorted.length === 1
      ? `🔥 ${strongestLabel} — ${cleanTitle(strongest.title)}`
      : `🔥 ${strongestLabel} + ${sorted.length - 1} more Growth Spec alert${sorted.length - 1 === 1 ? "" : "s"}`;

  const cards = sorted
    .map((alert, index) => {
      const metadata = alert.metadata || {};
      const quantity = numberValue(metadata.quantity, 1);
      const unitCost = nullableNumber(metadata.unit_delivered_cost);
      const targetExit = nullableNumber(metadata.target_exit_price);
      const expectedSold = nullableNumber(metadata.expected_units_sold);
      const roi = nullableNumber(metadata.projected_roi_pct);
      const upside = nullableNumber(metadata.upside_multiple);
      const breakEven = nullableNumber(metadata.break_even_units);
      const safety = nullableNumber(metadata.margin_of_safety_units);
      const risk = nullableNumber(metadata.risk_score);
      const growthScore = nullableNumber(metadata.growth_score);
      const sampleSize = nullableNumber(metadata.market_sample_size);
      const catalyst = metadata.catalyst ? String(metadata.catalyst) : null;
      const scope = metadata.professional_scope
        ? String(metadata.professional_scope).replaceAll("_", " ")
        : "licensed professional card";

      return `
        <section style="border:2px solid ${alert.deal_label === "get_your_dick_hard_deal" ? "#c026d3" : "#dc2626"};border-radius:14px;padding:20px;margin:0 0 18px;background:#ffffff;">
          <div style="font-size:12px;font-weight:900;letter-spacing:.09em;color:${alert.deal_label === "get_your_dick_hard_deal" ? "#86198f" : "#991b1b"};text-transform:uppercase;">#${index + 1} ${escapeHtml(tierLabel(alert.deal_label))}</div>
          <h2 style="font-size:21px;line-height:1.3;margin:8px 0;color:#111111;">${escapeHtml(cleanTitle(alert.title))}</h2>
          <p style="font-size:14px;line-height:1.6;color:#404040;margin:0 0 14px;">${escapeHtml(alert.summary || "Exceptional Growth Spec opportunity.")}</p>
          <table role="presentation" style="width:100%;border-collapse:separate;border-spacing:4px;margin:0 0 14px;">
            <tr>
              <td style="padding:8px;background:#f5f5f5;font-size:12px;font-weight:800;">Lot Delivered<br><span style="font-size:17px;color:#111;">${escapeHtml(money(alert.delivered_cost))}</span></td>
              <td style="padding:8px;background:#f5f5f5;font-size:12px;font-weight:800;">Cost / Card<br><span style="font-size:17px;color:#111;">${escapeHtml(money(unitCost))}</span></td>
              <td style="padding:8px;background:#f5f5f5;font-size:12px;font-weight:800;">Quantity<br><span style="font-size:17px;color:#111;">${quantity}</span></td>
              <td style="padding:8px;background:#f5f5f5;font-size:12px;font-weight:800;">Target / Card<br><span style="font-size:17px;color:#111;">${escapeHtml(money(targetExit))}</span></td>
            </tr>
            <tr>
              <td style="padding:8px;background:#f5f5f5;font-size:12px;font-weight:800;">Projected Net<br><span style="font-size:17px;color:#111;">${escapeHtml(money(alert.expected_net_profit))}</span></td>
              <td style="padding:8px;background:#f5f5f5;font-size:12px;font-weight:800;">Projected ROI<br><span style="font-size:17px;color:#111;">${escapeHtml(percent(roi))}</span></td>
              <td style="padding:8px;background:#f5f5f5;font-size:12px;font-weight:800;">Upside<br><span style="font-size:17px;color:#111;">${escapeHtml(multiple(upside))}</span></td>
              <td style="padding:8px;background:#f5f5f5;font-size:12px;font-weight:800;">Growth / Risk<br><span style="font-size:17px;color:#111;">${growthScore?.toFixed(0) || "—"} / ${risk?.toFixed(0) || "—"}</span></td>
            </tr>
          </table>
          <p style="font-size:12px;line-height:1.6;color:#525252;margin:0 0 6px;">Expected sold ${expectedSold?.toFixed(0) || "—"} · Break-even ${breakEven?.toFixed(0) || "—"} · Safety units ${safety?.toFixed(0) || "—"} · Market samples ${sampleSize?.toFixed(0) || "0"}</p>
          <p style="font-size:12px;line-height:1.6;color:#525252;margin:0 0 6px;text-transform:capitalize;">Scope: ${escapeHtml(scope)}</p>
          ${catalyst ? `<p style="font-size:13px;line-height:1.6;color:#262626;margin:8px 0 14px;"><strong>Catalyst:</strong> ${escapeHtml(catalyst)}</p>` : ""}
          <a href="${escapeHtml(alert.direct_url)}" style="display:inline-block;background:#111111;color:#ffffff;text-decoration:none;font-size:14px;font-weight:900;padding:12px 18px;border-radius:7px;">OPEN LIVE LISTING</a>
        </section>`;
    })
    .join("");

  const text = sorted
    .map((alert, index) => {
      const metadata = alert.metadata || {};
      return `${index + 1}. ${tierLabel(alert.deal_label)} — ${cleanTitle(alert.title)}\nLot: ${money(alert.delivered_cost)} | Cost/card: ${money(nullableNumber(metadata.unit_delivered_cost))} | Qty: ${numberValue(metadata.quantity, 1)} | Target/card: ${money(nullableNumber(metadata.target_exit_price))}\nProjected net: ${money(alert.expected_net_profit)} | ROI: ${percent(nullableNumber(metadata.projected_roi_pct))} | Upside: ${multiple(nullableNumber(metadata.upside_multiple))} | Break-even: ${nullableNumber(metadata.break_even_units)?.toFixed(0) || "—"}\n${alert.summary || ""}\nOPEN LIVE LISTING: ${alert.direct_url}`;
    })
    .join("\n\n");

  return {
    subject,
    text: `TCOS Market Intel™ Growth Spec Alert\n\n${text}\n\nFuture-exit projections are scenarios, not guaranteed returns.`,
    html: `<!doctype html><html><body style="margin:0;background:#f4f1ea;font-family:Arial,Helvetica,sans-serif;color:#111;"><div style="max-width:800px;margin:0 auto;padding:24px;"><div style="background:#101418;color:#fff;border-radius:14px;padding:24px;margin-bottom:18px;"><div style="font-size:12px;font-weight:900;letter-spacing:.12em;color:#f0abfc;text-transform:uppercase;">TCOS Market Intel™ Growth Spec Lab™</div><h1 style="font-size:30px;margin:8px 0 0;">${escapeHtml(strongestLabel)}</h1><p style="color:#d4d4d4;margin:8px 0 0;">${sorted.length} exceptional licensed-professional non-base opportunit${sorted.length === 1 ? "y" : "ies"} with live listing links.</p></div>${cards}<div style="border:1px solid #f59e0b;background:#fffbeb;border-radius:10px;padding:14px;font-size:12px;line-height:1.6;color:#78350f;"><strong>Projection warning:</strong> These are modeled future-exit scenarios based on current data, lot economics, and player catalysts. They are not guaranteed returns.</div><p style="font-size:11px;color:#737373;text-align:center;">Private market intelligence for Truely Collectables.</p></div></body></html>`,
  };
}

export async function deliverPendingGrowthSpecAlerts(limit = 10) {
  const config = getMarketIntelDeliveryConfig();
  if (!config.enabled) {
    throw new Error("Market Intel email delivery is disabled.");
  }
  if (!config.configured || !config.apiKey || !config.from) {
    throw new Error(
      `Growth Spec email delivery is not configured. Missing: ${config.missing.join(", ")}.`,
    );
  }

  const safeLimit = Math.max(1, Math.min(25, Math.round(limit)));
  const supabase = createSupabaseServerClient({ admin: true });
  const { data, error } = await supabase
    .from("tcos_mi_alerts")
    .select(
      "id,deal_label,title,summary,direct_url,delivered_cost,market_value,expected_net_profit,buy_score,metadata,created_at",
    )
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(100);
  if (error) throw new Error(error.message);

  const alerts = ((data || []) as GrowthAlertRow[])
    .filter((alert) => alert.metadata?.alert_engine === "growth_spec")
    .sort(
      (left, right) =>
        tierPriority(right.deal_label) - tierPriority(left.deal_label) ||
        numberValue(right.buy_score) - numberValue(left.buy_score),
    )
    .slice(0, safeLimit);

  if (alerts.length === 0) {
    return {
      delivered: 0,
      alertIds: [] as string[],
      emailId: null as string | null,
      recipients: config.recipients,
    };
  }

  const resend = new Resend(config.apiKey);
  const email = buildGrowthAlertEmail(alerts);
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
  const alertIds: string[] = [];
  for (const alert of alerts) {
    const metadata = {
      ...alert.metadata,
      growth_email_delivery: {
        provider: "resend",
        email_id: sent.id,
        recipients: config.recipients,
        sent_at: sentAt,
      },
    };
    const { error: updateError } = await supabase
      .from("tcos_mi_alerts")
      .update({ status: "sent", sent_at: sentAt, metadata })
      .eq("id", alert.id);
    if (updateError) throw new Error(updateError.message);
    alertIds.push(alert.id);
  }

  return {
    delivered: alertIds.length,
    alertIds,
    emailId: sent.id,
    recipients: config.recipients,
  };
}
