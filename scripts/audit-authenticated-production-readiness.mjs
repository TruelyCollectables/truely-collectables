import fs from "node:fs";

const baseUrl = "https://truelycollectables.com";
const outputFile = process.env.AUTHENTICATED_READINESS_OUTPUT || "authenticated-production-readiness.json";
const password = String(process.env.SMOKE_ADMIN_PASSWORD || "").trim();

function cookieValue(response) {
  if (typeof response.headers.getSetCookie === "function") return response.headers.getSetCookie().join("; ");
  return response.headers.get("set-cookie") || "";
}
function safe(value) {
  return String(value || "").replace(/\s+/g, " ").slice(0, 600);
}
async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    redirect: "manual",
    signal: AbortSignal.timeout(20000),
    ...options,
  });
  const text = await response.text();
  return { response, text };
}

const payload = {
  schema: "truelyCollectables.authenticatedProductionReadiness.v1",
  generatedAt: new Date().toISOString(),
  authenticated: false,
  deployment: null,
  overall: null,
  payment: null,
  paymentAttentionItems: [],
  errors: [],
  secretValuesIncluded: false,
  readOnlyGuarantee: "This audit authenticates to existing admin read-only routes only. It does not change environment variables, database rows, launch approvals, payment switches, deployments, Stripe objects, refunds, payouts, or postage.",
};

try {
  if (!password) throw new Error("SMOKE_ADMIN_PASSWORD is missing.");
  const login = await request("/api/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });
  const cookie = cookieValue(login.response);
  if (login.response.status < 200 || login.response.status >= 400 || !cookie) {
    throw new Error(`Admin login failed with HTTP ${login.response.status}.`);
  }
  payload.authenticated = true;

  const readiness = await request("/api/admin/launch-readiness", {
    headers: { cookie, accept: "application/json" },
  });
  let body = null;
  try { body = JSON.parse(readiness.text); } catch {}
  if (!readiness.response.ok || body?.success !== true || !body?.brief) {
    throw new Error(`Launch Readiness returned HTTP ${readiness.response.status}.`);
  }
  const brief = body.brief;
  payload.deployment = {
    gitCommitSha: brief.deployment?.gitCommitSha || null,
    gitCommitRef: brief.deployment?.gitCommitRef || null,
    cleanProductionDomain: brief.deployment?.cleanProductionDomain || null,
    vercelUrl: brief.deployment?.vercelUrl || null,
  };
  payload.overall = {
    status: brief.status?.overall || null,
    nextStep: safe(brief.status?.nextStep),
    ready: Number(brief.summary?.ready || 0),
    review: Number(brief.summary?.review || 0),
    blocked: Number(brief.summary?.blocked || 0),
  };
  payload.payment = {
    mode: brief.payment?.mode || null,
    livePaymentsEnabled: Boolean(brief.payment?.livePaymentsEnabled),
    approvalDatabaseReady: Boolean(brief.payment?.approvalDatabaseReady),
    approvalReady: Boolean(brief.payment?.approvalReady),
    approvalBlockingCount: Number(brief.payment?.approvalBlockingCount || 0),
    launchLockCount: Number(brief.payment?.launchLockCount || 0),
    operatorSummary: safe(brief.payment?.operatorSummary),
    nextActions: Array.isArray(brief.payment?.nextActions)
      ? brief.payment.nextActions.map(safe).slice(0, 20)
      : [],
  };
  payload.paymentAttentionItems = Array.isArray(brief.attentionItems)
    ? brief.attentionItems
        .filter((item) => String(item?.label || "").startsWith("Payment:"))
        .map((item) => ({
          label: safe(item.label),
          status: item.status || null,
          detail: safe(item.detail),
          action: safe(item.action),
        }))
    : [];
} catch (error) {
  payload.errors.push(error instanceof Error ? error.message : "Unknown authenticated readiness error.");
  process.exitCode = 1;
}

payload.readyForDatabaseApproval = Boolean(
  payload.authenticated &&
  payload.payment?.approvalDatabaseReady &&
  payload.payment?.approvalBlockingCount === 0 &&
  !payload.payment?.livePaymentsEnabled,
);
fs.writeFileSync(outputFile, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
console.log(`Authenticated Production readiness: authenticated=${payload.authenticated}, approvalBlockers=${payload.payment?.approvalBlockingCount ?? "unknown"}, launchLocks=${payload.payment?.launchLockCount ?? "unknown"}.`);
