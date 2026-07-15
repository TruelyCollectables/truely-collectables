import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { isIP } from "node:net";

const baseUrl = normalizeSmokeOrigin(
  process.env.SMOKE_BASE_URL || "https://truely-collectables.vercel.app",
  "SMOKE_BASE_URL",
);
const unwantedAliasUrl = normalizeSmokeOrigin(
  process.env.SMOKE_UNWANTED_ALIAS_URL ||
    "https://truely-collectables-tt3b.vercel.app",
  "SMOKE_UNWANTED_ALIAS_URL",
);
const requestTimeoutMs = readRequestTimeoutMs(
  process.env.SMOKE_REQUEST_TIMEOUT_MS,
);
const redactionSelfTest = process.argv.includes("--self-test-redaction");
const targetOriginSelfTest = process.argv.includes("--self-test-target-origins");
const timeoutConfigSelfTest = process.argv.includes("--self-test-timeout-config");
const sellerMarketplaceReceiptHandoffSmoke = {
  title: "Seller Marketplace Receipt Handoff",
  route: "/seller/marketplaces",
  proofText: "Seller marketplace receipt handoff proof text",
  controls: [
    "Copy Safe Receipt",
    "Download Safe Receipt",
    "Copy Trail",
    "Download Trail",
    "Clear Trail",
  ],
  safeUseBoundary:
    "Treat the receipt trail as a safe operator handoff aid, not an audit ledger, payment record, fulfillment proof, or provider reconciliation source of truth.",
  safeUseBoundaryProof:
    "not an audit ledger, payment record, fulfillment proof, or provider reconciliation source of truth",
};
const sellerMarketplaceReceiptHandoffControlsText =
  sellerMarketplaceReceiptHandoffSmoke.controls.join(", ");
const sellerMarketplaceReceiptHandoffCoverageLine =
  `Seller marketplace receipt handoff controls for ${sellerMarketplaceReceiptHandoffControlsText}`;
const sellerMarketplaceReceiptHandoffBundleText = [
  `## ${sellerMarketplaceReceiptHandoffSmoke.title}`,
  sellerMarketplaceReceiptHandoffSmoke.proofText,
  ...sellerMarketplaceReceiptHandoffSmoke.controls,
  sellerMarketplaceReceiptHandoffSmoke.safeUseBoundaryProof,
];

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

  const hasScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed);
  if (!hasScheme && /[\s\/:?#@]/.test(trimmed)) {
    throw new Error(
      `${label} must be a bare DNS hostname or root HTTP(S) URL.`,
    );
  }

  const urlText = hasScheme ? trimmed : `https://${trimmed}`;
  let url;

  try {
    url = new URL(urlText);
  } catch {
    throw new Error(
      `${label} must be a valid DNS hostname or root HTTP(S) URL.`,
    );
  }

  const authority = urlText
    .slice(urlText.indexOf("://") + 3)
    .split(/[/?#]/, 1)[0];
  const authorityHost = authority.slice(authority.lastIndexOf("@") + 1);
  const hasExplicitPort = authorityHost.includes(":");

  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username ||
    url.password ||
    url.port ||
    hasExplicitPort ||
    (url.pathname && url.pathname !== "/") ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      `${label} must be a root HTTP(S) URL without credentials, port, path, query, or fragment.`,
    );
  }

  const hostname = url.hostname.toLowerCase();
  const labels = hostname.split(".");
  const validDnsLabels = labels.every(
    (part) =>
      part.length >= 1 &&
      part.length <= 63 &&
      /^[a-z\d](?:[a-z\d-]*[a-z\d])?$/.test(part),
  );

  if (
    hostname.length > 253 ||
    labels.length < 2 ||
    hostname.endsWith(".") ||
    isIP(hostname) !== 0 ||
    !validDnsLabels
  ) {
    throw new Error(
      `${label} must resolve to a valid DNS hostname with at least two labels.`,
    );
  }

  return `${url.protocol}//${hostname}`;
}

function readRequestTimeoutMs(value) {
  const defaultTimeoutMs = 15_000;
  const minTimeoutMs = 1_000;
  const maxTimeoutMs = 120_000;
  const raw = value === undefined ? "" : String(value).trim();

  if (!raw) return defaultTimeoutMs;

  if (!/^\d+$/.test(raw)) {
    throw new Error(
      "SMOKE_REQUEST_TIMEOUT_MS must be an integer between 1000 and 120000.",
    );
  }

  const parsed = Number(raw);

  if (
    !Number.isSafeInteger(parsed) ||
    parsed < minTimeoutMs ||
    parsed > maxTimeoutMs
  ) {
    throw new Error(
      "SMOKE_REQUEST_TIMEOUT_MS must be an integer between 1000 and 120000.",
    );
  }

  return parsed;
}

function runTargetOriginSelfTest() {
  const validCases = [
    ["TRUELY-COLLECTABLES.VERCEL.APP", "https://truely-collectables.vercel.app"],
    ["https://Truely-Collectables.Vercel.App/", "https://truely-collectables.vercel.app"],
    ["http://launch.example.com/", "http://launch.example.com"],
  ];

  for (const [input, expected] of validCases) {
    const actual = normalizeSmokeOrigin(input, "SELF_TEST_SMOKE_TARGET");
    if (actual !== expected) {
      throw new Error(
        `Smoke target-origin self-test normalized ${input} to ${actual}; expected ${expected}.`,
      );
    }
  }

  const invalidCases = [
    "",
    "https://",
    "ftp://launch.example.com",
    "https://operator:smoke-secret@launch.example.com/",
    "https://launch.example.com:444/",
    "https://launch.example.com:443/",
    "http://launch.example.com:80/",
    "https://launch.example.com/path",
    "https://launch.example.com/?target=other.example.com",
    "https://launch.example.com/#fragment",
    "launch.example.com/path",
    "launch_example.com",
    "-launch.example.com",
    "launch..example.com",
    "launch.example.com.",
    "127.0.0.1",
    "localhost",
  ];

  for (const input of invalidCases) {
    try {
      normalizeSmokeOrigin(input, "SELF_TEST_SMOKE_TARGET");
      throw new Error(
        `Smoke target-origin self-test accepted invalid input: ${input}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes("accepted invalid input") ||
        !message.includes("SELF_TEST_SMOKE_TARGET") ||
        message.includes("smoke-secret")
      ) {
        throw error;
      }
    }
  }

  console.log("Production smoke target-origin self-test passed.");
}

function runTimeoutConfigSelfTest() {
  const validCases = [
    [undefined, 15_000],
    ["", 15_000],
    ["15000", 15_000],
    [" 30000 ", 30_000],
    ["1000", 1_000],
    ["120000", 120_000],
  ];

  for (const [input, expected] of validCases) {
    const actual = readRequestTimeoutMs(input);
    if (actual !== expected) {
      throw new Error(
        `Smoke timeout self-test parsed ${String(input)} as ${actual}; expected ${expected}.`,
      );
    }
  }

  const invalidCases = [
    "0",
    "999",
    "120001",
    "-1",
    "15000.5",
    "Infinity",
    "NaN",
    "15 seconds",
    "9007199254740992",
  ];

  for (const input of invalidCases) {
    try {
      readRequestTimeoutMs(input);
      throw new Error(
        `Smoke timeout self-test accepted invalid input: ${input}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes("accepted invalid input") ||
        !message.includes("SMOKE_REQUEST_TIMEOUT_MS must be an integer between 1000 and 120000")
      ) {
        throw error;
      }
    }
  }

  console.log("Production smoke timeout config self-test passed.");
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

if (targetOriginSelfTest) {
  runTargetOriginSelfTest();
  process.exit(0);
}

if (timeoutConfigSelfTest) {
  runTimeoutConfigSelfTest();
  process.exit(0);
}

function hostFor(url) {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return "";
  }
}

function hasShippingProviderSetupHeaders(result) {
  return (
    result.response?.headers.get("x-tcos-shipping-provider-decision") !==
      null &&
    result.response?.headers.get("x-tcos-shipping-provider-missing-groups") !==
      null &&
    result.response?.headers.get("x-tcos-shipping-provider-live-blockers") !==
      null &&
    result.response?.headers.get("x-tcos-shipping-provider-contract-ready") ===
      "ready" &&
    result.response?.headers.get("x-tcos-shipping-provider-summary") !== null
  );
}

function hasAttachmentFilename(result, filenameText) {
  const contentDisposition =
    result.response?.headers.get("content-disposition") || "";

  return (
    contentDisposition.toLowerCase().includes("attachment") &&
    contentDisposition.includes(filenameText)
  );
}

