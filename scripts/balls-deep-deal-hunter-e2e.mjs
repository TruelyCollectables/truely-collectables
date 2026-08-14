import fs from 'node:fs';

const delivery = JSON.parse(fs.readFileSync('/tmp/balls-deep-delivery-env.json', 'utf8'));
const base = 'https://truelycollectables.com';
const native = '/api/tcos/deal-hunter-native-ebay?perQuery=5&scope=';
const targets = [
  { label: 'WNBA', url: `${base}${native}wnba` },
  { label: 'IVAN DEMIDOV', url: `${base}${native}ivan_demidov` },
  { label: 'MATVEI MICHKOV YOUNG GUNS', url: `${base}${native}matvei_michkov_young_guns` },
  { label: 'BASEBALL PROSPECTS', url: `${base}${native}baseball_prospects` },
  { label: 'SIGNED BASEBALLS', url: `${base}${native}signed_baseballs` },
  { label: 'ALL BUILT-IN SCOPES', url: `${base}${native}all` },
  { label: 'MICHKOV OPC PLATINUM', url: `${base}/api/tcos/deal-hunter-michkov-opc-platinum?perQuery=5` },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runTarget(target) {
  let last = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const separator = target.url.includes('?') ? '&' : '?';
    const url = `${target.url}${separator}balls_deep=${Date.now()}-${attempt}`;
    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'truely-collectables-balls-deep-e2e/2.0',
        },
        redirect: 'manual',
        signal: AbortSignal.timeout(90_000),
      });
      const payload = await response.json().catch(() => null);
      const families = Number(payload?.queryFamilyCount || 0);
      const successful = Number(payload?.successfulQueryCount || 0);
      const failed = Number(payload?.failedQueryCount || 0);
      const origin = response.headers.get('x-truely-origin');
      const passed =
        response.status === 200 &&
        origin === 'cloudflare-worker' &&
        payload?.ok === true &&
        payload?.schema === 'TCOS_NATIVE_EBAY_FEED_V1' &&
        payload?.nativeEbayUsed === true &&
        families > 0 &&
        successful === families &&
        failed === 0;

      last = {
        label: target.label,
        passed,
        status: response.status,
        origin: origin || 'missing',
        families,
        successful,
        failed,
        raw: Number(payload?.rawResultCount || 0),
        deduped: Number(payload?.deduplicatedResultCount || 0),
        durationMs: Number(payload?.durationMs || 0),
        deployment: payload?.deployment?.commitSha || null,
        errorCodes: Array.isArray(payload?.errors)
          ? payload.errors.map((entry) => entry?.code).filter(Boolean)
          : [],
      };

      console.log(
        `BALLS DEEP ${target.label}: ${passed ? 'PASS' : 'FAIL'} status=${response.status} families=${successful}/${families} failed=${failed} raw=${last.raw} deduped=${last.deduped}`,
      );
      if (passed) return last;
    } catch (error) {
      last = {
        label: target.label,
        passed: false,
        status: 0,
        origin: 'request-error',
        families: 0,
        successful: 0,
        failed: 0,
        raw: 0,
        deduped: 0,
        durationMs: 0,
        deployment: null,
        errorCodes: [error instanceof Error ? error.name : 'request_error'],
      };
      console.log(
        `BALLS DEEP ${target.label}: attempt ${attempt} request error; retrying if possible.`,
      );
    }
    if (attempt < 3) await sleep(8_000);
  }
  return last;
}

const results = [];
for (const target of targets) {
  results.push(await runTarget(target));
}

const passedCount = results.filter((entry) => entry?.passed).length;
const failedCount = results.length - passedCount;
const totalFamilies = results.reduce((sum, entry) => sum + Number(entry?.families || 0), 0);
const totalSuccessful = results.reduce((sum, entry) => sum + Number(entry?.successful || 0), 0);
const totalFailedFamilies = results.reduce((sum, entry) => sum + Number(entry?.failed || 0), 0);
const sentAt = new Date().toISOString();
const overall = failedCount === 0 ? 'PASS' : 'FAIL';

const rows = results.map((entry) => {
  const status = entry?.passed ? 'PASS' : 'FAIL';
  const codes = entry?.errorCodes?.length ? ` | ${entry.errorCodes.join(',')}` : '';
  return `${status} — ${entry.label}: query families ${entry.successful}/${entry.families}, failed ${entry.failed}, raw ${entry.raw}, deduped ${entry.deduped}, HTTP ${entry.status}${codes}`;
});

