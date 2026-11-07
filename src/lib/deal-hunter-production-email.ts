import "server-only";

import { Resend } from "resend";
import { getMarketIntelDeliveryConfig } from "./market-intel-delivery";

export type DealHunterProductionSurfaceResult = {
  label: string;
  passed: boolean;
  status: number;
  origin: string;
  families: number;
  successful: number;
  failed: number;
  raw: number;
  deduped: number;
};

export type DealHunterProductionSummary = {
  overall: "PASS";
  passedCount: number;
  failedCount: 0;
  surfaceCount: number;
  totalFamilies: number;
  totalSuccessful: number;
  totalFailedFamilies: 0;
  results: DealHunterProductionSurfaceResult[];
  testedAt: string;
};

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export async function sendDealHunterProductionEmail(summary: DealHunterProductionSummary) {
  const config = getMarketIntelDeliveryConfig();
  if (!config.enabled) throw new Error("Market Intel email delivery is disabled.");
  if (!config.configured || !config.apiKey || !config.from) {
    throw new Error(`Market Intel email delivery is not configured. Missing: ${config.missing.join(", ")}.`);
  }

  const sentAt = new Date().toISOString();
  const subject = `Deal Hunter Production E2E — PASS ${summary.passedCount}/${summary.surfaceCount}`;
  const textRows = summary.results.map(
    (entry) => `PASS — ${entry.label}: query families ${entry.successful}/${entry.families}, failed ${entry.failed}, raw ${entry.raw}, deduped ${entry.deduped}, HTTP ${entry.status}`,
  );
  const text = [
    "TCOS Deal Hunter — PRODUCTION END-TO-END TEST",
    "",
    "Overall: PASS",
    `Live surfaces passed: ${summary.passedCount}/${summary.surfaceCount}`,
    `Query families completed: ${summary.totalSuccessful}/${summary.totalFamilies}`,
    "Failed query families: 0",
    `Production routes tested at: ${summary.testedAt}`,
    `Email sent at: ${sentAt}`,
    "",
    ...textRows,
    "",
    "This proof email was sent by the live truelycollectables.com Cloudflare production Worker using its server-side Market Intel delivery configuration.",
    "No marketplace purchase, listing mutation, or Deal Hunter ledger mutation was performed.",
  ].join("\n");

  const htmlRows = summary.results
    .map((entry) => `<tr><td style="padding:8px;border-bottom:1px solid #ddd;font-weight:800;">PASS</td><td style="padding:8px;border-bottom:1px solid #ddd;">${escapeHtml(entry.label)}</td><td style="padding:8px;border-bottom:1px solid #ddd;">${entry.successful}/${entry.families}</td><td style="padding:8px;border-bottom:1px solid #ddd;">${entry.raw}</td><td style="padding:8px;border-bottom:1px solid #ddd;">${entry.deduped}</td><td style="padding:8px;border-bottom:1px solid #ddd;">${entry.status}</td></tr>`)
    .join("");

  const html = `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;background:#f4f1ea;color:#111;margin:0;padding:24px;"><div style="max-width:900px;margin:auto;background:#fff;border-radius:14px;padding:24px;"><div style="background:#111;color:#fff;border-radius:12px;padding:22px;"><div style="font-size:14px;font-weight:900;letter-spacing:.14em;">TCOS DEAL HUNTER</div><h1 style="margin:8px 0 0;">Production E2E — PASS</h1><p>${summary.passedCount}/${summary.surfaceCount} live surfaces passed · ${summary.totalSuccessful}/${summary.totalFamilies} query families complete · 0 failed families</p></div><table style="width:100%;border-collapse:collapse;margin-top:20px;"><thead><tr><th style="text-align:left;padding:8px;">Result</th><th style="text-align:left;padding:8px;">Scope</th><th style="text-align:left;padding:8px;">Families</th><th style="text-align:left;padding:8px;">Raw</th><th style="text-align:left;padding:8px;">Deduped</th><th style="text-align:left;padding:8px;">HTTP</th></tr></thead><tbody>${htmlRows}</tbody></table><p style="font-size:13px;line-height:1.6;margin-top:20px;">This proof email was sent by the live truelycollectables.com Cloudflare production Worker using its private server-side delivery configuration. No marketplace or ledger mutations were performed.</p><p style="font-size:12px;color:#666;">Routes tested: ${escapeHtml(summary.testedAt)}<br>Email sent: ${escapeHtml(sentAt)}</p></div></body></html>`;

  const resend = new Resend(config.apiKey);
  const { data, error } = await resend.emails.send({ from: config.from, to: config.recipients, subject, text, html });
  if (error || !data?.id) throw new Error(error?.message || "Resend did not return an email ID.");

  return { accepted: true as const, providerIdPresent: true as const, recipientCount: config.recipients.length, sentAt };
}
