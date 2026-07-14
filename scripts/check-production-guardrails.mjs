import { spawnSync } from "node:child_process";
import fs from "node:fs";

const node = process.execPath;
const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
const scripts = packageJson.scripts || {};

function redactSecrets(text) {
  return text
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
    .replace(/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g, "[redacted-jwt]");
}

function diagnosticOutput(text) {
  return redactSecrets(text)
    .replace(/\s+$/g, "")
    .slice(0, 4000);
}

function runGuardrailRedactionSelfTest() {
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
  const snippet = diagnosticOutput(sample);
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
  ].filter((marker) => snippet.includes(marker));

  if (leakedMarkers.length > 0) {
    throw new Error(
      `Production guardrail redaction self-test leaked marker(s): ${leakedMarkers.join(", ")}`,
    );
  }

  console.log("PASS production guardrail redaction self-test");
}

function assertScriptIncludes(scriptName, expectedParts) {
  const script = scripts[scriptName];

  if (!script) {
    throw new Error(`package.json is missing required script: ${scriptName}`);
  }

  const missing = expectedParts.filter((part) => !script.includes(part));

  if (missing.length > 0) {
    throw new Error(
      `${scriptName} is missing required command(s): ${missing.join(", ")}\nActual: ${script}`,
    );
  }

  console.log(`PASS ${scriptName} includes ${expectedParts.join(", ")}`);
}

function assertFileIncludes(name, filePath, expectedParts) {
  const text = fs.readFileSync(filePath, "utf8");
  const missing = expectedParts.filter((part) => !text.includes(part));

  if (missing.length > 0) {
    throw new Error(
      `${name} in ${filePath} is missing required production guardrail text: ${missing.join(", ")}`,
    );
  }

  console.log(`PASS ${name} includes ${expectedParts.join(", ")}`);
}

function assertFileOrder(name, filePath, orderedParts) {
  const text = fs.readFileSync(filePath, "utf8");
  let cursor = -1;

  for (const part of orderedParts) {
    const index = text.indexOf(part, cursor + 1);

    if (index === -1) {
      throw new Error(
        `${name} in ${filePath} is missing ordered production guardrail text after ${cursor}: ${part}`,
      );
    }

    cursor = index;
  }

  console.log(`PASS ${name} order includes ${orderedParts.join(" -> ")}`);
}

