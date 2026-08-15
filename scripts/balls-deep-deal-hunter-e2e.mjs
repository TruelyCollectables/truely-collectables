import fs from 'node:fs';

const cronSecret = String(process.env.TCOS_CRON_SECRET || '').trim();
const base = 'https://truelycollectables.com';
const native = '/api/tcos/deal-hunter-native-ebay?perQuery=5&scope=';
const deliveryEndpoint = `${base}/api/tcos/deal-hunter-balls-deep-delivery`;
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
          'User-Agent': 'truely-collectables-balls-deep-e2e/3.0',
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

async function sendProductionEmailProof(summary) {
  if (!cronSecret) {
    throw new Error('BALLS DEEP cannot prove email delivery because TCOS_CRON_SECRET is unavailable to this Actions job.');
  }

  for (let attempt = 1; attempt <= 30; attempt += 1) {
    const response = await fetch(deliveryEndpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${cronSecret}`,
        'Content-Type': 'application/json',
        'User-Agent': 'truely-collectables-balls-deep-e2e/3.0',
      },
      body: JSON.stringify(summary),
      redirect: 'manual',
      signal: AbortSignal.timeout(45_000),
    });

    if ((response.status === 404 || response.status === 405) && attempt < 30) {
      console.log(
        `BALLS DEEP production email endpoint is not on the routed Worker yet (HTTP ${response.status}); waiting for the current Cloudflare release before retrying.`,
      );
      await sleep(15_000);
      continue;
    }

    const payload = await response.json().catch(() => null);
    const origin = response.headers.get('x-truely-origin');
    const accepted =
      response.status === 200 &&
      origin === 'cloudflare-worker' &&
      payload?.ok === true &&
      payload?.emailAccepted === true &&
      payload?.providerIdPresent === true &&
      Number(payload?.recipientCount || 0) > 0;

    if (!accepted) {
      throw new Error(
        `BALLS DEEP production email proof failed: HTTP ${response.status}, origin=${origin || 'missing'}, accepted=${payload?.emailAccepted === true}, providerIdPresent=${payload?.providerIdPresent === true}.`,
      );
    }

    console.log(
      `BALLS DEEP visible email accepted by the live Cloudflare Worker; provider id present=true; recipients=${payload.recipientCount}.`,
    );
    return {
      emailAccepted: true,
      emailProviderIdPresent: true,
      emailRecipientCount: Number(payload.recipientCount),
      emailSentAt: String(payload.sentAt || ''),
    };
  }

  throw new Error('BALLS DEEP production email endpoint did not become available during the certification window.');
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
const testedAt = new Date().toISOString();
const overall = failedCount === 0 ? 'PASS' : 'FAIL';

const baseResult = {
  overall,
  passedCount,
  failedCount,
  surfaceCount: results.length,
  totalFamilies,
  totalSuccessful,
  totalFailedFamilies,
  results,
  testedAt,
};

if (failedCount > 0) {
  fs.writeFileSync('/tmp/balls-deep-result.json', JSON.stringify(baseResult), { mode: 0o600 });
  throw new Error(
    `BALLS DEEP live Deal Hunter E2E failed: ${failedCount}/${results.length} surfaces failed.`,
  );
}

const emailProof = await sendProductionEmailProof(baseResult);
const finalResult = { ...baseResult, ...emailProof };
fs.writeFileSync('/tmp/balls-deep-result.json', JSON.stringify(finalResult), { mode: 0o600 });

console.log(
  `BALLS DEEP FINAL PASS: ${passedCount}/${results.length} live surfaces, ${totalSuccessful}/${totalFamilies} query families, 0 failed families, production email accepted=true.`,
);