function includesAll(text, entries) {
  return entries.every((entry) => text.includes(entry));
}

function hasJsonField(text, key, value) {
  return text.includes(`"${key}":${JSON.stringify(value)}`);
}

function hasSellerMarketplaceReceiptHandoffSmokeText(text) {
  return includesAll(text, [
    sellerMarketplaceReceiptHandoffSmoke.title,
    sellerMarketplaceReceiptHandoffSmoke.proofText,
    ...sellerMarketplaceReceiptHandoffSmoke.controls,
    "not an audit ledger",
    sellerMarketplaceReceiptHandoffSmoke.route,
  ]);
}

function hasSellerMarketplaceReceiptHandoffJson(text) {
  return (
    hasJsonField(text, "title", sellerMarketplaceReceiptHandoffSmoke.title) &&
    hasJsonField(text, "route", sellerMarketplaceReceiptHandoffSmoke.route) &&
    hasJsonField(
      text,
      "proofText",
      sellerMarketplaceReceiptHandoffSmoke.proofText,
    ) &&
    hasJsonField(text, "controls", sellerMarketplaceReceiptHandoffSmoke.controls) &&
    hasJsonField(
      text,
      "safeUseBoundary",
      sellerMarketplaceReceiptHandoffSmoke.safeUseBoundary,
    )
  );
}

function hasSellerMarketplaceReceiptHandoffMarkdown(text) {
  return includesAll(text, [
    `## ${sellerMarketplaceReceiptHandoffSmoke.title}`,
    `Proof text: ${sellerMarketplaceReceiptHandoffSmoke.proofText}`,
    `Controls: ${sellerMarketplaceReceiptHandoffControlsText}`,
    `Safe-use boundary: ${sellerMarketplaceReceiptHandoffSmoke.safeUseBoundary}`,
  ]);
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
const remoteFullHead = optionalRun("git", ["rev-parse", "origin/main"]);

console.log(`Production smoke target: ${baseUrl}`);
if (!redactionSelfTest) {
  console.log(
    `origin/main refresh: ${originRefresh.ok ? "ok" : "failed; continuing with local ref"}`,
  );
}
console.log(`Local HEAD: ${localHead || "unknown"}`);
console.log(`origin/main: ${remoteHead || "unknown"}`);
console.log(`origin/main full SHA: ${remoteFullHead || "unknown"}`);
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
  return visibleText(text)
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
    .slice(0, 240);
}

