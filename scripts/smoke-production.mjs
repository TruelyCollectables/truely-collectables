import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const baseUrl = normalizeSmokeOrigin(
  process.env.SMOKE_BASE_URL || "https://truely-collectables.vercel.app",
  "SMOKE_BASE_URL",
);
const unwantedAliasUrl = normalizeSmokeOrigin(
  process.env.SMOKE_UNWANTED_ALIAS_URL ||
    "https://truely-collectables-tt3b.vercel.app",
  "SMOKE_UNWANTED_ALIAS_URL",
);
const requestTimeoutMs = Math.max(
  1000,
  Number(process.env.SMOKE_REQUEST_TIMEOUT_MS || 15000) || 15000,
);
const redactionSelfTest = process.argv.includes("--self-test-redaction");

function optionalRunResult(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell: process.platform === "win32",
  });

  return {
    ok: result.status === 0,
    output: `${result.stdout || ""}${result.stderr || ""}`.trim(),
  };
}

function optionalRun(command, args) {
  const result = optionalRunResult(command, args);

  if (!result.ok) return "";

  return result.output;
}

function normalizeSmokeOrigin(value, label) {
  const trimmed = value.trim();

  if (!trimmed) {
    throw new Error(`${label} cannot be empty.`);
  }

  const urlText = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    return new URL(urlText).origin.toLowerCase();
  } catch {
    throw new Error(`${label} must be a valid production URL or hostname.`);
  }
}

function envValueFromLocalFile(key) {
  try {
    const raw = readFileSync(".env.local", "utf8");
    const line = raw
      .split(/\r?\n/)
      .find((entry) => entry.trim().startsWith(`${key}=`));

    if (!line) return "";

    return line
      .replace(new RegExp(`^${key}\\s*=\\s*`), "")
      .trim()
      .replace(/^["']|["']$/g, "");
  } catch {
    return "";
  }
}

const adminPassword =
  process.env.SMOKE_ADMIN_PASSWORD ||
  process.env.ADMIN_PASSWORD ||
  envValueFromLocalFile("ADMIN_PASSWORD");

function hostFor(url) {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return "";
  }
}

if (hostFor(baseUrl) && hostFor(baseUrl) === hostFor(unwantedAliasUrl)) {
  console.error(
    `Refusing to smoke test the unwanted production alias: ${baseUrl}. Use the clean production domain instead.`,
  );
  process.exit(1);
}

if (!adminPassword && !redactionSelfTest) {
  console.error(
    "Missing admin password. Set SMOKE_ADMIN_PASSWORD or keep ADMIN_PASSWORD in .env.local.",
  );
  process.exit(1);
}

const originRefresh = redactionSelfTest
  ? { ok: true, output: "" }
  : optionalRunResult("git", ["fetch", "origin", "main"]);
const localHead = optionalRun("git", ["rev-parse", "--short", "HEAD"]);
const remoteHead = optionalRun("git", ["rev-parse", "--short", "origin/main"]);

console.log(`Production smoke target: ${baseUrl}`);
if (!redactionSelfTest) {
  console.log(
    `origin/main refresh: ${originRefresh.ok ? "ok" : "failed; continuing with local ref"}`,
  );
}
console.log(`Local HEAD: ${localHead || "unknown"}`);
console.log(`origin/main: ${remoteHead || "unknown"}`);
console.log(`Request timeout: ${requestTimeoutMs}ms`);

function setCookieHeaderValue(response) {
  if (!response) return "";

  if (typeof response.headers.getSetCookie === "function") {
    return response.headers.getSetCookie().join("; ");
  }

  return response.headers.get("set-cookie") || "";
}

async function request(path, options = {}) {
  const startedAt = Date.now();

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      redirect: "manual",
      ...options,
      signal: options.signal || AbortSignal.timeout(requestTimeoutMs),
    });
    const text = await response.text();

    return {
      path,
      status: response.status,
      ok: response.status >= 200 && response.status < 400,
      contentType: response.headers.get("content-type") || "",
      text,
      response,
      error: "",
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      path,
      status: 0,
      ok: false,
      contentType: "",
      text: "",
      response: null,
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt,
    };
  }
}