function runExpectedSuccess(name, args, env = {}) {
  const result = spawnSync(node, args, {
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
    },
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`;

  if (result.status !== 0) {
    throw new Error(`${name} failed unexpectedly.\n${diagnosticOutput(output)}`);
  }

  console.log(`PASS ${name}`);
}

function runExpectedFailure(name, args, env, expectedText) {
  const result = spawnSync(node, args, {
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
    },
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`;

  if (result.status === 0) {
    throw new Error(`${name} unexpectedly passed.\n${diagnosticOutput(output)}`);
  }

  if (!output.includes(expectedText)) {
    throw new Error(
      `${name} failed, but did not print the expected guardrail message.\nExpected: ${expectedText}\nActual:\n${diagnosticOutput(output)}`,
    );
  }

  console.log(`PASS ${name}`);
}

runGuardrailRedactionSelfTest();

runExpectedSuccess("deploy helper syntax check", [
  "--check",
  "scripts/deploy-production.mjs",
]);
runExpectedSuccess("smoke helper syntax check", [
  "--check",
  "scripts/smoke-production.mjs",
]);
runExpectedSuccess("shipping simulation runner syntax check", [
  "--import",
  "tsx",
  "--check",
  "scripts/run-shipping-simulations.ts",
]);
runExpectedSuccess("shipping purchase audit simulation runner syntax check", [
  "--import",
  "tsx",
  "--check",
  "scripts/run-shipping-purchase-audit-simulations.ts",
]);
assertScriptIncludes("verify:shipping", [
  "simulate:lettertrack-evidence",
  "simulate:shipping-purchase-audit",
  "simulate:shipping",
]);
assertScriptIncludes("verify:production", [
  "verify:instacomp",
  "verify:shipping",
  "check:production-guardrails",
  "preflight:production",
]);
assertScriptIncludes("launch:production", [
  "verify:production",
  "deploy:production",
  "smoke:production",
]);
assertFileIncludes("launch dashboard smoke contract", "scripts/smoke-production.mjs", [
  'name: "admin dashboard"',
  'path: "/admin"',
  "Shipping Setup",
  "Shipping Provider Unlock Action Plan",
  "Choose provider accounts",
  "Stage Vercel environment names",
  "Keep shipping runtime locked",
  "Standard Envelope evidence validator",
  "Purchase-audit key drift",
  "unexpected",
]);
assertFileIncludes("admin dashboard shipping evidence validator source", "src/app/admin/page.tsx", [
  "ProviderSetupActionPlanStep",
  "shippingProviderSetup.actionPlan",
  "Shipping Provider Unlock Action Plan",
  "/api/admin/shipping/provider-setup?format=operator-checklist",
  "launchGateDrill.shipping.standardEnvelopeEvidenceContractReady",
  "purchaseAttemptAuditMissingScenarioKeys",
  "purchaseAttemptAuditUnexpectedScenarioKeys",
  "shippingProviderSetup.standardEnvelopeEvidenceContractReady",
  "Standard Envelope evidence validator",
  "Purchase-audit key drift",
]);
assertFileIncludes("launch readiness smoke contract", "scripts/smoke-production.mjs", [
  'name: "launch readiness page"',
  'path: "/admin/launch-readiness"',
  "Launch Readiness",
  "Production Deploy Queue",
  "Shipping Provider Unlock Action Plan",
  "Choose provider accounts",
  "Stage Vercel environment names",
  "Keep shipping runtime locked",
  "Export operator checklist",
  "npm run verify:production",
  "git fetch origin main",
  'optionalRun("git", ["rev-parse", "origin/main"])',
  "origin/main full SHA:",
  "function launchReadinessDeploymentMatchesOriginMain",
  "function launchReadinessDeploymentDiagnostic",
  "Deployment source mismatch:",
  "gitCommitSha production=",
  "origin/main=",
  "diagnostic:",
  "deployment.gitCommitSha === remoteFullHead",
  "deployment.gitCommitShortSha === remoteHead",
  "deployment.gitCommitRef === \"main\"",
  "deployment.cleanProductionDomain === baseUrl",
  "npm run check:production-guardrails",
  "npm run preflight:production",
  "nineteen-scenario shipping simulation suite",
  "LetterTrack evidence checks",
  "shipping purchase-attempt audit simulations",
  "Standard Envelope evidence validator is ready",
  "/api/admin/shipping/simulations",
  "nineteen expected shipping scenarios",
  "five expected purchase-audit scenarios",
  "no missing/unexpected simulation keys",
  'name: "launch readiness json"',
  'path: "/api/admin/launch-readiness"',
  'result.contentType.includes("application/json")',
  '"brief"',
  '"deploySafety"',
  '"deployment"',
  '"gitCommitSha"',
  '"gitCommitRef"',
  '"vercelUrl"',
  '"cleanProductionDomain"',
  "Compare this Git commit SHA with origin/main",
  '"standardEnvelopeEvidenceContractReady":true',
  '"purchaseAttemptAuditRunStatus":"passed"',
  '"purchaseAttemptAuditExpectedScenarioCount":5',
  '"purchaseAttemptAuditKeyCoverageStatus":"passed"',
  '"purchaseAttemptAuditMissingScenarioKeys":[]',
  '"purchaseAttemptAuditUnexpectedScenarioKeys":[]',
  "launchReadinessDeploymentMatchesOriginMain(result)",
  "diagnostic: launchReadinessDeploymentDiagnostic",
  "requiredText: remoteFullHead ? [remoteFullHead] : []",
  '"quotaBlockCode":"api-deployments-free-per-day"',
  '"sequence"',
  "npm run smoke:production handoff",
  'name: "launch readiness markdown"',
  'path: "/api/admin/launch-readiness?format=markdown"',
  "# TCOS Launch Readiness Brief",
  "Standard Envelope evidence validator: ready",
  "Provider purchase-attempt audit suite: passed; 5/5 scenarios; key coverage passed",
  "Missing purchase audit keys: none",
  "Unexpected purchase audit keys: none",
  "## Deployment Source",
  "Git commit SHA:",
  "Smoke comparison:",
  "## Production Deploy Safety",
  "Protected deploy sequence:",
]);
assertFileIncludes("launch gate drill smoke contract", "scripts/smoke-production.mjs", [
  'name: "launch gate drill page"',
  'path: "/admin/launch-gate-drill"',
  "Launch Gate Drill",
  "No-money runtime smoke",
  "Download Drill Report",
  "Standard Envelope evidence validator is ready",
  "Provider Purchase-Attempt Audit Suite",
  "Shipping Provider Unlock Action Plan",
  "Choose provider accounts",
  "Stage Vercel environment names",
  "Keep shipping runtime locked",
  '"purchaseAttemptAuditRunStatus":"passed"',
  '"purchaseAttemptAuditExpectedScenarioCount":5',
  '"purchaseAttemptAuditMissingScenarioKeys":[]',
  '"purchaseAttemptAuditUnexpectedScenarioKeys":[]',
  '"providerSetupActionPlan"',
  "Provider purchase-attempt audit suite: passed; 5/5 scenarios; key coverage passed",
  "Missing purchase audit keys: none",
  "Unexpected purchase audit keys: none",
  "## Shipping Provider Unlock Action Plan",
  "Not allowed during this drill",
  'name: "launch gate drill json"',
  'path: "/api/admin/launch-gate-drill"',
  'result.contentType.includes("application/json")',
  '"standardEnvelopeEvidenceContractReady":true',
  '"sideEffectPolicy"',
  '"forbiddenOperations"',
  'name: "launch gate drill markdown"',
  'path: "/api/admin/launch-gate-drill?format=markdown"',
  'result.contentType.includes("text/markdown")',
  "# TCOS Launch Gate Drill Report",
  "Standard Envelope evidence validator: ready",
  "## Side-effect Guardrails",
  "### Forbidden Operations",
]);
assertFileIncludes("launch gate drill shipping evidence source", "src/lib/launch-gate-drill.ts", [
  "standardEnvelopeEvidenceContractReady: boolean",
  'purchaseAttemptAuditRunStatus: "passed" | "failed"',
  "purchaseAttemptAuditExpectedScenarioCount",
  "purchaseAttemptAuditKeyCoverageStatus",
  "purchaseAttemptAuditMissingScenarioKeys",
  "purchaseAttemptAuditUnexpectedScenarioKeys",
  "providerSetupActionPlan: ProviderSetupActionPlanStep[]",
  "buildShippingProviderSetupPacket",
  "shippingProviderSetup.actionPlan",
  "missing_scenario_keys",
  "unexpected_scenario_keys",
  "shippingReport.standardEnvelopeEvidenceContractReady",
  "shippingReport.purchaseAttemptAuditSimulation",
  "Standard Envelope evidence validator is",
]);
assertFileIncludes("launch gate drill shipping unlock plan page source", "src/app/admin/launch-gate-drill/page.tsx", [
  "ProviderSetupActionPlanStep",
  "report.shipping.providerSetupActionPlan",
  "Shipping Provider Unlock Action Plan",
  "/api/admin/shipping/provider-setup?format=env-template",
  "/api/admin/shipping/provider-setup?format=vercel-commands",
  "/api/admin/shipping/provider-setup?format=operator-checklist",
  "/admin/live-shipping-launch",
]);
assertFileIncludes("launch gate drill shipping unlock plan markdown source", "src/app/api/admin/launch-gate-drill/route.ts", [
  "providerUnlockActionPlanMarkdown",
  "## Shipping Provider Unlock Action Plan",
  "report.shipping.providerSetupActionPlan",
  "The drill is no-money and no-postage",
]);
assertFileIncludes("production smoke page contract", "scripts/smoke-production.mjs", [
  'name: "production smoke report page"',
  'path: "/admin/production-smoke"',
  "requiredText:",
  "Production Smoke Report",
  "Smoke coverage",
  "Admin login and dashboard render with Shipping Provider Unlock Action Plan",
  "Under-$20 Seller Protection launch handoff",
  "Launch Gate Drill page, JSON report, Markdown operator report, Shipping Provider Unlock Action Plan, and Standard Envelope evidence validator",
  "Launch readiness and handoff exports show missing/unexpected purchase-audit key drift",
  "Seller Protection Handoff Bundle",
  "Seller Protection Reconciliation",
  "Shipping Claims Cockpit",
  "Standard Envelope evidence validator",
  "Live Shipping Launch Gate with Shipping Provider Unlock Action Plan and Purchase-Audit Key Drift card",
  "Shipping Simulation Lab with nineteen policy/adapter scenarios plus five provider purchase-audit scenarios",
  "Shipping purchase-attempt audit simulations for live-gate, missing-setup, dry-run, and packet-output text",
  "Shipping simulation API POST with scenario count, manifest, and drift-field checks",
  "Shipping provider setup JSON and export packets with Standard Envelope evidence readiness",
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
  "Protected deploy sequence",
  "deployed URL output",
  "clean URL output",
  "npm run launch:production",
]);
assertFileIncludes(
  "seller protection launch contract shared source",
  "src/lib/seller-protection-launch-contract.ts",
  [
    "SELLER_PROTECTION_SMOKE_COVERAGE_LINE",
    "buildSellerProtectionLaunchContract",
    "sellerProtectionLaunchMarkdownLines",
    "TCOS Under-$20 Seller Protection",
    "Optional TCOS internal Standard Envelope seller protection; it is not third-party insurance.",
    "2% of the protected sale withheld from the seller payout row",
    "$20.00 protected item amount cap",
    "Protected item sale amount only; shipping is excluded and is not reimbursed.",
    "LetterTrack/USPS IMb evidence must not show delivered",
    "seller_protection_reimbursement",
    "financial_adjustment_ledger_entries",
    "20260712174000_add_seller_protection_financial_adjustments.sql",
    "/admin/launch-readiness#database-readiness",
    "/admin/financial-reconciliation",
    "/admin/shipping",
  ],
);
assertFileIncludes("launch handoff smoke contract", "scripts/smoke-production.mjs", [
  'name: "launch handoff bundle"',
  'path: "/api/admin/launch-readiness?format=handoff-bundle"',
  "requiredText:",
  "# TCOS Launch Hand-off Bundle",
  "## Git Tip Verification",
  "git fetch origin main",
  "git rev-parse --short HEAD",
  "git rev-parse --short origin/main",
  "git log -5 --oneline",
  "## Production Deploy Commands",
  "npm run verify:production",
  "npm run launch:production",
  "npm run deploy:production",
  "npm run smoke:production",
  "## Production Go/No-Go Ladder",
  "Verify the pushed stack",
  "Launch only when quota is open",
  "Halt on Vercel quota",
  "Ship only after smoke passes clean production",
  "## Shipping Provider Unlock Action Plan",
  "Choose provider accounts",
  "Stage Vercel environment names",
  "Keep shipping runtime locked",
  "production smoke POSTs `/api/admin/shipping/simulations`",
  "five expected purchase-audit scenarios",
  "no missing or unexpected scenario keys",
  "no missing/unexpected purchase-audit keys",
]);
assertFileIncludes("live launch gate smoke contract", "scripts/smoke-production.mjs", [
  'name: "live payment gate"',
  'path: "/admin/live-payment-launch"',
  "Live Payment Launch Gate",
  "Stripe Mode",
  "Approval version",
  "Approve Live Payments",
  "Payment Lab",
  'name: "live shipping gate"',
  'path: "/admin/live-shipping-launch"',
  "const pageText = visibleText(result.text)",
  "Live Shipping Launch Gate",
  "Provider secrets and live-adapter evidence",
  "Provider verdict",
  "Shipping Provider Unlock Action Plan",
  "Choose provider accounts",
  "Stage Vercel environment names",
  "Keep shipping runtime locked",
  "Operator Checklist",
  "Standard Envelope Evidence + Under-$20 Protection Contract",
  "LetterTrack / USPS IMb is delivery evidence, not insurance",
  "Runtime gate validator: ready",
  "Provider Purchase-Attempt Audit Suite",
  "Purchase-Audit Key Drift",
  "Missing Purchase Audit Keys",
  "Unexpected Purchase Audit Keys",
  "Not insurance: LetterTrack / USPS IMb is delivery-evidence tracking",
  "Immutable Shipping Approval History",
  "Shipping Lab",
  'name: "live shipping gate json"',
  'path: "/api/admin/live-shipping-launch"',
  '"standardEnvelopeEvidenceContract"',
  '"standardEnvelopeEvidenceContractReady":true',
  '"purchaseAttemptAuditSimulation"',
  '"expected_scenario_count":5',
  '"scenario_key_coverage_status":"passed"',
  '"missing_scenario_keys":[]',
  '"unexpected_scenario_keys":[]',
  '"evidenceProvider":"LetterTrack / USPS IMb"',
  '"trackableRequirement"',
  '"under20ProtectionModel"',
  '"sellerOptInRule"',
  '"reserveRate":"2%"',
  '"itemReimbursementCap":"$20.00"',
  '"reimbursesShipping":"no"',
  '"notInsuranceNotice"',
  '"standard_envelope_evidence_contract"',
  '"Standard Envelope Evidence Contract"',
]);
assertFileIncludes("live shipping evidence contract report source", "src/lib/live-shipping-launch.ts", [
  "isStandardEnvelopeEvidenceContractReady",
  "runShippingPurchaseAttemptAuditSimulationSuite",
  "StandardEnvelopeEvidenceContract",
  "standardEnvelopeEvidenceContract: StandardEnvelopeEvidenceContract",
  "standardEnvelopeEvidenceContractReady: boolean",
  "purchaseAttemptAuditSimulation",
  "Provider Purchase-Attempt Audit Suite",
  "provider_purchase_attempt_audit_simulations",
  "expected_scenario_count",
  "missing_scenario_keys",
  "unexpected_scenario_keys",
  "scenario_key_coverage_status",
  "standardEnvelopeEvidenceContractReady =",
  "standard_envelope_evidence_contract",
  "Standard Envelope Evidence Contract",
  "not third-party insurance",
  "Live shipping is blocked because the Standard Envelope evidence/protection contract is incomplete or unsafe.",
  "standardEnvelopeEvidenceContract,",
  "standardEnvelopeEvidenceContractReady,",
]);
assertFileIncludes("live shipping evidence contract page source", "src/app/admin/live-shipping-launch/page.tsx", [
  "ProviderSetupActionPlanStep",
  "providerSetupPacket.actionPlan",
  "Shipping Provider Unlock Action Plan",
  "ProviderUnlockActionPlan",
  "/api/admin/shipping/provider-setup?format=env-template",
  "/api/admin/shipping/provider-setup?format=vercel-commands",
  "/api/admin/shipping/provider-setup?format=operator-checklist",
  "evidenceContract",
  "evidenceContractReady",
  "Standard Envelope Evidence + Under-$20 Protection Contract",
  "is delivery evidence, not insurance",
  "Runtime gate validator:",
  "Seller opt-in",
  "Reserve / cap",
  "Reimburses shipping:",
  "Not insurance:",
]);
assertFileIncludes("shipping simulation API smoke contract", "scripts/smoke-production.mjs", [
  'name: "shipping simulation api"',
  'path: "/api/admin/shipping/simulations"',
  'options: { method: "POST" }',
  '"scenario_count":19',
  '"expected_scenario_count":19',
  '"scenario_key_coverage_status":"passed"',
  '"missing_scenario_keys":[]',
  '"unexpected_scenario_keys":[]',
  '"provider_setup_standard_envelope_evidence_contract"',
  '"under_20_seller_protection_caps_mixed_rows"',
  '"under_20_seller_protection_seller_order_visibility"',
  '"under_20_seller_protection_reimbursement_allocation"',
  '"under_20_seller_protection_buyer_refund_gate"',
  '"lettertrack_csv_seller_protection_contract"',
  '"purchase_audit"',
  '"expected_scenario_count":5',
  '"live_gate_blocker_evidence_ready"',
  '"provider_setup_blocker_evidence_blocked"',
  '"dry_run_purchase_attempt_audit_sentence"',
  '"packet_purchase_attempt_audit_lines"',
]);
assertFileIncludes("shipping simulation API purchase audit source", "src/app/api/admin/shipping/simulations/route.ts", [
  "runShippingPurchaseAttemptAuditSimulationSuite",
  "purchase_audit",
]);
assertFileIncludes("shipping simulation evidence contract validator", "src/lib/shipping-simulations.ts", [
  "isStandardEnvelopeEvidenceContractReady",
  "unsafeStandardEnvelopeEvidenceContract",
  "approved third-party insurance",
  "runtime_gate_contract_ready",
  "unsafe_contract_rejected",
  "shared live gate validator rejects unsafe contract drift",
]);
assertFileIncludes("admin shipping controls smoke contract", "scripts/smoke-production.mjs", [
  'name: "admin shipping lettertrack controls"',
  'path: "/admin/shipping"',
  "requiredText:",
  "missingRequiredText",
  "missingText",
  "Export LetterTrack CSV",
  "LetterTrack IMb Recording",
  "LetterTrack Delivery Evidence",
  "Seller Protection Refund Proof Missing",
  "Seller Protection Payout Blocked",
  "Shipping Provider Unlock Action Plan",
  "Choose provider accounts",
  "Stage Vercel environment names",
  "Keep shipping runtime locked",
]);
assertFileIncludes(
  "admin shipping seller protection static guardrail",
  "src/app/admin/shipping/page.tsx",
  [
    "Under-$20 Seller Protection Guardrails",
    "Seller Protection Refund Proof Missing",
    "Seller Protection Payout",
    "Approved under-$20 Standard",
    "LetterTrack/USPS",
    "seller-protection reimbursement",
  ],
);
assertFileIncludes("shipping simulation lab smoke contract", "scripts/smoke-production.mjs", [
  'name: "shipping simulation lab"',
  'path: "/admin/shipping/simulations"',
  "requiredText:",
  "Scenario Coverage",
  "Scenario Keys",
  "Scenario coverage guardrail",
  "19",
  "Mixed under-$20 claim rows cap reimbursement at $20",
  "Seller order views can show under-$20 protection status, 2% reserve, protected item cap, unprotected row liability, and shipping excluded from reimbursement",
  "Seller-protection Mark Paid allocation creates credits only for payable seller rows",
  "Under-$20 seller-protection Mark Paid requires a current or previously saved internal note confirming buyer refund evidence",
  "Under-$20 seller-protection payout blocks delivered LetterTrack evidence, allows not-delivered review evidence, and accepts a current or previously saved explicit override note",
  "LetterTrack CSV rows carry the under-$20 seller-protection contract",
  "Provider setup exports state that LetterTrack / USPS IMb supplies trackable delivery evidence",
  "Purchase Attempt Audit Coverage",
  "Missing Purchase Audit Keys",
  "Unexpected Purchase Audit Keys",
  "live_gate_blocker_evidence_ready",
  "provider_setup_blocker_evidence_blocked",
  "packet_purchase_attempt_audit_lines",
  "DRY RUN STANDARD ENVELOPE PURCHASE",
]);
assertFileIncludes("shipping simulation lab purchase audit source", "src/app/admin/shipping/simulations/page.tsx", [
  "runShippingPurchaseAttemptAuditSimulationSuite",
  "Purchase Attempt Audit Coverage",
  "Missing Purchase Audit Keys",
  "Unexpected Purchase Audit Keys",
  "purchaseAudit.missing_scenario_keys",
  "purchaseAudit.unexpected_scenario_keys",
  "Expected purchase audit scenario key manifest",
  "purchaseAudit.scenarios.map",
]);
assertFileIncludes("shipping provider setup smoke contract", "scripts/smoke-production.mjs", [
  'name: "shipping provider setup json"',
  'path: "/api/admin/shipping/provider-setup"',
  '"credentialGroups"',
  '"actionPlan"',
  '"Choose provider accounts"',
  '"Stage Vercel environment names"',
  '"Keep shipping runtime locked"',
  '"standardEnvelopeEvidenceContract"',
  '"standardEnvelopeEvidenceContractReady":true',
  '"evidenceProvider":"LetterTrack / USPS IMb"',
  '"trackableRequirement"',
  '"notInsuranceNotice"',
  '"exports"',
  '"csv"',
  '"envTemplate"',
  '"vercelCommands"',
  '"operatorChecklist"',
  '!result.text.includes("sk_live_")',
  '!result.text.includes("whsec_")',
  'name: "shipping provider setup csv"',
  'path: "/api/admin/shipping/provider-setup?format=csv"',
  "decisionStatus,decisionSummary,decisionNextAction",
  "setupActionPlan",
  "Choose provider accounts",
  "standardEnvelopeEvidenceProvider",
  "under20ProtectionNotInsurance",
  "standardEnvelopeEvidenceContractReady",
  "LetterTrack / USPS IMb",
  "not third-party insurance",
  "liveRequirementBlockers",
  "missingCredentialKeys",
  'name: "shipping provider env template"',
  'path: "/api/admin/shipping/provider-setup?format=env-template"',
  'result.contentType.includes("text/plain")',
  "Shipping provider unlock action plan",
  "Choose provider accounts",
  "Stage Vercel environment names",
  "Standard Envelope evidence/protection contract",
  "Runtime gate validator: ready",
  "Evidence provider: LetterTrack / USPS IMb",
  "TCOS Under-$20 Seller Protection is an optional internal seller program",
  "Not insurance: LetterTrack / USPS IMb is delivery-evidence tracking",
  "TCOS_SHIPPING_PURCHASE_MODE=dry_run",
  "TCOS_LIVE_SHIPPING_ENABLED=false",
  'name: "shipping provider vercel commands"',
  'path: "/api/admin/shipping/provider-setup?format=vercel-commands"',
  "Shipping provider unlock action plan",
  "Stage Vercel environment names",
  "# Production environment",
  "TCOS_LIVE_SHIPPING_ENABLED",
  'name: "shipping provider operator checklist"',
  'path: "/api/admin/shipping/provider-setup?format=operator-checklist"',
  'result.contentType.includes("text/markdown")',
  "## Shipping Provider Unlock Action Plan",
  "Choose provider accounts",
  "Stage Vercel environment names",
  "Keep shipping runtime locked",
  "## Standard Envelope Evidence + Under-$20 Protection Contract",
  "Runtime gate validator: ready",
  "Evidence provider: LetterTrack / USPS IMb",
  "TCOS Under-$20 Seller Protection is an optional internal seller program",
  "Not insurance: LetterTrack / USPS IMb is delivery-evidence tracking",
  "Keep TCOS_SHIPPING_PURCHASE_MODE=dry_run",
  "Keep TCOS_LIVE_SHIPPING_ENABLED=false",
]);

assertFileIncludes("shipping provider standard envelope evidence contract source", "src/lib/shipping-provider-setup.ts", [
  "StandardEnvelopeEvidenceContract",
  "ProviderSetupActionPlanStep",
  "providerSetupActionPlan",
  "Choose provider accounts",
  "Stage Vercel environment names",
  "Keep shipping runtime locked",
  "Prove live adapter evidence",
  "STANDARD_ENVELOPE_EVIDENCE_CONTRACT",
  "isStandardEnvelopeEvidenceContractReady",
  "LetterTrack / USPS IMb",
  "Provides trackable USPS IMb delivery evidence",
  "TCOS only needs provider evidence that can show delivered",
  "TCOS Under-$20 Seller Protection is an optional internal seller program",
  "Seller must opt in per shipment",
  'reserveRate: "2%"',
  'itemReimbursementCap: "$20.00"',
  'reimbursementBasis: "item_sale_amount_excluding_shipping"',
  'reimbursesShipping: "no"',
  "not third-party insurance",
  "standardEnvelopeEvidenceContractReady",
  "const standardEnvelopeEvidenceContract = STANDARD_ENVELOPE_EVIDENCE_CONTRACT",
  "standardEnvelopeEvidenceContract,",
  "standardEnvelopeEvidenceContractReady:",
]);

assertFileIncludes("shipping provider standard envelope evidence export route", "src/app/api/admin/shipping/provider-setup/route.ts", [
  "standardEnvelopeEvidenceContract",
  "actionPlan",
  "Shipping provider unlock action plan",
  "Shipping Provider Unlock Action Plan",
  "setupActionPlan",
  "standardEnvelopeEvidenceContractReady",
  "standardEnvelopeEvidenceProvider",
  "standardEnvelopeTrackableRequirement",
  "under20ProtectionModel",
  "under20ProtectionNotInsurance",
  "Standard Envelope evidence/protection contract",
  "Runtime gate validator:",
  "Operator Handoff",
  "Not insurance:",
]);
assertFileIncludes("shipping export smoke contract", "scripts/smoke-production.mjs", [
  'name: "shipping exceptions export"',
  'path: "/api/admin/shipping/exceptions"',
  'result.contentType.includes("text/csv")',
  "priority_rank,exception_key,severity",
  "exception_type",
  "action_needed",
  "claim_id",
  "dry_run_warning",
  'name: "lettertrack standard envelope export"',
  'path: "/api/admin/shipping/lettertrack-export"',
  "orderNumber,labelId,recipientName",
  "sellerProtectionReserveRate",
  "sellerProtectionReimbursesShipping",
  "deliveryEvidenceRequirement",
  'result.response?.headers.get("x-tcos-lettertrack-rows") !== null',
  'result.response?.headers.get("x-tcos-lettertrack-skipped") !== null',
  '!result.text.includes("sk_live_")',
  '!result.text.includes("whsec_")',
]);
assertFileIncludes("shipping blocked purchase evidence audit source", "src/app/api/admin/orders/[id]/shipping-labels/route.ts", [
  "buildShippingProviderSetupPacket",
  "standardEnvelopeEvidenceContractReady",
  "standard_envelope_evidence_contract_ready",
  "standard_envelope_evidence_provider",
  "latest_purchase_attempt",
  "provider_purchase_blocked",
]);
assertFileIncludes("shipping exceptions evidence audit export source", "src/app/api/admin/shipping/exceptions/route.ts", [
  "shippingPurchaseAttemptAuditSentence",
  "raw_payload",
]);
assertFileIncludes("shipping purchase attempt audit helper source", "src/lib/shipping-purchase-attempt-audit.ts", [
  "buildShippingPurchaseAttemptAudit",
  "shippingPurchaseAttemptAuditSentence",
  "shippingPurchaseAttemptAuditLines",
  "standard_envelope_evidence_contract_ready",
  "Standard Envelope evidence validator:",
  "attempted_by_identity",
]);
assertFileIncludes("shipping purchase attempt audit simulation source", "src/lib/shipping-purchase-attempt-audit-simulations.ts", [
  "live_gate_blocker_evidence_ready",
  "provider_setup_blocker_evidence_blocked",
  "dry_run_purchase_attempt_audit_sentence",
  "empty_purchase_attempt_audit_lines",
  "packet_purchase_attempt_audit_lines",
  "runShippingPurchaseAttemptAuditSimulationSuite",
]);
assertFileIncludes("shipping purchase attempt audit simulation runner", "scripts/run-shipping-purchase-audit-simulations.ts", [
  "runShippingPurchaseAttemptAuditSimulationSuite",
  "Shipping purchase audit simulations:",
  "shipping_purchase_audit_expected_scenario_count",
  "shipping_purchase_audit_expected_scenario_keys",
  "missing_scenario_keys",
  "unexpected_scenario_keys",
]);
assertFileIncludes("instacomp shared draft title contract", "src/lib/instacomp-draft-title.ts", [
  "buildInstaCompDraftTitle",
  "serialRunDisplayLabel",
  "ai?.isRookie ? \"Rookie\"",
  "serialRun",
]);
assertFileIncludes("instacomp server draft title contract", "src/app/api/instacomp/draft-listings/route.ts", [
  "buildInstaCompDraftTitle",
  "function titleFromAi",
  "return buildInstaCompDraftTitle(ai, fallback);",
]);
assertFileIncludes("instacomp scanner draft title callers", "src/app/admin/instacomp/InstaCompScanner.tsx", [
  "buildInstaCompDraftTitle",
  "return buildInstaCompDraftTitle(result.ai, fallback);",
]);
assertFileIncludes("instacomp test scanner draft title callers", "src/app/instacomp-test/InstaCompScanner.tsx", [
  "buildInstaCompDraftTitle",
  "return buildInstaCompDraftTitle(result.ai, fallback);",
]);
assertFileIncludes("instacomp accuracy draft title simulations", "scripts/run-instacomp-accuracy-simulations.mjs", [
  "buildInstaCompDraftTitle",
  "draft title uses print run instead of exact serial",
  "draft title preserves true one-of-one",
  "invalid serial is omitted from draft title",
]);
assertFileIncludes("shipping label packet purchase attempt audit source", "src/app/api/admin/shipping-labels/[id]/packet/route.ts", [
  "Provider Purchase Attempt Audit",
  "shippingPurchaseAttemptAuditLines",
  "latest_purchase_attempt",
  "provider_purchase_blocked",
]);
assertFileIncludes("admin shipping blocked attempt evidence audit source", "src/app/admin/shipping/page.tsx", [
  "buildShippingPurchaseAttemptAudit",
  "purchaseAttemptAudit.evidenceSummary",
  "purchaseAttemptAudit.standardEnvelopeEvidenceContractReady",
]);
assertFileIncludes("admin order label purchase attempt evidence audit source", "src/app/admin/orders/[id]/page.tsx", [
  "buildShippingPurchaseAttemptAudit",
  "Latest provider purchase attempt",
  "purchaseAttemptAudit.evidenceSummary",
  "purchaseAttemptAudit.standardEnvelopeEvidenceContractReady",
]);
assertFileIncludes("operator manual purchase audit simulation contract", "docs/TCOS_OPERATOR_MANUAL.md", [
  "Runs shipping eligibility, dry-run adapter, and provider purchase-attempt audit simulations",
  "five-scenario provider purchase-attempt audit pass evidence",
  "provider purchase-attempt audit suite status/count/key coverage",
  "missing/unexpected purchase-audit key lists",
  "Provider Purchase-Attempt Audit Suite check",
  "before `approvalReady` can become true",
  "Require all nineteen policy/adapter assertions plus the five provider purchase-attempt audit assertions",
]);
assertFileIncludes(
  "seller protection reimbursement packet contract",
  "src/app/api/admin/shipping-claims/[id]/packet/route.ts",
  [
    "Seller-Protection Reimbursement Allocation",
    "latest_seller_protection_reimbursement",
    "reimbursementPlan",
    "Inserted Credits",
    "Plan Requested Amount",
    "Allocation Count",
    "Skipped Rows",
    "shippingExcludedAmount",
    "Mark Paid creates or reuses TCOS internal seller-protection reimbursement credits",
  ],
);
assertFileIncludes(
  "seller protection reimbursement admin card contract",
  "src/app/admin/shipping/ShippingClaimActions.tsx",
  [
    "Seller-protection reimbursement allocation",
    "latest_seller_protection_reimbursement",
    "latest_seller_protection_buyer_refund_evidence",
    "Buyer refund proof readiness",
    "evaluateUnder20SellerProtectionBuyerRefundMetadataGate",
    "Checked from the typed note and current claim metadata before Mark Paid",
    "reimbursementPlan",
    "Inserted credits",
    "Requested plan",
    "Allocation rows",
    "Skipped rows",
    "shipping excluded",
    "Saved after Mark Paid created or reused TCOS internal seller-protection",
  ],
);
assertFileIncludes(
  "seller protection buyer refund gate route contract",
  "src/app/api/admin/shipping-claims/[id]/route.ts",
  [
    "evaluateUnder20SellerProtectionBuyerRefundMetadataGate",
    "latest_seller_protection_buyer_refund_evidence",
    "sellerProtectionBuyerRefundEvidence",
  ],
);
assertFileIncludes(
  "seller protection refund proof priority board contract",
  "src/app/admin/shipping/page.tsx",
  [
    "evaluateUnder20SellerProtectionBuyerRefundMetadataGate",
    "approvedSellerProtectionRefundProofBlockers",
    "seller_protection_refund_proof_missing",
    "Seller Protection Refund Proof Missing",
    "buyer/customer refund evidence or a refund reference documented before Mark Paid",
  ],
);
assertFileIncludes(
  "seller protection refund proof exceptions contract",
  "src/app/api/admin/shipping/exceptions/route.ts",
  [
    "evaluateUnder20SellerProtectionBuyerRefundMetadataGate",
    "seller_protection_refund_proof_missing",
    "Document buyer/customer refund evidence or a refund reference before Mark Paid",
    "refundGate.reason",
  ],
);
assertFileIncludes(
  "lettertrack saved override helper contract",
  "src/lib/lettertrack-delivery-evidence.ts",
  [
    "evaluateLetterTrackSellerProtectionPaymentMetadataGate",
    "latest_lettertrack_delivery_evidence_review",
    "latest_admin_status_change",
    "combinedOverrideNote",
    "overrideNote: combinedOverrideNote",
  ],
);
assertFileIncludes(
  "lettertrack saved override runtime callers",
  "src/app/api/admin/shipping-claims/[id]/route.ts",
  [
    "evaluateLetterTrackSellerProtectionPaymentMetadataGate",
    "metadata: params.claim.metadata",
    "overrideNote: params.overrideNote",
  ],
);
assertFileIncludes(
  "lettertrack saved override admin callers",
  "src/app/admin/shipping/page.tsx",
  [
    "evaluateLetterTrackSellerProtectionPaymentMetadataGate",
    "metadata: claim.metadata",
    "current/saved explicit override note before Mark Paid",
  ],
);
assertFileIncludes(
  "lettertrack saved override exception export callers",
  "src/app/api/admin/shipping/exceptions/route.ts",
  [
    "evaluateLetterTrackSellerProtectionPaymentMetadataGate",
    "metadata: claim.metadata",
    "current/saved explicit override note before Mark Paid",
  ],
);
assertFileIncludes(
  "lettertrack saved override order detail callers",
  "src/app/admin/orders/[id]/page.tsx",
  [
    "evaluateLetterTrackSellerProtectionPaymentMetadataGate",
    "metadata: claim.metadata",
  ],
);
assertFileIncludes(
  "lettertrack saved override packet caller",
  "src/app/api/admin/shipping-claims/[id]/packet/route.ts",
  [
    "evaluateLetterTrackSellerProtectionPaymentMetadataGate",
    "metadata: claim.metadata",
  ],
);
assertFileIncludes(
  "seller protection buyer refund helper contract",
  "src/lib/under20-seller-protection-claims.ts",
  [
    "evaluateUnder20SellerProtectionBuyerRefundGate",
    "evaluateUnder20SellerProtectionBuyerRefundMetadataGate",
    "latest_admin_status_change",
    "Before Mark Paid",
    "buyer/customer refund evidence",
    "Buyer refund evidence was confirmed",
  ],
);
assertFileIncludes(
  "seller protection seller order visibility helper contract",
  "src/lib/under20-seller-protection-claims.ts",
  [
    "buildUnder20SellerProtectionSellerVisibilitySummary",
    "protectedRowCount",
    "unprotectedRowCount",
    "This order has opted-in TCOS Under-$20 Seller Protection",
    "shipping and unprotected rows stay seller responsibility",
  ],
);
assertFileIncludes(
  "seller protection seller orders api visibility contract",
  "src/app/api/account/seller/orders/route.ts",
  [
    "buildUnder20SellerProtectionSellerVisibilitySummary",
    "gross_item_amount,shipping_allocated_amount",
    "metadata",
    "sellerProtection: sellerProtectionSummary",
  ],
);
assertFileIncludes(
  "seller protection seller order detail api visibility contract",
  "src/app/api/account/seller/orders/[id]/route.ts",
  [
    "buildUnder20SellerProtectionSellerVisibilitySummary",
    "gross_item_amount,shipping_allocated_amount",
    "metadata",
    "sellerProtection: sellerProtectionSummary",
  ],
);
assertFileIncludes(
  "seller protection seller order UI visibility contract",
  "src/app/seller/orders/page.tsx",
  [
    "Under-$20 Seller Protection",
    "2% reserve / $20 max",
    "Shipping Excluded",
    "SellerProtectionCard",
  ],
);
assertFileIncludes(
  "seller inventory marketplace export seller protection contract",
  "src/app/seller/inventory/page.tsx",
  [
    "marketplaceExportSellerProtectionWarning",
    "not insurance",
    "delivery evidence does not show delivered",
    "shipping is excluded",
    "Confirm any TCOS Under-$20 Seller Protection opt-in before fulfillment",
    "standardEnvelopeDeliveryEvidenceRequirement",
    "delivered evidence blocks TCOS under-$20 seller-protection reimbursement",
    "under20SellerProtectionProvider",
    "under20SellerProtectionRate",
    "under20SellerProtectionMaxCoverage",
    "under20SellerProtectionCoverageBasis",
    "under20SellerProtectionClaimRule",
    "under20SellerProtectionRefundRule",
    "under20SellerProtectionReimbursesShipping",
    "under20SellerProtectionLegalLabel",
    "under20SellerProtectionWarning",
    "sellerProtectionWarning",
    "Not insurance: LetterTrack/USPS IMb is delivery evidence",
  ],
);
assertFileIncludes(
  "seller inventory API seller protection export contract",
  "src/app/api/account/seller/inventory/route.ts",
  [
    "sellerProtectionProvider",
    "sellerProtectionRate",
    "sellerProtectionMaxCoverage",
    "sellerProtectionCoverageBasis",
    "sellerProtectionRefundRule",
    "sellerProtectionReimbursesShipping",
    "sellerProtectionLegalLabel",
    "sellerProtection.provider",
    "sellerProtection.rate",
    "sellerProtection.maxCoverage",
    "sellerProtection.coverageBasis",
    "sellerProtection.sellerRefundRule",
    "sellerProtection.reimbursesShipping",
    "sellerProtection.legalLabel",
  ],
);
assertFileIncludes(
  "seller protection seller order detail UI visibility contract",
  "src/app/seller/orders/[id]/page.tsx",
  [
    "Under-$20 Seller Protection",
    "2% reserve / $20 max / shipping excluded",
    "sellerProtectionTone",
    "SellerProtectionCard",
  ],
);
assertFileIncludes(
  "seller protection seller payout api visibility contract",
  "src/app/api/account/seller/payout-requests/route.ts",
  [
    "buildUnder20SellerProtectionSellerVisibilitySummary",
    "gross_item_amount,shipping_allocated_amount",
    "metadata",
    "sellerProtection: balance.sellerProtection",
    "sellerProtection: buildUnder20SellerProtectionSellerVisibilitySummary",
  ],
);
assertFileIncludes(
  "seller protection seller payout UI visibility contract",
  "src/app/seller/payouts/page.tsx",
  [
    "Under-$20 Protection Reserve",
    "Request Protection Snapshot",
    "2% reserve / $20 max / shipping excluded",
    "SellerProtectionCard",
    "sellerProtectionTone",
  ],
);
assertFileIncludes(
  "seller protection account cash-out UI visibility contract",
  "src/app/account/page.tsx",
  [
    "Under-$20 Protection Reserve",
    "Request Protection Snapshot",
    "2% reserve / $20 max / shipping excluded",
    "SellerProtectionCard",
    "sellerProtectionTone",
  ],
);
assertFileIncludes(
  "seller protection command center UI visibility contract",
  "src/app/seller/page.tsx",
  [
    "Protection Reserve",
    "Under-$20 Protection Reserve",
    "2% reserve / $20 max / shipping excluded",
    "SellerProtectionCard",
    "sellerProtectionTone",
  ],
);
assertFileIncludes(
  "seller protection admin payout UI visibility contract",
  "src/app/admin/seller-payouts/page.tsx",
  [
    "Admin Under-$20 Protection Reserve",
    "Protection Reserve",
    "Under-$20 Protection",
    "2% reserve / $20 max / shipping excluded",
    "under20ProtectionFromMetadata",
    "SellerProtectionMiniCard",
    "sellerProtectionTone",
  ],
);
assertFileIncludes(
  "seller protection financial reconciliation visibility contract",
  "src/app/admin/financial-reconciliation/page.tsx",
  [
    "Seller-Protection Reimbursement Adjustments",
    "TCOS Internal Money Context",
    "Latest Run Reimbursed",
    "Latest Run Excluded",
    "tcos_seller_protection_reimbursements",
    "seller_protection_reimbursement",
    "Shipping Excluded",
    "Review Payouts",
    "financial_adjustment_ledger_entries",
  ],
);
assertFileIncludes(
  "seller protection reconciliation summary contract",
  "src/lib/stripe-reconciliation.ts",
  [
    "financial_adjustment_ledger_entries",
    "seller_protection_reimbursement",
    "tcos_seller_protection_reimbursements",
    "tcos_seller_protection_shipping_excluded",
    "tcos_seller_protection_adjustment_count",
    "tcos_seller_protection_allocation_count",
  ],
);
assertFileIncludes(
  "seller protection launch readiness database contract",
  "src/app/admin/launch-readiness/page.tsx",
  [
    "Seller Protection Financial Adjustments",
    "20260712174000_add_seller_protection_financial_adjustments.sql",
    "seller_protection_reimbursement",
    "reimbursement-plan metadata",
    "financial_adjustment_ledger_entries",
  ],
);
assertFileIncludes(
  "seller protection launch readiness brief contract",
  "src/app/api/admin/launch-readiness/route.ts",
  [
    "buildSellerProtectionLaunchContract",
    "sellerProtectionLaunchMarkdownLines",
    "...sellerProtectionLaunchMarkdownLines(brief.sellerProtection)",
    "sellerProtection: buildSellerProtectionLaunchContract(origin)",
  ],
);
assertFileIncludes(
  "seller protection buyer refund packet contract",
  "src/app/api/admin/shipping-claims/[id]/packet/route.ts",
  [
    "Seller-Protection Buyer Refund Evidence Gate",
    "latest_seller_protection_buyer_refund_evidence",
    "Refund Proof Accepted",
    "Review Note",
  ],
);
assertFileIncludes("queued-feature smoke manifest", "scripts/smoke-production.mjs", [
  "const queuedFeatureCheckNames = [",
  "Queued feature smoke manifest references unknown check(s):",
  "Queued feature smoke manifest contains duplicate check(s):",
  '"admin dashboard"',
  '"launch handoff bundle"',
  '"launch readiness page"',
  '"launch readiness json"',
  '"launch readiness markdown"',
  '"launch gate drill page"',
  '"launch gate drill json"',
  '"launch gate drill markdown"',
  '"production smoke report page"',
  '"live payment gate"',
  '"live shipping gate"',
  '"live shipping gate json"',
  '"admin shipping lettertrack controls"',
  '"shipping simulation lab"',
  '"shipping simulation api"',
  '"shipping provider setup json"',
  '"shipping provider setup csv"',
  '"shipping provider env template"',
  '"shipping provider vercel commands"',
  '"shipping provider operator checklist"',
  '"shipping exceptions export"',
  '"lettertrack standard envelope export"',
  "Queued launch feature failure(s):",
]);
assertFileIncludes("smoke unwanted alias label", "scripts/smoke-production.mjs", [
  "unwanted ${new URL(unwantedAliasUrl).hostname} alias absent",
  "SMOKE_UNWANTED_ALIAS_URL",
  "truely-collectables-tt3b.vercel.app",
]);
runExpectedSuccess(
  "smoke diagnostic redaction self-test",
  ["scripts/smoke-production.mjs", "--self-test-redaction"],
  {
    ADMIN_PASSWORD: "",
    SMOKE_ADMIN_PASSWORD: "",
    SMOKE_BASE_URL: "https://truely-collectables.vercel.app",
  },
);
runExpectedSuccess("deploy diagnostic redaction self-test", [
  "scripts/deploy-production.mjs",
  "--self-test-redaction",
]);
assertFileIncludes("production guardrail diagnostic redaction coverage", "scripts/check-production-guardrails.mjs", [
  "function redactSecrets(text)",
  "function diagnosticOutput(text)",
  "function runGuardrailRedactionSelfTest()",
  "Production guardrail redaction self-test leaked marker(s)",
  "PASS production guardrail redaction self-test",
  "rk_live_fakeRestricted123456789",
  "Basic QWxhZGRpbjpvcGVuIHNlc2FtZTEyMzQ1Ng==",
  "client_secret=clientSecret123456789",
  "api_key=apiKey123456789",
  '"password":"password123456789"',
  "diagnosticOutput(output)",
]);
assertFileIncludes("smoke diagnostic redaction coverage", "scripts/smoke-production.mjs", [
  "rk_live_fakeRestricted123456789",
  "Basic QWxhZGRpbjpvcGVuIHNlc2FtZTEyMzQ1Ng==",
  "client_secret=clientSecret123456789",
  "api_key=apiKey123456789",
  '"password":"password123456789"',
  "rk_live_",
  "Basic ",
  "clientSecret123456789",
  "apiKey123456789",
  "password123456789",
]);
assertFileIncludes("deploy diagnostic redaction coverage", "scripts/deploy-production.mjs", [
  "function redactSecrets(text)",
  "function diagnosticSnippet(text)",
  "Production deploy redaction self-test passed.",
  "rk_live_fakeRestricted123456789",
  "Basic QWxhZGRpbjpvcGVuIHNlc2FtZTEyMzQ1Ng==",
  "client_secret=clientSecret123456789",
  "api_key=apiKey123456789",
  '"password":"password123456789"',
  "redactSecrets(output)",
  "diagnosticSnippet(output)",
  "diagnosticSnippet(deployOutput)",
]);

runExpectedFailure(
  "deploy refuses clean domain matching unwanted alias",
  ["scripts/deploy-production.mjs", "--preflight-only"],
  {
    VERCEL_CLEAN_DOMAIN: "https://truely-collectables-tt3b.vercel.app/",
    VERCEL_UNWANTED_ALIAS: "truely-collectables-tt3b.vercel.app",
  },
  "Refusing production deploy because VERCEL_CLEAN_DOMAIN matches the unwanted alias",
);

assertFileIncludes("deploy preflight env flag", "scripts/deploy-production.mjs", [
  "process.env.TCOS_PRODUCTION_PREFLIGHT_ONLY",
  "Production deploy preflight passed. No Vercel deployment was started.",
]);

assertFileIncludes("deploy git preflight diagnostics", "scripts/deploy-production.mjs", [
  "Refreshing origin/main before deploy",
  "working tree has deploy-relevant local changes",
  "Production deploy requires a clean committed worktree",
  "Could not resolve local HEAD and origin/main after fetch",
  "Local HEAD does not match origin/main",
  "Run git push before deploying",
]);

assertFileIncludes("deploy live safety contract", "scripts/deploy-production.mjs", [
  "api-deployments-free-per-day",
  "Wait for the rolling 24-hour quota to reset",
  "Removing unwanted ${unwantedAlias} alias if present",
  '"alias", "rm", unwantedAlias',
  '"alias", "set", deploymentUrl, cleanDomain',
  "DEPLOYED_PRODUCTION=",
  "CLEAN_PRODUCTION=https://",
  "npm run smoke:production",
]);

assertFileIncludes("deploy helper production target defaults", "scripts/deploy-production.mjs", [
  '"truely-collectables.vercel.app"',
  '"truely-collectables-tt3b.vercel.app"',
  "VERCEL_CLEAN_DOMAIN",
  "VERCEL_UNWANTED_ALIAS",
]);

assertFileIncludes("deploy helper quota block defaults", "scripts/deploy-production.mjs", [
  "deployOutput.includes(\"api-deployments-free-per-day\")",
  "Vercel deployment quota is still capped",
  "Wait for the rolling 24-hour quota to reset",
  "rerun npm run launch:production",
]);

assertFileIncludes("deploy helper parse diagnostics", "scripts/deploy-production.mjs", [
  "clean production domain (${cleanDomain})",
  "unwanted alias (${unwantedAlias})",
  "If quota is capped, wait and retry",
]);

assertFileIncludes("deploy helper smoke handoff", "scripts/deploy-production.mjs", [
  "DEPLOYED_PRODUCTION=",
  "CLEAN_PRODUCTION=https://",
  'console.log("Next verification command if you ran deploy without the one-shot launch:");',
  'console.log("npm run smoke:production");',
]);

assertFileOrder("deploy live safety sequence", "scripts/deploy-production.mjs", [
  "Removing unwanted ${unwantedAlias} alias if present",
  '"alias", "rm", unwantedAlias',
  "Pointing https://${cleanDomain} at ${deploymentUrl}",
  '"alias", "set", deploymentUrl, cleanDomain',
  "DEPLOYED_PRODUCTION=",
  "CLEAN_PRODUCTION=https://",
  "Next verification command if you ran deploy without the one-shot launch:",
  "npm run smoke:production",
]);

assertFileIncludes("deploy live safety centralized source", "src/lib/deploy-safety.ts", [
  "const DEPLOY_SAFETY_SMOKE_COMMAND",
  "const DEPLOY_SAFETY = {",
  "function deploySafetyContractMarkdown()",
  "function deploySafetySequenceMarkdown()",
  "function deploySafetyDecisionLadderMarkdown()",
  "sequence: [",
  "decisionLadder: [",
  "Verify the pushed stack",
  "Launch only when quota is open",
  "Halt on Vercel quota",
  "Ship only after smoke passes clean production",
  "smokeCommand: DEPLOY_SAFETY_SMOKE_COMMAND",
]);

assertFileIncludes("deploy live safety site origin source", "src/lib/site-origin.ts", [
  'import { DEPLOY_SAFETY } from "./deploy-safety"',
  "DEPLOY_SAFETY.cleanProductionDomain",
  "NEXT_PUBLIC_SITE_URL",
  "SITE_URL",
]);

assertFileIncludes(
  "live payment webhook smoke shared origin",
  "src/app/api/admin/live-payment-launch/webhook-smoke/route.ts",
  [
    "configuredSiteOrigin",
    "const origin = configuredSiteOrigin()",
    "const endpointUrl = `${origin}/api/webhook`",
  ],
);

assertFileIncludes("deploy live safety launch readiness route source", "src/app/api/admin/launch-readiness/route.ts", [
  "DEPLOY_SAFETY",
  "deploySafetyContractMarkdown",
  "deploySafetyDecisionLadderMarkdown",
  "deploySafetySequenceMarkdown",
  "function buildDeploymentSource",
  "function deploymentSourceMarkdownLines",
  "VERCEL_GIT_COMMIT_SHA",
  "VERCEL_GIT_COMMIT_REF",
  "VERCEL_GIT_REPO_OWNER",
  "VERCEL_GIT_REPO_SLUG",
  "VERCEL_URL",
  "Compare this Git commit SHA with origin/main",
  "function deploySafetyMarkdownLines()",
  "...deploySafetyMarkdownLines()",
  "...deploymentSourceMarkdownLines(brief.deployment)",
  "deploySafetyContractMarkdown()} intact.",
  "## Production Go/No-Go Ladder",
  "deploySafetyDecisionLadderMarkdown()",
  "deployment: buildDeploymentSource(origin)",
  "deploySafety: DEPLOY_SAFETY",
]);

assertFileIncludes(
  "deploy safety export production target defaults",
  "src/lib/deploy-safety.ts",
  [
    'cleanProductionDomain: "https://truely-collectables.vercel.app"',
    'unwantedAlias: "truely-collectables-tt3b.vercel.app"',
  ],
);

assertFileIncludes(
  "deploy safety export smoke handoff",
  "src/lib/deploy-safety.ts",
  [
    'const DEPLOY_SAFETY_SMOKE_COMMAND = "npm run smoke:production"',
    "smokeCommand: DEPLOY_SAFETY_SMOKE_COMMAND",
    "${DEPLOY_SAFETY_SMOKE_COMMAND} handoff",
    "DEPLOY_SAFETY.smokeCommand",
  ],
);

assertFileIncludes(
  "deploy safety export quota block defaults",
  "src/lib/deploy-safety.ts",
  [
    'quotaBlockCode: "api-deployments-free-per-day"',
    "quotaResetInstruction:",
    "Wait for the rolling 24-hour quota reset before retrying npm run launch:production.",
  ],
);

assertFileIncludes("deploy live safety handoff bundle", "src/app/api/admin/launch-readiness/route.ts", [
  "deploy live safety contract",
  "Deployment Source",
  "Git commit SHA:",
  "Smoke comparison:",
  "DEPLOY_SAFETY.quotaBlockCode",
  "DEPLOY_SAFETY.quotaResetInstruction",
  "DEPLOY_SAFETY.cleanProductionDomain",
  "DEPLOY_SAFETY.unwantedAlias",
  "DEPLOY_SAFETY.smokeCommand",
  "standardEnvelopeEvidenceContractReady",
  "providerSetupActionPlan",
  "Shipping Provider Unlock Action Plan",
  "Standard Envelope evidence validator:",
  "InstaComp regressions",
  "LetterTrack evidence checks",
  "shipping purchase-attempt audit simulations",
  "nineteen-scenario shipping simulation suite",
  "deploySafetyContractMarkdown()",
  "Protected deploy sequence:",
  "deploySafetySequenceMarkdown()",
]);

assertFileIncludes("deploy live safety launch readiness markdown", "src/app/api/admin/launch-readiness/route.ts", [
  "DEPLOY_SAFETY.section",
  "deploy live safety contract",
  "Deployment Source",
  "Git commit SHA:",
  "Smoke comparison:",
  "DEPLOY_SAFETY.quotaBlockCode",
  "DEPLOY_SAFETY.quotaResetInstruction",
  "DEPLOY_SAFETY.cleanProductionDomain",
  "DEPLOY_SAFETY.unwantedAlias",
  "standardEnvelopeEvidenceContractReady",
  "Standard Envelope evidence validator:",
  "InstaComp regressions",
  "LetterTrack evidence checks",
  "shipping purchase-attempt audit simulations",
  "nineteen-scenario shipping simulation suite",
  "deploySafetyContractMarkdown()",
  "Protected deploy sequence:",
  "deploySafetySequenceMarkdown()",
]);

assertFileIncludes("deploy live safety shared text source", "src/lib/deploy-safety.ts", [
  "api-deployments-free-per-day",
  "rolling 24-hour quota reset",
  "Vercel quota messaging",
  "unwanted alias removal for truely-collectables-tt3b.vercel.app",
  "clean-domain aliasing",
  "deployed URL output",
  "clean URL output",
  "npm run smoke:production",
]);

assertFileIncludes("deploy live safety launch readiness json", "src/app/api/admin/launch-readiness/route.ts", [
  "deploySafety",
  "deploySafety: DEPLOY_SAFETY",
]);

assertFileIncludes("deploy live safety launch readiness json source", "src/lib/deploy-safety.ts", [
  "Production Deploy Safety",
  "quotaBlockCode",
  "api-deployments-free-per-day",
  "quotaResetInstruction",
  "rolling 24-hour quota reset",
  "cleanProductionDomain",
  "unwantedAlias",
  "deployed URL output",
  "clean URL output",
  "sequence: [",
  "remove unwanted truely-collectables-tt3b.vercel.app alias",
  "set clean production alias",
  "print DEPLOYED_PRODUCTION",
  "print CLEAN_PRODUCTION",
  "print smoke handoff command",
  "${DEPLOY_SAFETY_SMOKE_COMMAND} handoff",
]);

assertFileIncludes("deploy live safety production smoke page", "src/app/admin/production-smoke/page.tsx", [
  "Deploy live safety contract",
  "Production go/no-go ladder",
  "DEPLOY_SAFETY.decisionLadder",
  "DEPLOY_SAFETY.quotaBlockCode",
  "DEPLOY_SAFETY.cleanProductionDomain",
  "DEPLOY_SAFETY.unwantedAlias",
  "${DEPLOY_SAFETY.unwantedAlias} alias cleanup",
  "DEPLOY_SAFETY.smokeCommand",
  "DEPLOY_SAFETY.quotaResetInstruction",
  "unwanted alias removal for",
  "clean-domain aliasing",
  "Protected deploy sequence",
  "DEPLOY_SAFETY.sequence",
  "/api/admin/shipping/provider-setup",
  "/api/admin/shipping/provider-setup?format=csv",
  "/api/admin/shipping/provider-setup?format=env-template",
  "/api/admin/shipping/provider-setup?format=vercel-commands",
  "/api/admin/shipping/provider-setup?format=operator-checklist",
  "deployed URL output",
  "clean URL output",
]);

assertFileIncludes("deploy live safety launch readiness page", "src/app/admin/launch-readiness/page.tsx", [
  "DEPLOY_SAFETY.quotaBlockCode",
  "DEPLOY_SAFETY.cleanProductionDomain",
  "DEPLOY_SAFETY.unwantedAlias",
  "DEPLOY_SAFETY.smokeCommand",
  "DEPLOY_SAFETY.quotaResetInstruction",
  "deploy live safety",
  "contract keeps",
  "Vercel quota",
  "Standard Envelope evidence validator is",
  "InstaComp regressions",
  "LetterTrack evidence checks",
  "shipping purchase-attempt audit simulations",
  "nineteen-scenario shipping simulation suite",
  "unwanted alias removal for",
  "clean-domain aliasing",
  "Protected deploy sequence",
  "DEPLOY_SAFETY.sequence",
  "deployed URL output",
  "clean URL output",
  "ProviderSetupActionPlanStep",
  "Shipping Provider Unlock Action Plan",
  "actionPlan.map",
  "/api/admin/shipping/provider-setup?format=env-template",
  "/api/admin/shipping/provider-setup?format=vercel-commands",
  "/api/admin/shipping/provider-setup?format=operator-checklist",
]);

assertFileIncludes("deploy live safety runbook", "docs/PRODUCTION_DEPLOY_RUNBOOK.md", [
  "live deploy safety contract",
  "/api/admin/launch-readiness",
  "brief.deploySafety",
  "brief.deploySafety` with the clean production domain, unwanted `truely-collectables-tt3b.vercel.app` alias",
  "brief.deploySafety.sequence",
  "/api/admin/launch-readiness?format=markdown",
  "Production Deploy Safety",
  "Production go/no-go ladder",
  "Verify the pushed stack",
  "Launch only when quota is open",
  "Halt on Vercel quota",
  "Ship only after smoke passes",
  "LetterTrack evidence checks",
  "shipping purchase-attempt audit simulations",
  "nineteen-scenario shipping simulation suite",
  "five expected purchase-audit scenarios",
  "shipping simulation API POST including purchase-audit coverage",
  "Vercel quota messaging",
  "unwanted `truely-collectables-tt3b.vercel.app` alias",
  "clean-domain aliasing",
  "post-deploy smoke handoff",
  "protected live deploy sequence",
  "remove the unwanted `truely-collectables-tt3b.vercel.app` alias",
  "set the clean production alias",
  "DEPLOYED_PRODUCTION=",
  "CLEAN_PRODUCTION=https://",
  "api-deployments-free-per-day",
  "rolling 24-hour reset",
  "smoke/deploy/guardrail diagnostic redaction self-tests",
  "admin dashboard, launch readiness page/JSON/Markdown, Launch Gate Drill page/JSON/Markdown",
  "live payment gate, live shipping gate, admin shipping LetterTrack controls",
]);

assertFileIncludes("deploy live safety README", "README.md", [
  "deploy live safety contract",
  "/api/admin/launch-readiness",
  "brief.deploySafety",
  "brief.deploySafety.sequence",
  "/api/admin/launch-readiness?format=markdown",
  "/api/admin/launch-readiness?format=handoff-bundle",
  "Production Deploy Safety",
  "production go/no-go ladder",
  "verify the pushed stack",
  "launch only when quota is open",
  "halt if Vercel reports `api-deployments-free-per-day`",
  "ship only after smoke passes the clean production domain",
  "LetterTrack evidence checks",
  "shipping purchase-attempt audit simulations",
  "nineteen-scenario shipping simulation suite",
  "visible missing/unexpected purchase-audit key drift checks",
  "Vercel quota messaging",
  "unwanted `truely-collectables-tt3b.vercel.app` alias",
  "deployed and clean URLs",
  "protected live deploy sequence",
  "removes the unwanted `truely-collectables-tt3b.vercel.app` alias",
  "sets the clean production alias",
  "DEPLOYED_PRODUCTION=",
  "CLEAN_PRODUCTION=https://",
  "npm run smoke:production",
  "api-deployments-free-per-day",
  "rolling 24-hour quota reset",
  "Production smoke and deploy/guardrail diagnostics redact secret-shaped Stripe",
  "auth-header, token, API-key, password, and JWT values",
]);

assertFileIncludes("deploy live safety operator manual", "docs/TCOS_OPERATOR_MANUAL.md", [
  "live deploy safety contract",
  "/admin/production-smoke",
  "deploy-live safety contract",
  "brief.deploySafety",
  "brief.deploySafety.sequence",
  "/api/admin/launch-readiness?format=markdown",
  "Production Deploy Safety",
  "Production Go/No-Go Ladder",
  "verify the pushed stack",
  "launch only when quota is open",
  "halt if Vercel reports",
  "ship only after smoke passes the clean production domain",
  "Vercel quota messaging",
  "unwanted `truely-collectables-tt3b.vercel.app` alias removal",
  "clean production aliasing",
  "deployed URL output",
  "clean URL output",
  "protected live deploy sequence",
  "removes the unwanted `truely-collectables-tt3b.vercel.app` alias",
  "sets the clean production alias",
  "DEPLOYED_PRODUCTION=",
  "CLEAN_PRODUCTION=https://",
  "npm run smoke:production",
  "smoke/deploy/guardrail diagnostic redaction self-tests",
  "launch readiness, Launch Gate Drill, production smoke, live payment/shipping gates",
  "admin dashboard, launch readiness page/JSON/Markdown, Launch Gate Drill page/JSON/Markdown",
  "live payment gate, live shipping gate, admin shipping LetterTrack controls",
]);

assertFileIncludes(
  "deploy live safety printable operator manual",
  "docs/TCOS_OPERATOR_MANUAL_PRINT.html",
  [
    "live deploy safety contract",
    "/admin/production-smoke",
    "deploy-live safety contract",
    "brief.deploySafety",
    "brief.deploySafety.sequence",
    "/api/admin/launch-readiness?format=markdown",
    "Production Deploy Safety",
    "Production Go/No-Go Ladder",
    "verify the pushed stack",
    "launch only when quota is open",
    "halt if Vercel reports",
    "ship only after smoke passes the clean production domain",
    "Vercel quota messaging",
    "unwanted <code>truely-collectables-tt3b.vercel.app</code> alias removal",
    "clean production aliasing",
    "deployed URL output",
    "clean URL output",
    "protected live deploy sequence",
    "removes the unwanted <code>truely-collectables-tt3b.vercel.app</code> alias",
    "sets the clean production alias",
    "DEPLOYED_PRODUCTION=",
    "CLEAN_PRODUCTION=https://",
    "npm run smoke:production",
  ],
);

runExpectedFailure(
  "smoke refuses unwanted alias before admin auth",
  ["scripts/smoke-production.mjs"],
  {
    ADMIN_PASSWORD: "",
    SMOKE_ADMIN_PASSWORD: "",
    SMOKE_BASE_URL: "TRUELY-COLLECTABLES-TT3B.vercel.app/smoke-path",
    SMOKE_UNWANTED_ALIAS_URL: "https://truely-collectables-tt3b.vercel.app/",
  },
  "Refusing to smoke test the unwanted production alias",
);

console.log("Production guardrail checks passed.");