const subject = `BALLS DEEP — Deal Hunter LIVE E2E — ${overall} ${passedCount}/${results.length}`;
const text = [
  'BALLS DEEP',
  'TCOS Deal Hunter — LIVE PRODUCTION END-TO-END TEST',
  '',
  `Overall: ${overall}`,
  `Live surfaces passed: ${passedCount}/${results.length}`,
  `Query families completed: ${totalSuccessful}/${totalFamilies}`,
  `Failed query families: ${totalFailedFamilies}`,
  `Sent at: ${sentAt}`,
  '',
  ...rows,
  '',
  'This test queried the live truelycollectables.com Cloudflare production routes and then used the production Market Intel Resend delivery configuration for this message.',
  'No marketplace purchase, listing mutation, or Deal Hunter ledger mutation was performed.',
].join('\n');

const escapeHtml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const htmlRows = results
  .map(
    (entry) => `<tr><td style="padding:8px;border-bottom:1px solid #ddd;font-weight:800;">${entry?.passed ? 'PASS' : 'FAIL'}</td><td style="padding:8px;border-bottom:1px solid #ddd;">${escapeHtml(entry.label)}</td><td style="padding:8px;border-bottom:1px solid #ddd;">${entry.successful}/${entry.families}</td><td style="padding:8px;border-bottom:1px solid #ddd;">${entry.raw}</td><td style="padding:8px;border-bottom:1px solid #ddd;">${entry.deduped}</td><td style="padding:8px;border-bottom:1px solid #ddd;">${entry.status}</td></tr>`,
  )
  .join('');

const html = `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;background:#f4f1ea;color:#111;margin:0;padding:24px;"><div style="max-width:900px;margin:auto;background:#fff;border-radius:14px;padding:24px;"><div style="background:#111;color:#fff;border-radius:12px;padding:22px;"><div style="font-size:14px;font-weight:900;letter-spacing:.14em;">BALLS DEEP</div><h1 style="margin:8px 0 0;">Deal Hunter LIVE E2E — ${overall}</h1><p>${passedCount}/${results.length} live surfaces passed · ${totalSuccessful}/${totalFamilies} query families complete · ${totalFailedFamilies} failed families</p></div><table style="width:100%;border-collapse:collapse;margin-top:20px;"><thead><tr><th style="text-align:left;padding:8px;">Result</th><th style="text-align:left;padding:8px;">Scope</th><th style="text-align:left;padding:8px;">Families</th><th style="text-align:left;padding:8px;">Raw</th><th style="text-align:left;padding:8px;">Deduped</th><th style="text-align:left;padding:8px;">HTTP</th></tr></thead><tbody>${htmlRows}</tbody></table><p style="font-size:13px;line-height:1.6;margin-top:20px;">This came from the live truelycollectables.com Cloudflare production routes and the production Market Intel Resend delivery configuration. No marketplace or ledger mutations were performed.</p><p style="font-size:12px;color:#666;">${escapeHtml(sentAt)}</p></div></body></html>`;

const apiKey = String(delivery.RESEND_API_KEY || '').trim();
const from = String(delivery.MARKET_INTEL_FROM_EMAIL || '').trim();
const recipients = Array.from(
  new Set(
    String(delivery.MARKET_INTEL_ALERT_EMAIL || '')
      .split(/[;,\n]/)
      .map((entry) => entry.trim())
      .filter((entry) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(entry)),
  ),
);
const enabled =
  String(delivery.MARKET_INTEL_EMAIL_ENABLED ?? 'true').trim().toLowerCase() !== 'false';

if (!enabled) {
  throw new Error('Production Market Intel email delivery is disabled; BALLS DEEP email not sent.');
}
if (!apiKey || !from || recipients.length === 0) {
  throw new Error('Production Market Intel delivery configuration is incomplete; BALLS DEEP email not sent.');
}

const emailResponse = await fetch('https://api.resend.com/emails', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'User-Agent': 'truely-collectables-balls-deep-e2e/2.0',
  },
  body: JSON.stringify({ from, to: recipients, subject, text, html }),
  redirect: 'manual',
  signal: AbortSignal.timeout(30_000),
});
const emailPayload = await emailResponse.json().catch(() => null);
if (!emailResponse.ok || !emailPayload?.id) {
  throw new Error(`BALLS DEEP production email submission failed with HTTP ${emailResponse.status}.`);
}

console.log(
  `BALLS DEEP visible email accepted by production Resend configuration; provider id present=${Boolean(emailPayload.id)}; recipients=${recipients.length}.`,
);

fs.writeFileSync(
  '/tmp/balls-deep-result.json',
  JSON.stringify({
    overall,
    passedCount,
    failedCount,
    surfaceCount: results.length,
    totalFamilies,
    totalSuccessful,
    totalFailedFamilies,
    results,
    emailAccepted: true,
    emailProviderIdPresent: Boolean(emailPayload.id),
    sentAt,
  }),
  { mode: 0o600 },
);

if (failedCount > 0) {
  throw new Error(
    `BALLS DEEP live Deal Hunter E2E failed: ${failedCount}/${results.length} surfaces failed. Results email was still sent.`,
  );
}