async function requestUrl(url, options = {}) {
  const startedAt = Date.now();

  try {
    const response = await fetch(url, {
      redirect: "manual",
      ...options,
      signal: options.signal || AbortSignal.timeout(requestTimeoutMs),
    });
    const text = await response.text();

    return {
      path: url,
      status: response.status,
      ok: response.status >= 200 && response.status < 400,
      contentType: response.headers.get("content-type") || "",
      text,
      response,
      error: "",
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      path: url,
      status: 0,
      ok: false,
      contentType: "",
      text: "",
      response: null,
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt,
    };
  }
}

function diagnosticSnippet(text) {
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9_=-]{8,}\b/g, "[redacted-stripe-secret]")
    .replace(/\bpk_(?:live|test)_[A-Za-z0-9_=-]{8,}\b/g, "[redacted-stripe-publishable]")
    .replace(/\bwhsec_[A-Za-z0-9_=-]{8,}\b/g, "[redacted-stripe-webhook]")
    .replace(/\bre_[A-Za-z0-9_=-]{8,}\b/g, "[redacted-resend-key]")
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}\b/gi, "[redacted-auth-header]")
    .replace(
      /\b(access_token|refresh_token|api_key|apikey|client_secret|secret|token|password)=([^&\s"'<>]+)/gi,
      "$1=[redacted-secret]",
    )
    .replace(
      /"((?:access_)?token|refresh_token|api_key|apikey|client_secret|secret|password)"\s*:\s*"[^"]{6,}"/gi,
      '"$1":"[redacted-secret]"',
    )
    .replace(/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g, "[redacted-jwt]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

function safeSnippet(text, error = "") {
  return diagnosticSnippet(`${text || ""} ${error || ""}`);
}

function runRedactionSelfTest() {
  const sample = [
    "sk_live_fakeSecret123456789",
    "rk_live_fakeRestricted123456789",
    "pk_live_fakePublishable123456789",
    "whsec_fakeWebhook123456789",
    "re_fakeResend123456789",
    "Bearer abcdefghijklmnopqrstuvwxyz123456",
    "Basic QWxhZGRpbjpvcGVuIHNlc2FtZTEyMzQ1Ng==",
    "access_token=abc123456789",
    "client_secret=clientSecret123456789",
    "api_key=apiKey123456789",
    '"refresh_token":"refresh123456789"',
    '"password":"password123456789"',
    "eyJabcdefghijklmnopqrstuv.eyJabcdefghijklmnopqrstuv.signatureabcdefghijklmnopqrstuv",
  ].join(" ");
  const snippet = diagnosticSnippet(sample);
  const errorSnippet = safeSnippet("", sample);
  const leakedMarkers = [
    "sk_live_",
    "rk_live_",
    "pk_live_",
    "whsec_",
    "re_fake",
    "Bearer ",
    "Basic ",
    "abc123456789",
    "clientSecret123456789",
    "apiKey123456789",
    "refresh123456789",
    "password123456789",
    "eyJabcdefghijklmnopqrstuv",
  ].filter((marker) => snippet.includes(marker) || errorSnippet.includes(marker));

  if (leakedMarkers.length > 0) {
    throw new Error(
      `Production smoke redaction self-test leaked marker(s): ${leakedMarkers.join(", ")}`,
    );
  }

  console.log("Production smoke redaction self-test passed.");
}

if (redactionSelfTest) {
  runRedactionSelfTest();
  process.exit(0);
}

const login = await request("/api/admin/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ password: adminPassword }),
});
const cookie = setCookieHeaderValue(login.response);
const authHeaders = cookie ? { cookie } : {};

const checks = [
  {
    name: "admin dashboard",
    path: "/admin",
    expect: (result) => result.text.includes("Shipping Setup"),
  },
  {
    name: "launch readiness page",
    path: "/admin/launch-readiness",
    expect: (result) =>
      result.text.includes("Launch Readiness") &&
      result.text.includes("Production Deploy Queue") &&
      result.text.includes("npm run verify:production") &&
      result.text.includes("git fetch origin main") &&
      result.text.includes("git rev-parse --short HEAD") &&
      result.text.includes("git rev-parse --short origin/main") &&
      result.text.includes("git log -5 --oneline") &&
      result.text.includes("npm run check:production-guardrails") &&
      result.text.includes("npm run preflight:production") &&
      result.text.includes("npm run launch:production") &&
      result.text.includes("fourteen-scenario shipping simulation suite") &&
      result.text.includes("LetterTrack evidence checks") &&
      result.text.includes("/api/admin/shipping/simulations") &&
      result.text.includes("no missing/unexpected shipping simulation keys") &&
      result.text.includes("npm run deploy:production") &&
      result.text.includes("npm run smoke:production") &&
      result.text.includes("rolling 24-hour quota reset") &&
      result.text.includes("deploy live safety contract") &&
      result.text.includes("Protected deploy sequence") &&
      result.text.includes("remove unwanted truely-collectables-tt3b.vercel.app alias") &&
      result.text.includes("set clean production alias") &&
      result.text.includes("print DEPLOYED_PRODUCTION") &&
      result.text.includes("print CLEAN_PRODUCTION") &&
      result.text.includes("print smoke handoff command") &&
      result.text.includes("deployed URL output") &&
      result.text.includes("clean URL output") &&
      result.text.includes("truely-collectables.vercel.app") &&
      result.text.includes("truely-collectables-tt3b.vercel.app"),
  },
  {
    name: "launch readiness json",
    path: "/api/admin/launch-readiness",
    expect: (result) =>
      result.contentType.includes("application/json") &&
      result.text.includes('"brief"') &&
      result.text.includes('"deploySafety"') &&
      result.text.includes('"quotaBlockCode":"api-deployments-free-per-day"') &&
      result.text.includes("rolling 24-hour quota reset") &&
      result.text.includes("deployed URL output") &&
      result.text.includes("clean URL output") &&
      result.text.includes('"sequence"') &&
      result.text.includes("remove unwanted truely-collectables-tt3b.vercel.app alias") &&
      result.text.includes("set clean production alias") &&
      result.text.includes("print DEPLOYED_PRODUCTION") &&
      result.text.includes("print CLEAN_PRODUCTION") &&
      result.text.includes("print smoke handoff command") &&
      result.text.includes("npm run smoke:production handoff"),
  },
  {
    name: "launch readiness markdown",
    path: "/api/admin/launch-readiness?format=markdown",
    expect: (result) =>
      result.text.includes("# TCOS Launch Readiness Brief") &&
      result.text.includes("## Production Deploy Safety") &&
      result.text.includes("api-deployments-free-per-day") &&
      result.text.includes("rolling 24-hour quota reset") &&
      result.text.includes("deploy live safety contract") &&
      result.text.includes("Protected deploy sequence:") &&
      result.text.includes("remove unwanted truely-collectables-tt3b.vercel.app alias") &&
      result.text.includes("set clean production alias") &&
      result.text.includes("print DEPLOYED_PRODUCTION") &&
      result.text.includes("print CLEAN_PRODUCTION") &&
      result.text.includes("print smoke handoff command") &&
      result.text.includes("deployed URL output") &&
      result.text.includes("clean URL output") &&
      result.text.includes("npm run smoke:production"),
  },
  {
    name: "launch gate drill page",
    path: "/admin/launch-gate-drill",
    expect: (result) =>
      result.text.includes("Launch Gate Drill") &&
      result.text.includes("No-money runtime smoke") &&
      result.text.includes("Download Drill Report") &&
      result.text.includes("Side-effect Guardrails") &&
      result.text.includes("Not allowed during this drill"),
  },
  {
    name: "launch gate drill json",
    path: "/api/admin/launch-gate-drill",
    expect: (result) =>
      result.contentType.includes("application/json") &&
      result.text.includes('"sideEffectPolicy"') &&
      result.text.includes('"forbiddenOperations"'),
  },
  {
    name: "launch gate drill markdown",
    path: "/api/admin/launch-gate-drill?format=markdown",
    expect: (result) =>
      result.contentType.includes("text/markdown") &&
      result.text.includes("# TCOS Launch Gate Drill Report") &&
      result.text.includes("## Side-effect Guardrails") &&
      result.text.includes("### Forbidden Operations"),
  },
  {
    name: "production smoke report page",
    path: "/admin/production-smoke",
    expect: (result) =>
      result.text.includes("Production Smoke Report") &&
      result.text.includes("Smoke coverage") &&
      result.text.includes(
        "Shipping simulation API POST with scenario count, manifest, and drift-field checks",
      ) &&
      result.text.includes("Queued launch feature failure(s)") &&
      result.text.includes(
        "Unwanted truely-collectables-tt3b.vercel.app alias absence",
      ) &&
      result.text.includes("Deploy live safety contract") &&
      result.text.includes("api-deployments-free-per-day") &&
      result.text.includes("rolling 24-hour quota reset") &&
      result.text.includes("Protected deploy sequence") &&
      result.text.includes("remove unwanted truely-collectables-tt3b.vercel.app alias") &&
      result.text.includes("set clean production alias") &&
      result.text.includes("print DEPLOYED_PRODUCTION") &&
      result.text.includes("print CLEAN_PRODUCTION") &&
      result.text.includes("print smoke handoff command") &&
      result.text.includes("deployed URL output") &&
      result.text.includes("clean URL output") &&
      result.text.includes("npm run launch:production"),
  },
  {
    name: "launch handoff bundle",
    path: "/api/admin/launch-readiness?format=handoff-bundle",
    expect: (result) =>
      result.text.includes("# TCOS Launch Hand-off Bundle") &&
      result.text.includes("## Git Tip Verification") &&
      result.text.includes("git fetch origin main") &&
      result.text.includes("git rev-parse --short HEAD") &&
      result.text.includes("git rev-parse --short origin/main") &&
      result.text.includes("git log -5 --oneline") &&
      result.text.includes("## Production Deploy Commands") &&
      result.text.includes("npm run verify:production") &&
      result.text.includes("npm run launch:production") &&
      result.text.includes("npm run deploy:production") &&
      result.text.includes("npm run smoke:production") &&
      result.text.includes("api-deployments-free-per-day") &&
      result.text.includes("rolling 24-hour quota reset") &&
      result.text.includes("deploy live safety contract") &&
      result.text.includes("Protected deploy sequence:") &&
      result.text.includes("remove unwanted truely-collectables-tt3b.vercel.app alias") &&
      result.text.includes("set clean production alias") &&
      result.text.includes("print DEPLOYED_PRODUCTION") &&
      result.text.includes("print CLEAN_PRODUCTION") &&
      result.text.includes("print smoke handoff command") &&
      result.text.includes("deployed URL output") &&
      result.text.includes("clean URL output") &&
      result.text.includes(
        "production smoke POSTs `/api/admin/shipping/simulations`",
      ) &&
      result.text.includes("no missing or unexpected scenario keys") &&
      result.text.includes("truely-collectables-tt3b.vercel.app"),
  },
  {
    name: "live payment gate",
    path: "/admin/live-payment-launch",
    expect: (result) =>
      result.text.includes("Live Payment Launch Gate") &&
      result.text.includes("Stripe Mode") &&
      result.text.includes("Approval version") &&
      result.text.includes("Approve Live Payments") &&
      result.text.includes("Payment Lab"),
  },
  {
    name: "live shipping gate",
    path: "/admin/live-shipping-launch",
    expect: (result) =>
      result.text.includes("Live Shipping Launch Gate") &&
      result.text.includes("Provider secrets and live-adapter evidence") &&
      result.text.includes("Provider verdict") &&
      result.text.includes("Immutable Shipping Approval History") &&
      result.text.includes("Shipping Lab"),
  },
  {
    name: "admin shipping lettertrack controls",
    path: "/admin/shipping",
    expect: (result) =>
      result.text.includes("Export LetterTrack CSV") &&
      result.text.includes("LetterTrack IMb Recording") &&
      result.text.includes("LetterTrack Delivery Evidence") &&
      result.text.includes("Seller Protection Payout Blocked"),
  },
  {
    name: "shipping simulation lab",
    path: "/admin/shipping/simulations",
    expect: (result) =>
      result.text.includes("Shipping Simulation Lab") &&
      result.text.includes("Scenario Coverage") &&
      result.text.includes("Scenario Keys") &&
      result.text.includes("Scenario coverage guardrail") &&
      result.text.includes("Missing Scenario Keys") &&
      result.text.includes("Unexpected Scenario Keys") &&
      result.text.includes("14") &&
      result.text.includes(
        "LetterTrack CSV rows carry the under-$20 seller-protection contract",
      ) &&
      result.text.includes(
        "Under-$20 seller-protection claim status changes save a LetterTrack evidence review audit record before payout.",
      ) &&
      result.text.includes("DRY RUN STANDARD ENVELOPE PURCHASE"),
  },
  {
    name: "shipping simulation api",
    path: "/api/admin/shipping/simulations",
    options: { method: "POST" },
    expect: (result) =>
      result.contentType.includes("application/json") &&
      result.text.includes('"success":true') &&
      result.text.includes('"scenario_count":14') &&
      result.text.includes('"expected_scenario_count":14') &&
      result.text.includes('"scenario_coverage_status":"passed"') &&
      result.text.includes('"scenario_key_coverage_status":"passed"') &&
      result.text.includes('"missing_scenario_keys":[]') &&
      result.text.includes('"unexpected_scenario_keys":[]') &&
      result.text.includes('"lettertrack_csv_seller_protection_contract"') &&
      result.text.includes('"lettertrack_seller_protection_evidence_review_audit"') &&
      result.text.includes('"dry_run_standard_envelope_purchase"'),
  },
  {
    name: "shipping exceptions export",
    path: "/api/admin/shipping/exceptions",
    expect: (result) =>
      result.contentType.includes("text/csv") &&
      result.text.includes("priority_rank,exception_key,severity") &&
      result.text.includes("exception_type") &&
      result.text.includes("action_needed") &&
      result.text.includes("claim_id") &&
      result.text.includes("dry_run_warning") &&
      !result.text.includes("sk_live_") &&
      !result.text.includes("whsec_"),
  },
  {
    name: "shipping provider setup json",
    path: "/api/admin/shipping/provider-setup",
    expect: (result) =>
      result.contentType.includes("application/json") &&
      result.text.includes('"credentialGroups"') &&
      result.text.includes('"exports"') &&
      result.text.includes('"csv"') &&
      result.text.includes('"envTemplate"') &&
      result.text.includes('"vercelCommands"') &&
      result.text.includes('"operatorChecklist"') &&
      !result.text.includes("sk_live_") &&
      !result.text.includes("whsec_"),
  },
  {
    name: "shipping provider setup csv",
    path: "/api/admin/shipping/provider-setup?format=csv",
    expect: (result) =>
      result.contentType.includes("text/csv") &&
      result.text.includes("decisionStatus,decisionSummary,decisionNextAction") &&
      result.text.includes("liveRequirementBlockers") &&
      result.text.includes("missingCredentialKeys") &&
      !result.text.includes("sk_live_") &&
      !result.text.includes("whsec_"),
  },
  {
    name: "shipping provider env template",
    path: "/api/admin/shipping/provider-setup?format=env-template",
    expect: (result) =>
      result.contentType.includes("text/plain") &&
      result.text.includes("TCOS shipping provider setup template") &&
      result.text.includes("TCOS_SHIPPING_PURCHASE_MODE=dry_run") &&
      result.text.includes("TCOS_LIVE_SHIPPING_ENABLED=false") &&
      !result.text.includes("sk_live_") &&
      !result.text.includes("whsec_"),
  },
  {
    name: "shipping provider vercel commands",
    path: "/api/admin/shipping/provider-setup?format=vercel-commands",
    expect: (result) =>
      result.contentType.includes("text/plain") &&
      result.text.includes("vercel env add") &&
      result.text.includes("# Production environment") &&
      result.text.includes("TCOS_LIVE_SHIPPING_ENABLED") &&
      !result.text.includes("sk_live_") &&
      !result.text.includes("whsec_"),
  },
  {
    name: "shipping provider operator checklist",
    path: "/api/admin/shipping/provider-setup?format=operator-checklist",
    expect: (result) =>
      result.contentType.includes("text/markdown") &&
      result.text.includes("# TCOS Shipping Provider Operator Checklist") &&
      result.text.includes("Keep TCOS_SHIPPING_PURCHASE_MODE=dry_run") &&
      result.text.includes("Keep TCOS_LIVE_SHIPPING_ENABLED=false") &&
      !result.text.includes("sk_live_") &&
      !result.text.includes("whsec_"),
  },
  {
    name: "lettertrack standard envelope export",
    path: "/api/admin/shipping/lettertrack-export",
    expect: (result) =>
      result.contentType.includes("text/csv") &&
      result.text.includes("orderNumber,labelId,recipientName") &&
      result.text.includes("sellerProtectionReserveRate") &&
      result.text.includes("sellerProtectionReimbursesShipping") &&
      result.text.includes("deliveryEvidenceRequirement") &&
      result.response?.headers.get("x-tcos-lettertrack-rows") !== null &&
      result.response?.headers.get("x-tcos-lettertrack-skipped") !== null &&
      !result.text.includes("sk_live_") &&
      !result.text.includes("whsec_"),
  },
];

const queuedFeatureCheckNames = [
  "admin dashboard",
  "launch handoff bundle",
  "launch readiness page",
  "launch readiness json",
  "launch readiness markdown",
  "launch gate drill page",
  "launch gate drill json",
  "launch gate drill markdown",
  "production smoke report page",
  "live payment gate",
  "live shipping gate",
  "admin shipping lettertrack controls",
  "shipping simulation lab",
  "shipping simulation api",
  "shipping provider setup json",
  "shipping provider setup csv",
  "shipping provider env template",
  "shipping provider vercel commands",
  "shipping provider operator checklist",
  "shipping exceptions export",
  "lettertrack standard envelope export",
];

const checkNames = new Set(checks.map((check) => check.name));
const unknownQueuedFeatureCheckNames = queuedFeatureCheckNames.filter(
  (name) => !checkNames.has(name),
);
const duplicateQueuedFeatureCheckNames = queuedFeatureCheckNames.filter(
  (name, index) => queuedFeatureCheckNames.indexOf(name) !== index,
);
const queuedFeatureCheckNameSet = new Set(queuedFeatureCheckNames);

if (unknownQueuedFeatureCheckNames.length > 0) {
  throw new Error(
    `Queued feature smoke manifest references unknown check(s): ${unknownQueuedFeatureCheckNames.join(
      ", ",
    )}`,
  );
}

if (duplicateQueuedFeatureCheckNames.length > 0) {
  throw new Error(
    `Queued feature smoke manifest contains duplicate check(s): ${[
      ...new Set(duplicateQueuedFeatureCheckNames),
    ].join(", ")}`,
  );
}

const results = [
  {
    name: "admin login",
    path: "/api/admin/login",
    status: login.status,
    durationMs: login.durationMs,
    contentType: login.contentType,
    snippet: safeSnippet(login.text, login.error),
    passed: login.ok && Boolean(cookie),
  },
];

for (const check of checks) {
  const result = await request(check.path, {
    ...check.options,
    headers: { ...authHeaders, ...(check.options?.headers || {}) },
  });
  results.push({
    name: check.name,
    path: check.path,
    status: result.status,
    durationMs: result.durationMs,
    contentType: result.contentType,
    snippet: safeSnippet(result.text, result.error),
    passed: result.ok && check.expect(result),
  });
}

const unwantedAlias = await requestUrl(unwantedAliasUrl);
results.push({
  name: `unwanted ${unwantedAlias.url.hostname} alias absent`,
  path: unwantedAlias.path,
  status: unwantedAlias.status,
  durationMs: unwantedAlias.durationMs,
  contentType: unwantedAlias.contentType,
  snippet:
    safeSnippet(unwantedAlias.text, unwantedAlias.error) ||
    "alias did not return content",
  passed: !unwantedAlias.ok,
});

const failed = results.filter((result) => !result.passed);
const queuedFeatureFailures = failed.filter((result) =>
  queuedFeatureCheckNameSet.has(result.name),
);
const totalDurationMs = results.reduce(
  (sum, result) => sum + (result.durationMs || 0),
  0,
);
const slowestResults = [...results]
  .sort((a, b) => (b.durationMs || 0) - (a.durationMs || 0))
  .slice(0, 3)
  .map((result) => ({
    name: result.name,
    path: result.path,
    durationMs: result.durationMs || 0,
  }));

console.table(results);
console.log(`Production smoke total request time: ${totalDurationMs}ms`);
console.log("Slowest production smoke checks:");
console.table(slowestResults);

if (failed.length > 0) {
  console.error("Failed production smoke details:");
  console.table(
    failed.map((result) => ({
      name: result.name,
      path: result.path,
      status: result.status,
      durationMs: result.durationMs,
      contentType: result.contentType || "none",
      snippet: result.snippet || "empty response",
    })),
  );

  if (queuedFeatureFailures.length > 0) {
    console.error(
      "Queued launch features are not visible on production yet. If Vercel quota recently blocked deployment, rerun npm run launch:production once quota resets. If deployment already succeeded, rerun npm run smoke:production.",
    );
    console.error(
      `Queued launch feature failure(s): ${queuedFeatureFailures
        .map((result) => result.name)
        .join(", ")}`,
    );
  }

  console.error(
    `Production smoke failed for ${failed.length} check(s): ${failed
      .map((result) => result.name)
      .join(", ")}`,
  );
  console.error(`Production smoke total request time: ${totalDurationMs}ms`);
  process.exit(1);
}

console.log(`Production smoke passed for ${baseUrl} in ${totalDurationMs}ms.`);