function visibleText(text) {
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

function missingRequiredText(result, check) {
  return (check.requiredText || []).filter((text) => !result.text.includes(text));
}

function smokeFailureDetail(result) {
  const details = [
    `path=${result.path}`,
    `status=${result.status}`,
    `missingText=${result.missingText || "none"}`,
    `diagnostic=${result.diagnostic || "none"}`,
    `snippet=${result.snippet || "empty response"}`,
  ];

  return `${result.name} (${details.join("; ")})`;
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function launchReadinessDeploymentMatchesOriginMain(result) {
  const payload = parseJson(result.text);
  const deployment = payload?.brief?.deployment;

  if (!remoteFullHead || !deployment) {
    return false;
  }

  return (
    deployment.gitCommitSha === remoteFullHead &&
    deployment.gitCommitShortSha === remoteHead &&
    deployment.gitCommitRef === "main" &&
    deployment.cleanProductionDomain === baseUrl &&
    deployment.smokeComparison ===
      "Compare this Git commit SHA with origin/main before treating production smoke as current."
  );
}

function launchReadinessDeploymentDiagnostic(result) {
  const payload = parseJson(result.text);
  const deployment = payload?.brief?.deployment;

  if (!remoteFullHead) {
    return "origin/main full SHA is unavailable; run git fetch origin main and retry smoke";
  }

  if (!deployment) {
    return "launch-readiness JSON did not include brief.deployment source metadata";
  }

  const mismatches = [
    deployment.gitCommitSha === remoteFullHead
      ? ""
      : `gitCommitSha production=${deployment.gitCommitSha || "missing"} origin/main=${remoteFullHead}`,
    deployment.gitCommitShortSha === remoteHead
      ? ""
      : `gitCommitShortSha production=${deployment.gitCommitShortSha || "missing"} origin/main=${remoteHead || "unknown"}`,
    deployment.gitCommitRef === "main"
      ? ""
      : `gitCommitRef production=${deployment.gitCommitRef || "missing"} expected=main`,
    deployment.cleanProductionDomain === baseUrl
      ? ""
      : `cleanProductionDomain production=${deployment.cleanProductionDomain || "missing"} expected=${baseUrl}`,
  ].filter(Boolean);

  return mismatches.length > 0
    ? `Deployment source mismatch: ${mismatches.join("; ")}`
    : "Deployment source matches origin/main.";
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
    expect: (result) =>
      result.text.includes("Shipping Setup") &&
      result.text.includes("Shipping Provider Unlock Action Plan") &&
      hasSellerMarketplaceReceiptHandoffSmokeText(result.text) &&
      result.text.includes("Live money runway") &&
      result.text.includes("approval blockers") &&
      result.text.includes("launch locks") &&
      result.text.includes("Next live-money action") &&
      result.text.includes("Live Money JSON Evidence") &&
      result.text.includes("npm --silent run status:live-money:json") &&
      result.text.includes("npm --silent run preflight:live-money:json") &&
      result.text.includes("TCOS_LIVE_PAYMENTS_ENABLED") &&
      result.text.includes("READY_FOR_RUNTIME_SWITCH, LIVE_MONEY_OPEN") &&
      result.text.includes("BLOCKED_UNEVALUATED, BLOCKED_APPROVAL, READY_FOR_DATABASE_APPROVAL, BLOCKED_LAUNCH_GATE") &&
      result.text.includes("tcos.liveMoneyGoNoGo.v1") &&
      result.text.includes("must not create Checkout Sessions") &&
      result.text.includes("Choose provider accounts") &&
      result.text.includes("Stage Vercel environment names") &&
      result.text.includes("Keep shipping runtime locked") &&
      result.text.includes("Standard Envelope evidence validator") &&
      result.text.includes("Purchase-audit key drift") &&
      result.text.includes("unexpected"),
  },
  {
    name: "launch readiness page",
    path: "/admin/launch-readiness",
    expect: (result) =>
      result.text.includes("Launch Readiness") &&
      result.text.includes("Live money runway") &&
      result.text.includes("What remains before full live money") &&
      result.text.includes("Payment approval blockers before database approval") &&
      result.text.includes("Intentional live-money launch locks") &&
      result.text.includes("Live Money JSON Evidence") &&
      result.text.includes("Post-smoke archive command") &&
      result.text.includes("npm --silent run status:live-money:json") &&
      result.text.includes("Final-window preflight command") &&
      result.text.includes("npm --silent run preflight:live-money:json") &&
      result.text.includes("Accepted go-live states") &&
      result.text.includes("READY_FOR_RUNTIME_SWITCH, LIVE_MONEY_OPEN") &&
      result.text.includes("Halt states") &&
      result.text.includes("BLOCKED_UNEVALUATED, BLOCKED_APPROVAL, READY_FOR_DATABASE_APPROVAL, BLOCKED_LAUNCH_GATE") &&
      result.text.includes("must not create Checkout Sessions") &&
      result.text.includes("Open Live Payment Gate") &&
      result.text.includes("Production Deploy Queue") &&
      result.text.includes("Shipping Provider Unlock Action Plan") &&
      result.text.includes("Choose provider accounts") &&
      result.text.includes("Stage Vercel environment names") &&
      result.text.includes("Keep shipping runtime locked") &&
      result.text.includes("Export operator checklist") &&
      result.text.includes("npm run verify:production") &&
      result.text.includes("git fetch origin main") &&
      result.text.includes("git rev-parse --short HEAD") &&
      result.text.includes("git rev-parse --short origin/main") &&
      result.text.includes("git log -5 --oneline") &&
      result.text.includes("npm run check:production-guardrails") &&
      result.text.includes("npm run preflight:production") &&
      result.text.includes("npm run status:production") &&
      result.text.includes("npm run launch:production") &&
      result.text.includes("twenty-scenario shipping simulation suite") &&
      result.text.includes("LetterTrack evidence checks") &&
      result.text.includes("shipping purchase-attempt audit simulations") &&
      result.text.includes("Standard Envelope evidence validator is ready") &&
      result.text.includes("/api/admin/shipping/simulations") &&
      result.text.includes("twenty expected shipping scenarios") &&
      result.text.includes("five expected purchase-audit scenarios") &&
      result.text.includes("no missing/unexpected simulation keys") &&
      result.text.includes("npm run deploy:production") &&
      result.text.includes("npm run smoke:production") &&
      result.text.includes("rolling 24-hour quota reset") &&
      result.text.includes("Vercel can still upload files before returning the quota error") &&
      result.text.includes(".codex-run/vercel-quota-block.json") &&
      result.text.includes("TCOS_VERCEL_QUOTA_RETRY_OVERRIDE=true") &&
      result.text.includes("--force-quota-retry") &&
      result.text.includes("deploy live safety contract") &&
      result.text.includes("Protected deploy sequence") &&
      result.text.includes("remove unwanted truely-collectables-tt3b.vercel.app alias") &&
      result.text.includes("set clean production alias") &&
      result.text.includes("clear local quota marker after clean alias succeeds") &&
      result.text.includes("Clear the local quota marker only after Vercel returns a parsed deployment URL and the clean production alias succeeds") &&
      result.text.includes("Require vercel --prod to exit successfully before parsing its deployment URL, running alias commands, or clearing the quota marker") &&
      result.text.includes("Use command-pinned Vercel CLI 56.2.0 through isolated npm exec") &&
      result.text.includes("Accept VERCEL_SCOPE only as a simple lowercase Vercel team slug") &&
      result.text.includes("Require unwanted-alias removal to succeed or return Vercel CLI's explicit alias-not-found result") &&
      result.text.includes("Accept production target overrides only as valid DNS hostnames or root HTTP(S) URLs") &&
      result.text.includes("Accept production smoke targets only as valid DNS hostnames or root HTTP(S) URLs") &&
      result.text.includes("On normal deploys, enforce the local quota cooldown before npm exec, Git fetch, build, upload, or deployment") &&
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
      result.text.includes('"deployment"') &&
      result.text.includes('"approvalBlockingCount"') &&
      result.text.includes('"launchLockCount"') &&
      result.text.includes('"operatorSummary"') &&
      result.text.includes('"nextActions"') &&
      result.text.includes('"liveMoneyEvidence"') &&
      result.text.includes('"schema":"tcos.liveMoneyGoNoGo.v1"') &&
      result.text.includes('"statusCommand":"npm --silent run status:live-money:json"') &&
      result.text.includes('"preflightCommand":"npm --silent run preflight:live-money:json"') &&
      result.text.includes('"READY_FOR_RUNTIME_SWITCH"') &&
      result.text.includes('"LIVE_MONEY_OPEN"') &&
      result.text.includes("BLOCKED_LAUNCH_GATE") &&
      result.text.includes("Archive the status JSON after production smoke passes") &&
      result.text.includes("must not create Checkout Sessions") &&
      result.text.includes('"gitCommitSha"') &&
      result.text.includes('"gitCommitRef"') &&
      result.text.includes('"vercelUrl"') &&
      result.text.includes('"cleanProductionDomain"') &&
      result.text.includes("Compare this Git commit SHA with origin/main") &&
      result.text.includes('"sellerProtection"') &&
      result.text.includes('"sellerMarketplaceReceiptHandoff"') &&
      hasSellerMarketplaceReceiptHandoffJson(result.text) &&
      result.text.includes('"standardEnvelopeEvidenceContractReady":true') &&
      result.text.includes('"reimbursementEntryType":"seller_protection_reimbursement"') &&
      result.text.includes('"financialAdjustmentTable":"financial_adjustment_ledger_entries"') &&
      result.text.includes("Optional TCOS internal Standard Envelope seller protection") &&
      result.text.includes('"purchaseAttemptAuditRunStatus":"passed"') &&
      result.text.includes('"purchaseAttemptAuditExpectedScenarioCount":5') &&
      result.text.includes('"purchaseAttemptAuditKeyCoverageStatus":"passed"') &&
      result.text.includes('"purchaseAttemptAuditMissingScenarioKeys":[]') &&
      result.text.includes('"purchaseAttemptAuditUnexpectedScenarioKeys":[]') &&
      result.text.includes('"quotaBlockCode":"api-deployments-free-per-day"') &&
      result.text.includes('"quotaCooldownMarkerPath":".codex-run/vercel-quota-block.json"') &&
      result.text.includes('"quotaStatusCommand":"npm run status:production"') &&
      result.text.includes('"quotaStatusDescription"') &&
      result.text.includes('"quotaRetryOverrideEnv":"TCOS_VERCEL_QUOTA_RETRY_OVERRIDE=true"') &&
      result.text.includes('"quotaRetryOverrideFlag":"--force-quota-retry"') &&
      result.text.includes('"quotaUploadWarning"') &&
      result.text.includes('"quotaMarkerClearCondition"') &&
      result.text.includes('"deployResultRequirement"') &&
      result.text.includes('"vercelCliRequirement"') &&
      result.text.includes('"scopeRequirement"') &&
      result.text.includes('"unwantedAliasCleanupRequirement"') &&
      result.text.includes('"targetHostRequirement"') &&
      result.text.includes('"smokeTargetRequirement"') &&
      result.text.includes('"quotaEarlyStopRequirement"') &&
      result.text.includes("rolling 24-hour quota reset") &&
      result.text.includes("Vercel can still upload files before returning the quota error") &&
      result.text.includes("deployed URL output") &&
      result.text.includes("clean URL output") &&
      result.text.includes('"sequence"') &&
      result.text.includes("remove unwanted truely-collectables-tt3b.vercel.app alias") &&
      result.text.includes("set clean production alias") &&
      result.text.includes("clear local quota marker after clean alias succeeds") &&
      result.text.includes("Clear the local quota marker only after Vercel returns a parsed deployment URL and the clean production alias succeeds") &&
      result.text.includes("Require vercel --prod to exit successfully before parsing its deployment URL, running alias commands, or clearing the quota marker") &&
      result.text.includes("Use command-pinned Vercel CLI 56.2.0 through isolated npm exec") &&
      result.text.includes("Accept VERCEL_SCOPE only as a simple lowercase Vercel team slug") &&
      result.text.includes("Require unwanted-alias removal to succeed or return Vercel CLI's explicit alias-not-found result") &&
      result.text.includes("Accept production target overrides only as valid DNS hostnames or root HTTP(S) URLs") &&
      result.text.includes("Accept production smoke targets only as valid DNS hostnames or root HTTP(S) URLs") &&
      result.text.includes("On normal deploys, enforce the local quota cooldown before npm exec, Git fetch, build, upload, or deployment") &&
      result.text.includes("print DEPLOYED_PRODUCTION") &&
      result.text.includes("print CLEAN_PRODUCTION") &&
      result.text.includes("print smoke handoff command") &&
      result.text.includes("npm run smoke:production handoff") &&
      launchReadinessDeploymentMatchesOriginMain(result),
    requiredText: remoteFullHead ? [remoteFullHead] : [],
    diagnostic: launchReadinessDeploymentDiagnostic,
  },
  {
    name: "launch readiness markdown",
    path: "/api/admin/launch-readiness?format=markdown",
    expect: (result) =>
      hasAttachmentFilename(result, "tcos-launch-readiness-brief.md") &&
      result.text.includes("# TCOS Launch Readiness Brief") &&
      result.text.includes("## Under-$20 Seller Protection") &&
      result.text.includes("TCOS Under-$20 Seller Protection") &&
      result.text.includes("seller_protection_reimbursement") &&
      result.text.includes("financial_adjustment_ledger_entries") &&
      result.text.includes("shipping is excluded and is not reimbursed") &&
      hasSellerMarketplaceReceiptHandoffMarkdown(result.text) &&
      result.text.includes("Standard Envelope evidence validator: ready") &&
      result.text.includes("Provider purchase-attempt audit suite: passed; 5/5 scenarios; key coverage passed") &&
      result.text.includes("Approval blockers:") &&
      result.text.includes("Launch locks:") &&
      result.text.includes("Operator summary:") &&
      result.text.includes("Next live-money actions:") &&
      result.text.includes("## Live Money JSON Evidence") &&
      result.text.includes("Schema: `tcos.liveMoneyGoNoGo.v1`") &&
      result.text.includes("Post-smoke archive command: `npm --silent run status:live-money:json`") &&
      result.text.includes("Final-window preflight command: `npm --silent run preflight:live-money:json`") &&
      result.text.includes("Accepted go-live states: READY_FOR_RUNTIME_SWITCH, LIVE_MONEY_OPEN") &&
      result.text.includes("Halt states: BLOCKED_UNEVALUATED, BLOCKED_APPROVAL, READY_FOR_DATABASE_APPROVAL, BLOCKED_LAUNCH_GATE") &&
      result.text.includes("Archive the status JSON after production smoke passes") &&
      result.text.includes("must not create Checkout Sessions") &&
      result.text.includes("Missing purchase audit keys: none") &&
      result.text.includes("Unexpected purchase audit keys: none") &&
      result.text.includes("## Deployment Source") &&
      result.text.includes("Git commit SHA:") &&
      result.text.includes("Smoke comparison:") &&
      result.text.includes("## Production Deploy Safety") &&
      result.text.includes("api-deployments-free-per-day") &&
      result.text.includes("rolling 24-hour quota reset") &&
      result.text.includes("Vercel can still upload files before returning the quota error") &&
      result.text.includes(".codex-run/vercel-quota-block.json") &&
      result.text.includes("npm run status:production") &&
      result.text.includes("Read-only local cooldown check with exact blocked/retry timestamps") &&
      result.text.includes("TCOS_VERCEL_QUOTA_RETRY_OVERRIDE=true") &&
      result.text.includes("--force-quota-retry") &&
      result.text.includes("deploy live safety contract") &&
      result.text.includes("Protected deploy sequence:") &&
      result.text.includes("remove unwanted truely-collectables-tt3b.vercel.app alias") &&
      result.text.includes("set clean production alias") &&
      result.text.includes("clear local quota marker after clean alias succeeds") &&
      result.text.includes("Clear the local quota marker only after Vercel returns a parsed deployment URL and the clean production alias succeeds") &&
      result.text.includes("Require vercel --prod to exit successfully before parsing its deployment URL, running alias commands, or clearing the quota marker") &&
      result.text.includes("Use command-pinned Vercel CLI 56.2.0 through isolated npm exec") &&
      result.text.includes("Accept VERCEL_SCOPE only as a simple lowercase Vercel team slug") &&
      result.text.includes("Require unwanted-alias removal to succeed or return Vercel CLI's explicit alias-not-found result") &&
      result.text.includes("Accept production target overrides only as valid DNS hostnames or root HTTP(S) URLs") &&
      result.text.includes("Accept production smoke targets only as valid DNS hostnames or root HTTP(S) URLs") &&
      result.text.includes("On normal deploys, enforce the local quota cooldown before npm exec, Git fetch, build, upload, or deployment") &&
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
      result.text.includes("Live money runway") &&
      result.text.includes("Payment approval blockers and launch locks") &&
      result.text.includes("Next live-money actions") &&
      result.text.includes("Standard Envelope evidence validator is ready") &&
      result.text.includes("Provider Purchase-Attempt Audit Suite") &&
      result.text.includes("Shipping Provider Unlock Action Plan") &&
      result.text.includes("Choose provider accounts") &&
      result.text.includes("Stage Vercel environment names") &&
      result.text.includes("Keep shipping runtime locked") &&
      result.text.includes("Missing purchase audit keys:") &&
      result.text.includes("Unexpected purchase audit keys:") &&
      result.text.includes("Side-effect Guardrails") &&
      result.text.includes("Not allowed during this drill"),
  },
  {
    name: "launch gate drill json",
    path: "/api/admin/launch-gate-drill",
    expect: (result) =>
      result.contentType.includes("application/json") &&
      result.text.includes('"standardEnvelopeEvidenceContractReady":true') &&
      result.text.includes('"purchaseAttemptAuditRunStatus":"passed"') &&
      result.text.includes('"approvalBlockingCount"') &&
      result.text.includes('"launchLockCount"') &&
      result.text.includes('"operatorSummary"') &&
      result.text.includes('"nextActions"') &&
      result.text.includes('"purchaseAttemptAuditExpectedScenarioCount":5') &&
      result.text.includes('"purchaseAttemptAuditMissingScenarioKeys":[]') &&
      result.text.includes('"purchaseAttemptAuditUnexpectedScenarioKeys":[]') &&
      result.text.includes('"providerSetupActionPlan"') &&
      result.text.includes('"Choose provider accounts"') &&
      result.text.includes('"Stage Vercel environment names"') &&
      result.text.includes('"Keep shipping runtime locked"') &&
      result.text.includes('"sideEffectPolicy"') &&
      result.text.includes('"forbiddenOperations"'),
  },
  {
    name: "launch gate drill markdown",
    path: "/api/admin/launch-gate-drill?format=markdown",
    expect: (result) =>
      result.contentType.includes("text/markdown") &&
      hasAttachmentFilename(result, "tcos-launch-gate-drill-report.md") &&
      result.text.includes("# TCOS Launch Gate Drill Report") &&
      result.text.includes("## Live Money Runway") &&
      result.text.includes("Approval blockers:") &&
      result.text.includes("Launch locks:") &&
      result.text.includes("### Next Live-Money Actions") &&
      result.text.includes("Standard Envelope evidence validator: ready") &&
      result.text.includes("Provider purchase-attempt audit suite: passed; 5/5 scenarios; key coverage passed") &&
      result.text.includes("Missing purchase audit keys: none") &&
      result.text.includes("Unexpected purchase audit keys: none") &&
      result.text.includes("## Shipping Provider Unlock Action Plan") &&
      result.text.includes("Choose provider accounts") &&
      result.text.includes("Stage Vercel environment names") &&
      result.text.includes("Keep shipping runtime locked") &&
      result.text.includes("## Side-effect Guardrails") &&
      result.text.includes("### Forbidden Operations"),
  },
  {
    name: "production smoke report page",
    path: "/admin/production-smoke",
    requiredText: [
      "Production Smoke Report",
      "Smoke coverage",
      "Admin login and dashboard render with Shipping Provider Unlock Action Plan",
      "Under-$20 Seller Protection launch handoff",
      "Launch Gate Drill page, JSON report, Markdown operator report, live-money runway, Shipping Provider Unlock Action Plan, and Standard Envelope evidence validator",
      "Launch readiness and handoff exports show missing/unexpected purchase-audit key drift",
      "Seller Protection Handoff Bundle",
      "Seller Protection Reconciliation",
      "Shipping Claims Cockpit",
      "Standard Envelope evidence validator",
      "Live Shipping Launch Gate with Shipping Provider Unlock Action Plan and Purchase-Audit Key Drift card",
      "Shipping Simulation Lab with twenty policy/adapter scenarios plus five provider purchase-audit scenarios",
      "Shipping purchase-attempt audit simulations for live-gate, missing-setup, dry-run, and packet-output text",
      "Shipping simulation API POST with scenario count, manifest, and drift-field checks",
      "Shipping provider setup JSON and export packets with Standard Envelope evidence readiness",
      "Seller marketplace packet intake guardrail for cross-list prep only, no postage purchase, no Coverage policy creation, no payout release, no order fulfillment, and no automatic under-$20 protection activation",
      "Seller marketplace page renders Marketplace Packet Intake guidance, ready-row handoff, needs-work handoff, and prep-only export wording",
      sellerMarketplaceReceiptHandoffCoverageLine,
      "Seller inventory, order, and payout workspaces render login gates before exposing seller-owned data",
      "Queued launch feature failure(s)",
      "Unwanted truely-collectables-tt3b.vercel.app alias absence",
      "Deploy live safety contract",
      "Production go/no-go ladder",
      "Verify the pushed stack",
      "Launch only when quota is open",
      "Halt on Vercel quota",
      "Ship only after smoke passes clean production",
      "api-deployments-free-per-day",
      "rolling 24-hour quota reset",
      "Vercel can still upload files before returning the quota error",
      "npm run status:production",
      "Read-only local cooldown check with exact blocked/retry timestamps",
      "Require vercel --prod to exit successfully before parsing its deployment URL, running alias commands, or clearing the quota marker",
      "Use command-pinned Vercel CLI 56.2.0 through isolated npm exec",
      "Accept VERCEL_SCOPE only as a simple lowercase Vercel team slug",
      "Require unwanted-alias removal to succeed or return Vercel CLI's explicit alias-not-found result",
      "Accept production target overrides only as valid DNS hostnames or root HTTP(S) URLs",
      "Accept production smoke targets only as valid DNS hostnames or root HTTP(S) URLs",
      "On normal deploys, enforce the local quota cooldown before npm exec, Git fetch, build, upload, or deployment",
      ".codex-run/vercel-quota-block.json",
      "TCOS_VERCEL_QUOTA_RETRY_OVERRIDE=true",
      "--force-quota-retry",
      "Protected deploy sequence",
      "Post-smoke manual verification checklist",
      "Proof to capture:",
      "If blocked:",
      "Git tip and clean domain",
      "Launch gate drill evidence",
      "Live money runway proof",
      "Live money JSON evidence",
      "npm --silent run status:live-money:json",
      "npm --silent run preflight:live-money:json",
      "tcos.liveMoneyGoNoGo.v1",
      "READY_FOR_RUNTIME_SWITCH",
      "approval-blocker count",
      "launch-lock count",
      "next live-money actions",
      "Live shipping lock posture",
      "Seller protection money trail",
      "Shipping operations exports",
      "Seller marketplace packet intake",
      "Seller marketplace receipt handoff",
      "deployed URL output",
      "clean URL output",
      "npm run launch:production",
      "npm run status:production",
    ],
    expect: (result) =>
      result.text.includes("Production Smoke Report") &&
      result.text.includes("Smoke coverage") &&
      result.text.includes("Under-$20 Seller Protection launch handoff") &&
      result.text.includes(
        "Launch readiness and handoff exports show missing/unexpected purchase-audit key drift",
      ) &&
      result.text.includes("2% reserve") &&
      result.text.includes("shipping exclusion") &&
      result.text.includes("LetterTrack/USPS IMb evidence rule") &&
      result.text.includes("reimbursement ledger path") &&
      result.text.includes("Seller Protection Handoff Bundle") &&
      result.text.includes("Seller Protection Reconciliation") &&
      result.text.includes("Shipping Claims Cockpit") &&
      result.text.includes("Standard Envelope evidence validator") &&
      result.text.includes("Live Shipping Launch Gate with Shipping Provider Unlock Action Plan and Purchase-Audit Key Drift card") &&
      result.text.includes(
        "Shipping Simulation Lab with twenty policy/adapter scenarios plus five provider purchase-audit scenarios",
      ) &&
      result.text.includes(
        "Shipping purchase-attempt audit simulations for live-gate, missing-setup, dry-run, and packet-output text",
      ) &&
      result.text.includes(
        "Shipping simulation API POST with scenario count, manifest, and drift-field checks",
      ) &&
      result.text.includes(
        "Shipping provider setup JSON and export packets with Standard Envelope evidence readiness",
      ) &&
      result.text.includes(
        "Seller marketplace packet intake guardrail for cross-list prep only, no postage purchase, no Coverage policy creation, no payout release, no order fulfillment, and no automatic under-$20 protection activation",
      ) &&
      result.text.includes(
        "Seller marketplace page renders Marketplace Packet Intake guidance, ready-row handoff, needs-work handoff, and prep-only export wording",
      ) &&
      result.text.includes(sellerMarketplaceReceiptHandoffCoverageLine) &&
      result.text.includes(
        "Seller inventory, order, and payout workspaces render login gates before exposing seller-owned data",
      ) &&
      result.text.includes("Queued launch feature failure(s)") &&
      result.text.includes(
        "Unwanted truely-collectables-tt3b.vercel.app alias absence",
      ) &&
      result.text.includes("Deploy live safety contract") &&
      result.text.includes("Production go/no-go ladder") &&
      result.text.includes("Verify the pushed stack") &&
      result.text.includes("Launch only when quota is open") &&
      result.text.includes("Halt on Vercel quota") &&
      result.text.includes("Ship only after smoke passes clean production") &&
      result.text.includes("api-deployments-free-per-day") &&
      result.text.includes("rolling 24-hour quota reset") &&
      result.text.includes("Vercel can still upload files before returning the quota error") &&
      result.text.includes(".codex-run/vercel-quota-block.json") &&
      result.text.includes("TCOS_VERCEL_QUOTA_RETRY_OVERRIDE=true") &&
      result.text.includes("--force-quota-retry") &&
      result.text.includes("Protected deploy sequence") &&
      result.text.includes("Post-smoke manual verification checklist") &&
      result.text.includes("Proof to capture:") &&
      result.text.includes("If blocked:") &&
      result.text.includes("Git tip and clean domain") &&
      result.text.includes("Launch gate drill evidence") &&
      result.text.includes("Live money runway proof") &&
      result.text.includes("Live money JSON evidence") &&
      result.text.includes("npm --silent run status:live-money:json") &&
      result.text.includes("npm --silent run preflight:live-money:json") &&
      result.text.includes("tcos.liveMoneyGoNoGo.v1") &&
      result.text.includes("READY_FOR_RUNTIME_SWITCH") &&
      result.text.includes("approval-blocker count") &&
      result.text.includes("launch-lock count") &&
      result.text.includes("next live-money actions") &&
      result.text.includes("Live shipping lock posture") &&
      result.text.includes("Seller protection money trail") &&
      result.text.includes("Shipping operations exports") &&
      result.text.includes("Seller marketplace packet intake") &&
      result.text.includes("Seller marketplace receipt handoff") &&
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
    name: "seller marketplace packet intake",
    path: "/seller/marketplaces",
    requiredText: [
      "Seller Connections",
      "Marketplace Packet Intake",
      "Seller Inventory exports are prep files, not live publishing.",
      "Cross-list prep only",
      "No external publishing",
      "No postage purchase",
      "No Coverage policy creation",
      "No payout release",
      "No order fulfillment",
      "No automatic under-$20 protection activation",
      "Open Ready Inventory",
      "Open Needs-Work Inventory",
      "Seller marketplace packet intake guidance",
      "Seller marketplace receipt handoff",
      ...sellerMarketplaceReceiptHandoffSmoke.controls,
    ],
    expect: (result) =>
      result.text.includes("Seller Connections") &&
      result.text.includes("Marketplace Packet Intake") &&
      result.text.includes("Seller Inventory exports are prep files, not live publishing.") &&
      result.text.includes("Cross-list prep only") &&
      result.text.includes("No external publishing") &&
      result.text.includes("No postage purchase") &&
      result.text.includes("No Coverage policy creation") &&
      result.text.includes("No payout release") &&
      result.text.includes("No order fulfillment") &&
      result.text.includes("No automatic under-$20 protection activation") &&
      result.text.includes("Open Ready Inventory") &&
      result.text.includes("Open Needs-Work Inventory") &&
      result.text.includes("Seller marketplace packet intake guidance") &&
      result.text.includes("Seller marketplace receipt handoff") &&
      includesAll(result.text, sellerMarketplaceReceiptHandoffSmoke.controls) &&
      result.text.includes("prep-only JSON/CSV handoffs") &&
      !result.text.includes("sk_live_") &&
      !result.text.includes("whsec_"),
  },
  {
    name: "seller inventory auth gate",
    path: "/seller/inventory",
    requiredText: [
      "Seller Inventory",
      "Log in through your TCOS account first",
      "review seller-owned drafts, active inventory, and activation blockers",
      "Log In",
      "Seller Marketplaces",
    ],
    expect: (result) =>
      result.text.includes("Seller Inventory") &&
      result.text.includes("Log in through your TCOS account first") &&
      result.text.includes("review seller-owned drafts, active inventory, and activation blockers") &&
      result.text.includes("Log In") &&
      result.text.includes("Seller Marketplaces"),
  },
  {
    name: "seller orders auth gate",
    path: "/seller/orders",
    requiredText: [
      "Seller Order Activity",
      "Log in through your TCOS account first",
      "review seller-owned orders, payout holds, and cash-out blockers",
      "Log In",
      "Account",
    ],
    expect: (result) =>
      result.text.includes("Seller Order Activity") &&
      result.text.includes("Log in through your TCOS account first") &&
      result.text.includes("review seller-owned orders, payout holds, and cash-out blockers") &&
      result.text.includes("Log In") &&
      result.text.includes("Account"),
  },
  {
    name: "seller payouts auth gate",
    path: "/seller/payouts",
    requiredText: [
      "Seller Payouts",
      "Log in through your TCOS account first",
      "review payout verification, cash-out readiness, and seller hold context",
      "Log In",
      "Account",
    ],
    expect: (result) =>
      result.text.includes("Seller Payouts") &&
      result.text.includes("Log in through your TCOS account first") &&
      result.text.includes("review payout verification, cash-out readiness, and seller hold context") &&
      result.text.includes("Log In") &&
      result.text.includes("Account"),
  },
  {
    name: "launch handoff bundle",
    path: "/api/admin/launch-readiness?format=handoff-bundle",
    requiredText: [
      "# TCOS Launch Hand-off Bundle",
      "## Under-$20 Seller Protection",
      "2% of the protected sale withheld",
      "$20.00 protected item amount cap",
      "LetterTrack/USPS IMb evidence must not show delivered",
      "20260712174000_add_seller_protection_financial_adjustments.sql",
      "## Git Tip Verification",
      "git fetch origin main",
      "git rev-parse --short HEAD",
      "git rev-parse --short origin/main",
      "git log -5 --oneline",
      "## Production Deploy Commands",
      "Approval blockers:",
      "Launch locks:",
      "Operator summary:",
      "Next live-money actions:",
      "## Live Money JSON Evidence",
      "Schema: `tcos.liveMoneyGoNoGo.v1`",
      "Post-smoke archive command: `npm --silent run status:live-money:json`",
      "Final-window preflight command: `npm --silent run preflight:live-money:json`",
      "Accepted go-live states: READY_FOR_RUNTIME_SWITCH, LIVE_MONEY_OPEN",
      "Halt states: BLOCKED_UNEVALUATED, BLOCKED_APPROVAL, READY_FOR_DATABASE_APPROVAL, BLOCKED_LAUNCH_GATE",
      "Archive the status JSON after production smoke passes",
      "must not create Checkout Sessions",
      "npm run verify:production",
      "npm run status:production",
      "npm run launch:production",
      "npm run deploy:production",
      "npm run smoke:production",
      "api-deployments-free-per-day",
      "rolling 24-hour quota reset",
      "Vercel can still upload files before returning the quota error",
      ".codex-run/vercel-quota-block.json",
      "TCOS_VERCEL_QUOTA_RETRY_OVERRIDE=true",
      "--force-quota-retry",
      "Require vercel --prod to exit successfully before parsing its deployment URL, running alias commands, or clearing the quota marker",
      "Use command-pinned Vercel CLI 56.2.0 through isolated npm exec",
      "Require unwanted-alias removal to succeed or return Vercel CLI's explicit alias-not-found result",
      "Accept production target overrides only as valid DNS hostnames or root HTTP(S) URLs",
      "Accept production smoke targets only as valid DNS hostnames or root HTTP(S) URLs",
      "On normal deploys, enforce the local quota cooldown before npm exec, Git fetch, build, upload, or deployment",
      "deploy live safety contract",
      "## Production Go/No-Go Ladder",
      "Verify the pushed stack",
      "Launch only when quota is open",
      "Halt on Vercel quota",
      "Ship only after smoke passes clean production",
      "## Shipping Provider Unlock Action Plan",
      "Choose provider accounts",
      "Stage Vercel environment names",
      "Keep shipping runtime locked",
      "Protected deploy sequence:",
      "## Deployment Source",
      "Git commit SHA:",
      "Smoke comparison:",
      "production smoke POSTs `/api/admin/shipping/simulations`",
      "five expected purchase-audit scenarios",
      "no missing or unexpected scenario keys",
      "no missing/unexpected purchase-audit keys",
      ...sellerMarketplaceReceiptHandoffBundleText,
    ],
    expect: (result) =>
      hasAttachmentFilename(result, "tcos-launch-handoff-bundle.md") &&
      result.text.includes("# TCOS Launch Hand-off Bundle") &&
      result.text.includes("## Under-$20 Seller Protection") &&
      result.text.includes("2% of the protected sale withheld") &&
      result.text.includes("$20.00 protected item amount cap") &&
      result.text.includes("LetterTrack/USPS IMb evidence must not show delivered") &&
      result.text.includes("20260712174000_add_seller_protection_financial_adjustments.sql") &&
      result.text.includes("## Git Tip Verification") &&
      result.text.includes("git fetch origin main") &&
      result.text.includes("git rev-parse --short HEAD") &&
      result.text.includes("git rev-parse --short origin/main") &&
      result.text.includes("git log -5 --oneline") &&
      result.text.includes("## Production Deploy Commands") &&
      result.text.includes("Approval blockers:") &&
      result.text.includes("Launch locks:") &&
      result.text.includes("Operator summary:") &&
      result.text.includes("Next live-money actions:") &&
      result.text.includes("## Live Money JSON Evidence") &&
      result.text.includes("Schema: `tcos.liveMoneyGoNoGo.v1`") &&
      result.text.includes("Post-smoke archive command: `npm --silent run status:live-money:json`") &&
      result.text.includes("Final-window preflight command: `npm --silent run preflight:live-money:json`") &&
      result.text.includes("Accepted go-live states: READY_FOR_RUNTIME_SWITCH, LIVE_MONEY_OPEN") &&
      result.text.includes("Halt states: BLOCKED_UNEVALUATED, BLOCKED_APPROVAL, READY_FOR_DATABASE_APPROVAL, BLOCKED_LAUNCH_GATE") &&
      result.text.includes("Archive the status JSON after production smoke passes") &&
      result.text.includes("must not create Checkout Sessions") &&
      result.text.includes("npm run verify:production") &&
      result.text.includes("npm run launch:production") &&
      result.text.includes("npm run status:production") &&
      result.text.includes("npm run deploy:production") &&
      result.text.includes("npm run smoke:production") &&
      result.text.includes("api-deployments-free-per-day") &&
      result.text.includes("rolling 24-hour quota reset") &&
      result.text.includes("Vercel can still upload files before returning the quota error") &&
      result.text.includes(".codex-run/vercel-quota-block.json") &&
      result.text.includes("TCOS_VERCEL_QUOTA_RETRY_OVERRIDE=true") &&
      result.text.includes("--force-quota-retry") &&
      result.text.includes("deploy live safety contract") &&
      result.text.includes("## Production Go/No-Go Ladder") &&
      result.text.includes("Verify the pushed stack") &&
      result.text.includes("Launch only when quota is open") &&
      result.text.includes("Halt on Vercel quota") &&
      result.text.includes("Ship only after smoke passes clean production") &&
      result.text.includes("## Shipping Provider Unlock Action Plan") &&
      result.text.includes("Choose provider accounts") &&
      result.text.includes("Stage Vercel environment names") &&
      result.text.includes("Keep shipping runtime locked") &&
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
      result.text.includes("five expected purchase-audit scenarios") &&
      result.text.includes("no missing or unexpected scenario keys") &&
      result.text.includes("no missing/unexpected purchase-audit keys") &&
      includesAll(result.text, sellerMarketplaceReceiptHandoffBundleText) &&
      result.text.includes("truely-collectables-tt3b.vercel.app"),
  },
  {
    name: "live payment gate",
    path: "/admin/live-payment-launch",
    expect: (result) =>
      result.text.includes("Live Payment Launch Gate") &&
      result.text.includes("Stripe Mode") &&
      result.text.includes("Approval version") &&
      result.text.includes("Approval Blockers") &&
      result.text.includes("Launch Locks") &&
      result.text.includes("Operator next actions") &&
      result.text.includes("What remains before live money") &&
      result.text.includes("Approve Live Payments") &&
      result.text.includes("Payment Lab"),
  },
  {
    name: "live shipping gate",
    path: "/admin/live-shipping-launch",
    expect: (result) => {
      const pageText = visibleText(result.text);

      return (
        pageText.includes("Live Shipping Launch Gate") &&
        pageText.includes("Provider secrets and live-adapter evidence") &&
        pageText.includes("Provider verdict") &&
        pageText.includes("Shipping Provider Unlock Action Plan") &&
        pageText.includes("Choose provider accounts") &&
        pageText.includes("Stage Vercel environment names") &&
        pageText.includes("Keep shipping runtime locked") &&
        pageText.includes("Operator Checklist") &&
        pageText.includes("Standard Envelope Evidence + Under-$20 Protection Contract") &&
        pageText.includes("LetterTrack / USPS IMb is delivery evidence, not insurance") &&
        pageText.includes("Runtime gate validator: ready") &&
        pageText.includes("Provider Purchase-Attempt Audit Suite") &&
        pageText.includes("Purchase-Audit Key Drift") &&
        pageText.includes("Missing Purchase Audit Keys") &&
        pageText.includes("Unexpected Purchase Audit Keys") &&
        pageText.includes("Not insurance: LetterTrack / USPS IMb is delivery-evidence tracking") &&
        pageText.includes("Immutable Shipping Approval History") &&
        pageText.includes("Shipping Lab")
      );
    },
  },
  {
    name: "live shipping gate json",
    path: "/api/admin/live-shipping-launch",
    expect: (result) =>
      result.contentType.includes("application/json") &&
      result.text.includes('"standardEnvelopeEvidenceContract"') &&
      result.text.includes('"standardEnvelopeEvidenceContractReady":true') &&
      result.text.includes('"purchaseAttemptAuditSimulation"') &&
      result.text.includes('"expected_scenario_count":5') &&
      result.text.includes('"scenario_key_coverage_status":"passed"') &&
      result.text.includes('"missing_scenario_keys":[]') &&
      result.text.includes('"unexpected_scenario_keys":[]') &&
      result.text.includes('"evidenceProvider":"LetterTrack / USPS IMb"') &&
      result.text.includes('"trackableRequirement"') &&
      result.text.includes('"under20ProtectionModel"') &&
      result.text.includes('"sellerOptInRule"') &&
      result.text.includes('"reserveRate":"2%"') &&
      result.text.includes('"itemReimbursementCap":"$20.00"') &&
      result.text.includes('"reimbursesShipping":"no"') &&
      result.text.includes('"notInsuranceNotice"') &&
      result.text.includes('"standard_envelope_evidence_contract"') &&
      result.text.includes('"Standard Envelope Evidence Contract"'),
  },
  {
    name: "admin shipping lettertrack controls",
    path: "/admin/shipping",
    requiredText: [
      "Export LetterTrack CSV",
      "LetterTrack IMb Recording",
      "LetterTrack Delivery Evidence",
      "Seller Protection Refund Proof Missing",
      "Seller Protection Payout Blocked",
      "Shipping Provider Unlock Action Plan",
      "Choose provider accounts",
      "Stage Vercel environment names",
      "Keep shipping runtime locked",
    ],
    expect: (result) =>
      result.text.includes("Export LetterTrack CSV") &&
      result.text.includes("LetterTrack IMb Recording") &&
      result.text.includes("LetterTrack Delivery Evidence") &&
      result.text.includes("Seller Protection Refund Proof Missing") &&
      result.text.includes("Seller Protection Payout Blocked") &&
      result.text.includes("Shipping Provider Unlock Action Plan") &&
      result.text.includes("Choose provider accounts") &&
      result.text.includes("Stage Vercel environment names") &&
      result.text.includes("Keep shipping runtime locked"),
  },
  {
    name: "shipping simulation lab",
    path: "/admin/shipping/simulations",
    requiredText: [
      "Shipping Simulation Lab",
      "Scenario Coverage",
      "Scenario Keys",
      "Scenario coverage guardrail",
      "Missing Scenario Keys",
      "Unexpected Scenario Keys",
      "Seller-protection money trail",
      "Under-$20 Seller Protection Allocation Contract",
      "Item-only reimbursement",
      "Shipping exclusion",
      "No opt-in liability",
      "20",
      "Mixed under-$20 claim rows cap reimbursement at $20",
      "Seller order views can show under-$20 protection status, 2% reserve, protected item cap, unprotected row liability, and shipping excluded from reimbursement",
      "Seller-protection Mark Paid allocation creates credits only for eligible payable seller rows",
      "records operator-readable skip reasons for unprotected/forged/missing-seller/zero-covered/cap-reached rows",
      "Opted-in under-$20 Standard Envelope reimbursement allocates item sale amount only and records excluded shipping",
      "Under-$20 seller-protection Mark Paid requires a current or previously saved internal note confirming buyer refund evidence",
      "Provider setup exports state that LetterTrack / USPS IMb supplies trackable delivery evidence",
      "LetterTrack CSV rows carry the under-$20 seller-protection contract",
      "Under-$20 seller-protection payout blocks delivered LetterTrack evidence, allows not-delivered review evidence, and accepts a current or previously saved explicit override note",
      "Missing Purchase Audit Keys",
      "Unexpected Purchase Audit Keys",
      "DRY RUN STANDARD ENVELOPE PURCHASE",
    ],
    expect: (result) =>
      result.text.includes("Shipping Simulation Lab") &&
      result.text.includes("Scenario Coverage") &&
      result.text.includes("Scenario Keys") &&
      result.text.includes("Scenario coverage guardrail") &&
      result.text.includes("Missing Scenario Keys") &&
      result.text.includes("Unexpected Scenario Keys") &&
      result.text.includes("Seller-protection money trail") &&
      result.text.includes("Under-$20 Seller Protection Allocation Contract") &&
      result.text.includes("Item-only reimbursement") &&
      result.text.includes("Shipping exclusion") &&
      result.text.includes("No opt-in liability") &&
      result.text.includes("20") &&
      result.text.includes(
        "Mixed under-$20 claim rows cap reimbursement at $20",
      ) &&
      result.text.includes(
        "Seller order views can show under-$20 protection status, 2% reserve, protected item cap, unprotected row liability, and shipping excluded from reimbursement",
      ) &&
      result.text.includes(
        "Seller-protection Mark Paid allocation creates credits only for eligible payable seller rows",
      ) &&
      result.text.includes(
        "records operator-readable skip reasons for unprotected/forged/missing-seller/zero-covered/cap-reached rows",
      ) &&
      result.text.includes(
        "Opted-in under-$20 Standard Envelope reimbursement allocates item sale amount only and records excluded shipping",
      ) &&
      result.text.includes(
        "Under-$20 seller-protection Mark Paid requires a current or previously saved internal note confirming buyer refund evidence",
      ) &&
      result.text.includes(
        "Provider setup exports state that LetterTrack / USPS IMb supplies trackable delivery evidence",
      ) &&
      result.text.includes("Purchase Attempt Audit Coverage") &&
      result.text.includes("Missing Purchase Audit Keys") &&
      result.text.includes("Unexpected Purchase Audit Keys") &&
      result.text.includes("live_gate_blocker_evidence_ready") &&
      result.text.includes("provider_setup_blocker_evidence_blocked") &&
      result.text.includes("packet_purchase_attempt_audit_lines") &&
      result.text.includes(
        "LetterTrack CSV rows carry the under-$20 seller-protection contract",
      ) &&
      result.text.includes(
        "Under-$20 seller-protection payout blocks delivered LetterTrack evidence, allows not-delivered review evidence, and accepts a current or previously saved explicit override note",
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
      result.text.includes('"scenario_count":20') &&
      result.text.includes('"expected_scenario_count":20') &&
      result.text.includes('"scenario_coverage_status":"passed"') &&
      result.text.includes('"scenario_key_coverage_status":"passed"') &&
      result.text.includes('"missing_scenario_keys":[]') &&
      result.text.includes('"unexpected_scenario_keys":[]') &&
      result.text.includes('"seller_protection_allocation_contract"') &&
      result.text.includes('"itemOnlyReimbursementRule"') &&
      result.text.includes('"shippingExclusionRule"') &&
      result.text.includes('"nonOptedInSellerLiabilityRule"') &&
      result.text.includes('"provider_setup_standard_envelope_evidence_contract"') &&
      result.text.includes('"under_20_seller_protection_caps_mixed_rows"') &&
      result.text.includes('"under_20_seller_protection_seller_order_visibility"') &&
      result.text.includes('"under_20_seller_protection_reimbursement_allocation"') &&
      result.text.includes(
        '"under_20_seller_protection_item_only_allocation_vs_seller_liability"',
      ) &&
      result.text.includes('"under_20_seller_protection_buyer_refund_gate"') &&
      result.text.includes('"lettertrack_csv_seller_protection_contract"') &&
      result.text.includes('"lettertrack_seller_protection_evidence_review_audit"') &&
      result.text.includes('"dry_run_standard_envelope_purchase"') &&
      result.text.includes('"purchase_audit"') &&
      result.text.includes('"expected_scenario_count":5') &&
      result.text.includes('"live_gate_blocker_evidence_ready"') &&
      result.text.includes('"provider_setup_blocker_evidence_blocked"') &&
      result.text.includes('"dry_run_purchase_attempt_audit_sentence"') &&
      result.text.includes('"packet_purchase_attempt_audit_lines"'),
  },
  {
    name: "shipping exceptions export",
    path: "/api/admin/shipping/exceptions",
    expect: (result) =>
      result.contentType.includes("text/csv") &&
      hasAttachmentFilename(result, "tcos-shipping-exceptions-") &&
      result.text.includes("priority_rank,exception_key,severity") &&
      result.text.includes("exception_type") &&
      result.text.includes("action_needed") &&
      result.text.includes("claim_id") &&
      result.text.includes("dry_run_warning") &&
      result.response?.headers.get("x-tcos-shipping-exceptions-rows") !==
        null &&
      result.response?.headers.get("x-tcos-shipping-exceptions-critical") !==
        null &&
      result.response?.headers.get("x-tcos-shipping-exceptions-warning") !==
        null &&
      result.response?.headers.get("x-tcos-shipping-exceptions-watch") !==
        null &&
      result.response?.headers.get("x-tcos-shipping-exceptions-summary") !==
        null &&
      !result.text.includes("sk_live_") &&
      !result.text.includes("whsec_"),
  },
  {
    name: "shipping provider setup json",
    path: "/api/admin/shipping/provider-setup",
    expect: (result) =>
      result.contentType.includes("application/json") &&
      result.text.includes('"credentialGroups"') &&
      result.text.includes('"actionPlan"') &&
      result.text.includes('"Choose provider accounts"') &&
      result.text.includes('"Stage Vercel environment names"') &&
      result.text.includes('"Keep shipping runtime locked"') &&
      result.text.includes('"standardEnvelopeEvidenceContract"') &&
      result.text.includes('"standardEnvelopeEvidenceContractReady":true') &&
      result.text.includes('"evidenceProvider":"LetterTrack / USPS IMb"') &&
      result.text.includes('"trackableRequirement"') &&
      result.text.includes('"notInsuranceNotice"') &&
      result.text.includes('"exports"') &&
      result.text.includes('"csv"') &&
      result.text.includes('"envTemplate"') &&
      result.text.includes('"vercelCommands"') &&
      result.text.includes('"operatorChecklist"') &&
      hasShippingProviderSetupHeaders(result) &&
      !result.text.includes("sk_live_") &&
      !result.text.includes("whsec_"),
  },
  {
    name: "shipping provider setup csv",
    path: "/api/admin/shipping/provider-setup?format=csv",
    expect: (result) =>
      result.contentType.includes("text/csv") &&
      hasAttachmentFilename(result, "tcos-shipping-provider-setup-") &&
      result.text.includes("decisionStatus,decisionSummary,decisionNextAction") &&
      result.text.includes("setupActionPlan") &&
      result.text.includes("Choose provider accounts") &&
      result.text.includes("standardEnvelopeEvidenceProvider") &&
      result.text.includes("under20ProtectionNotInsurance") &&
      result.text.includes("standardEnvelopeEvidenceContractReady") &&
      result.text.includes("LetterTrack / USPS IMb") &&
      result.text.includes("not third-party insurance") &&
      result.text.includes("liveRequirementBlockers") &&
      result.text.includes("missingCredentialKeys") &&
      hasShippingProviderSetupHeaders(result) &&
      !result.text.includes("sk_live_") &&
      !result.text.includes("whsec_"),
  },
  {
    name: "shipping provider env template",
    path: "/api/admin/shipping/provider-setup?format=env-template",
    expect: (result) =>
      result.contentType.includes("text/plain") &&
      hasAttachmentFilename(result, "tcos-shipping-provider-env-template-") &&
      result.text.includes("TCOS shipping provider setup template") &&
      result.text.includes("Shipping provider unlock action plan") &&
      result.text.includes("Choose provider accounts") &&
      result.text.includes("Stage Vercel environment names") &&
      result.text.includes("Standard Envelope evidence/protection contract") &&
      result.text.includes("Runtime gate validator: ready") &&
      result.text.includes("Evidence provider: LetterTrack / USPS IMb") &&
      result.text.includes("TCOS Under-$20 Seller Protection is an optional internal seller program") &&
      result.text.includes("Not insurance: LetterTrack / USPS IMb is delivery-evidence tracking") &&
      result.text.includes("TCOS_SHIPPING_PURCHASE_MODE=dry_run") &&
      result.text.includes("TCOS_LIVE_SHIPPING_ENABLED=false") &&
      hasShippingProviderSetupHeaders(result) &&
      !result.text.includes("sk_live_") &&
      !result.text.includes("whsec_"),
  },
  {
    name: "shipping provider vercel commands",
    path: "/api/admin/shipping/provider-setup?format=vercel-commands",
    expect: (result) =>
      result.contentType.includes("text/plain") &&
      hasAttachmentFilename(result, "tcos-shipping-provider-vercel-env-") &&
      result.text.includes("vercel env add") &&
      result.text.includes("Shipping provider unlock action plan") &&
      result.text.includes("Stage Vercel environment names") &&
      result.text.includes("# Production environment") &&
      result.text.includes("TCOS_LIVE_SHIPPING_ENABLED") &&
      hasShippingProviderSetupHeaders(result) &&
      !result.text.includes("sk_live_") &&
      !result.text.includes("whsec_"),
  },
  {
    name: "shipping provider operator checklist",
    path: "/api/admin/shipping/provider-setup?format=operator-checklist",
    expect: (result) =>
      result.contentType.includes("text/markdown") &&
      hasAttachmentFilename(result, "tcos-shipping-provider-operator-checklist-") &&
      result.text.includes("# TCOS Shipping Provider Operator Checklist") &&
      result.text.includes("## Shipping Provider Unlock Action Plan") &&
      result.text.includes("Choose provider accounts") &&
      result.text.includes("Stage Vercel environment names") &&
      result.text.includes("Keep shipping runtime locked") &&
      result.text.includes("## Standard Envelope Evidence + Under-$20 Protection Contract") &&
      result.text.includes("Runtime gate validator: ready") &&
      result.text.includes("Evidence provider: LetterTrack / USPS IMb") &&
      result.text.includes("TCOS Under-$20 Seller Protection is an optional internal seller program") &&
      result.text.includes("Not insurance: LetterTrack / USPS IMb is delivery-evidence tracking") &&
      result.text.includes("Keep TCOS_SHIPPING_PURCHASE_MODE=dry_run") &&
      result.text.includes("Keep TCOS_LIVE_SHIPPING_ENABLED=false") &&
      hasShippingProviderSetupHeaders(result) &&
      !result.text.includes("sk_live_") &&
      !result.text.includes("whsec_"),
  },
  {
    name: "lettertrack standard envelope export",
    path: "/api/admin/shipping/lettertrack-export",
    expect: (result) =>
      result.contentType.includes("text/csv") &&
      hasAttachmentFilename(result, "tcos-lettertrack-standard-envelope-") &&
      result.text.includes("orderNumber,labelId,recipientName") &&
      result.text.includes("sellerProtectionReserveRate") &&
      result.text.includes("sellerProtectionReimbursesShipping") &&
      result.text.includes("deliveryEvidenceRequirement") &&
      result.response?.headers.get("x-tcos-lettertrack-rows") !== null &&
      result.response?.headers.get("x-tcos-lettertrack-skipped") !== null &&
      result.response?.headers.get("x-tcos-lettertrack-skipped-reasons") !==
        null &&
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
  "seller marketplace packet intake",
  "seller inventory auth gate",
  "seller orders auth gate",
  "seller payouts auth gate",
  "live payment gate",
  "live shipping gate",
  "live shipping gate json",
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
    missingText: "",
    diagnostic: login.ok && Boolean(cookie) ? "" : "admin login failed or did not return a session cookie",
    passed: login.ok && Boolean(cookie),
  },
];

for (const check of checks) {
  const result = await request(check.path, {
    ...check.options,
    headers: { ...authHeaders, ...(check.options?.headers || {}) },
  });
  const missingText = missingRequiredText(result, check);
  const passed = result.ok && check.expect(result) && missingText.length === 0;
  results.push({
    name: check.name,
    path: check.path,
    status: result.status,
    durationMs: result.durationMs,
    contentType: result.contentType,
    snippet: safeSnippet(result.text, result.error),
    missingText: missingText.join(" | "),
    diagnostic: passed ? "" : check.diagnostic?.(result) || "",
    passed,
  });
}

const unwantedAlias = await requestUrl(unwantedAliasUrl);
results.push({
  name: `unwanted ${new URL(unwantedAliasUrl).hostname} alias absent`,
  path: unwantedAlias.path,
  status: unwantedAlias.status,
  durationMs: unwantedAlias.durationMs,
  contentType: unwantedAlias.contentType,
  snippet:
    safeSnippet(unwantedAlias.text, unwantedAlias.error) ||
    "alias did not return content",
  missingText: "",
  diagnostic: unwantedAlias.ok
    ? "unwanted Vercel alias is still reachable and should be removed"
    : "",
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
      missingText: result.missingText || "none",
      diagnostic: result.diagnostic || "none",
      snippet: result.snippet || "empty response",
    })),
  );

  if (queuedFeatureFailures.length > 0) {
    console.error(
      "Queued launch features are not visible on production yet. If Vercel quota recently blocked deployment, rerun npm run launch:production once quota resets. If deployment already succeeded, rerun npm run smoke:production.",
    );
    console.error(
      `Queued launch feature failure(s): ${queuedFeatureFailures
        .map(smokeFailureDetail)
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
