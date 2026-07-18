import "server-only";

import { Resend } from "resend";
import { getMarketIntelDeliveryConfig } from "./market-intel-delivery";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export async function sendMarketIntelTestEmail() {
  const config = getMarketIntelDeliveryConfig();

  if (!config.enabled) {
    throw new Error("Market Intel email delivery is disabled.");
  }

  if (!config.configured || !config.apiKey || !config.from) {
    throw new Error(
      `Market Intel email delivery is not configured. Missing: ${config.missing.join(", ")}.`,
    );
  }

  const sentAt = new Date().toISOString();
  const resend = new Resend(config.apiKey);
  const subject = "TCOS Market Intel™ test — alert delivery is armed";
  const text = [
    "TCOS Market Intel™ email test succeeded.",
    "",
    `Sent at: ${sentAt}`,
    `From: ${config.from}`,
    `Recipients: ${config.recipients.join(", ")}`,
    "",
    "This confirms that Vercel, Resend, the verified sending domain, and the private alert inbox are connected.",
    "No live deal was created and no marketplace listing was changed.",
  ].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#f4f1ea;font-family:Arial,Helvetica,sans-serif;color:#111;"><div style="max-width:720px;margin:0 auto;padding:24px;"><section style="background:#101418;color:#fff;border-radius:14px;padding:24px;"><div style="font-size:12px;font-weight:800;letter-spacing:.12em;color:#bef264;text-transform:uppercase;">TCOS Market Intel™</div><h1 style="font-size:30px;line-height:1.2;margin:8px 0 0;">Alert delivery is armed</h1><p style="color:#d4d4d4;margin:10px 0 0;line-height:1.6;">This controlled test reached Resend from the production Market Intel delivery configuration.</p></section><section style="border:1px solid #d4d4d4;border-radius:14px;background:#fff;padding:22px;margin-top:18px;"><h2 style="font-size:22px;margin:0 0 14px;">End-to-end test passed</h2><p style="line-height:1.65;margin:0 0 14px;">Vercel environment variables, the Resend API key, verified sender domain, and private recipient list are connected.</p><table role="presentation" style="width:100%;border-collapse:collapse;"><tr><td style="padding:10px;background:#f5f5f5;font-size:12px;font-weight:700;">Sent at<br><span style="font-size:15px;color:#111;">${escapeHtml(sentAt)}</span></td></tr><tr><td style="padding:10px;background:#fafafa;font-size:12px;font-weight:700;">From<br><span style="font-size:15px;color:#111;">${escapeHtml(config.from)}</span></td></tr><tr><td style="padding:10px;background:#f5f5f5;font-size:12px;font-weight:700;">To<br><span style="font-size:15px;color:#111;">${escapeHtml(config.recipients.join(", "))}</span></td></tr></table><p style="font-size:13px;color:#525252;line-height:1.6;margin:16px 0 0;">No fake deal was inserted, no alert thresholds were bypassed, and no marketplace listing was changed.</p></section><p style="font-size:11px;color:#737373;text-align:center;">Private market intelligence for Truely Collectables.</p></div></body></html>`;

  const { data, error } = await resend.emails.send({
    from: config.from,
    to: config.recipients,
    subject,
    text,
    html,
  });

  if (error || !data?.id) {
    throw new Error(error?.message || "Resend did not return an email ID.");
  }

  return {
    emailId: data.id,
    from: config.from,
    recipients: config.recipients,
    sentAt,
  };
}
