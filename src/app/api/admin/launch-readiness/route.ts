import { NextResponse } from "next/server";
import { getDryRunShippingCleanupSummary } from "../../../../lib/shipping-dry-run-cleanup";
import { buildShippingProviderSetupPacket } from "../../../../lib/shipping-provider-setup";
import { evaluateLivePaymentLaunch } from "../../../../lib/live-payment-launch";
import { evaluateLiveShippingLaunch } from "../../../../lib/live-shipping-launch";
import { runLaunchGateDrill } from "../../../../lib/launch-gate-drill";
import { getActiveStoreId } from "../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";
import {
  DEPLOY_SAFETY,
  deploySafetyContractMarkdown,
  deploySafetyDecisionLadderMarkdown,
  deploySafetySequenceMarkdown,
} from "../../../../lib/deploy-safety";
import {
  buildSellerProtectionLaunchContract,
  sellerProtectionLaunchMarkdownLines,
} from "../../../../lib/seller-protection-launch-contract";
import {
  buildSellerMarketplaceReceiptHandoffContract,
  sellerMarketplaceReceiptHandoffMarkdownLines,
} from "../../../../lib/seller-marketplace-receipt-handoff";

export const dynamic = "force-dynamic";

type BriefItem = {
  label: string;
  status: "ready" | "review" | "blocked";
  detail: string;
  action: string;
  href?: string;
  url?: string;
};

const SHIPPING_PROVIDER_ENV_TEMPLATE_HREF =
  "/api/admin/shipping/provider-setup?format=env-template";
const SHIPPING_PROVIDER_VERCEL_COMMANDS_HREF =
  "/api/admin/shipping/provider-setup?format=vercel-commands";
const SHIPPING_PROVIDER_OPERATOR_CHECKLIST_HREF =
  "/api/admin/shipping/provider-setup?format=operator-checklist";

function statusFromCheck(status: "passed" | "warning" | "blocked") {
  if (status === "passed") return "ready" as const;
  if (status === "warning") return "review" as const;
  return "blocked" as const;
}

function summarize(items: BriefItem[]) {
  return {
    ready: items.filter((item) => item.status === "ready").length,
    review: items.filter((item) => item.status === "review").length,
    blocked: items.filter((item) => item.status === "blocked").length,
  };
}

function sortAttentionItems(items: BriefItem[]) {
  const rank: Record<BriefItem["status"], number> = {
    blocked: 0,
    review: 1,
    ready: 2,
  };

  return items
    .filter((item) => item.status !== "ready")
    .sort((a, b) => rank[a.status] - rank[b.status]);
}

function hrefForBriefItem(item: BriefItem) {
  const label = item.label.toLowerCase();
  const action = item.action.toLowerCase();

  if (label.includes("payment")) return "/admin/live-payment-launch";
  if (label.includes("shipping: shipping simulation")) {
    return "/admin/shipping/simulations";
  }
  if (label.includes("provider purchase-attempt audit")) {
    return "/admin/shipping/simulations";
  }
  if (label.includes("live shipping")) return "/admin/live-shipping-launch";
  if (label.includes("dry-run shipping cleanup")) {
    return "/admin/shipping#dry-run-cleanup";
  }
  if (label.includes("shipping") || label.includes("provider")) {
    return "/admin/shipping";
  }
  if (action.includes("/admin/shipping/simulations")) {
    return "/admin/shipping/simulations";
  }
  if (action.includes("/admin/shipping")) return "/admin/shipping";
  if (action.includes("supabase/migrations/")) {
    return "/admin/launch-readiness#database-readiness";
  }

  return undefined;
}

function markdownList(items: BriefItem[]) {
  if (items.length === 0) return "- None";

  return items
    .map(
      (item) =>
        `- **${item.status.toUpperCase()} — ${item.label}:** ${item.detail} Next: ${item.action}`,
    )
    .join("\n");
}

function markdownListWithLinks(items: BriefItem[]) {
  return markdownList(
    items.map((item) => ({
      ...item,
      action: item.url
        ? `${item.action} Link: ${item.url}`
        : item.href
          ? `${item.action} Link: ${item.href}`
          : item.action,
    })),
  );
}

function cleanMarkdownListWithLinks(items: BriefItem[]) {
  if (items.length === 0) return markdownListWithLinks(items);

  return items
    .map((item) => {
      const link = item.url || item.href;
      const action = link ? `${item.action} Link: ${link}` : item.action;

      return `- **${item.status.toUpperCase()} - ${item.label}:** ${item.detail} Next: ${action}`;
    })
    .join("\n");
}

function inlineList(items: string[]) {
  return items.length > 0 ? items.join(", ") : "none";
}

function deploySafetyMarkdownLines() {
  return [
    `## ${DEPLOY_SAFETY.section}`,
    "",
    "- Run `npm run verify:production` before launch work; it covers InstaComp regressions, LetterTrack evidence checks, shipping purchase-attempt audit simulations, the twenty-scenario shipping simulation suite, build, production guardrails, and production preflight.",
    `- If Vercel reports \`${DEPLOY_SAFETY.quotaBlockCode}\`, ${DEPLOY_SAFETY.quotaResetInstruction.replace("npm run launch:production", "`npm run launch:production`")}`,
    `- Between build blocks, run \`${DEPLOY_SAFETY.quotaStatusCommand}\`. ${DEPLOY_SAFETY.quotaStatusDescription}`,
    `- ${DEPLOY_SAFETY.quotaUploadWarning} Marker: \`${DEPLOY_SAFETY.quotaCooldownMarkerPath}\`. Override only intentionally with \`${DEPLOY_SAFETY.quotaRetryOverrideEnv}\` or \`${DEPLOY_SAFETY.quotaRetryOverrideFlag}\`.`,
    `- ${DEPLOY_SAFETY.quotaMarkerClearCondition}`,
    `- ${DEPLOY_SAFETY.deployResultRequirement}`,
    `- ${DEPLOY_SAFETY.vercelCliRequirement}`,
    `- ${DEPLOY_SAFETY.scopeRequirement}`,
    `- ${DEPLOY_SAFETY.unwantedAliasCleanupRequirement}`,
    `- ${DEPLOY_SAFETY.targetHostRequirement}`,
    `- ${DEPLOY_SAFETY.smokeTargetRequirement}`,
    `- ${DEPLOY_SAFETY.quotaEarlyStopRequirement}`,
    `- The deploy live safety contract must keep ${deploySafetyContractMarkdown()} intact.`,
    `- Protected deploy sequence: ${deploySafetySequenceMarkdown()}.`,
    `- Keep \`${DEPLOY_SAFETY.cleanProductionDomain}\` as the clean production domain and reject the unwanted \`${DEPLOY_SAFETY.unwantedAlias}\` alias.`,
  ];
}

function deploymentSourceMarkdownLines(
  deployment: Awaited<ReturnType<typeof buildBrief>>["deployment"],
) {
  return [
    "## Deployment Source",
    "",
    `- Vercel environment: ${deployment.vercelEnv}`,
    `- Vercel URL: ${deployment.vercelUrl}`,
    `- Git commit SHA: ${deployment.gitCommitSha}`,
    `- Git ref: ${deployment.gitCommitRef}`,
    `- Git repo: ${deployment.gitRepo}`,
    `- Clean production domain: ${deployment.cleanProductionDomain}`,
    `- Smoke comparison: ${deployment.smokeComparison}`,
  ];
}

function markdownForBrief(brief: Awaited<ReturnType<typeof buildBrief>>) {
  return [
    "# TCOS Launch Readiness Brief",
    "",
    `Generated: ${brief.generatedAt}`,
    `Store: ${brief.storeId}`,
    "",
    "## Operator Next Step",
    "",
    `- Overall: ${brief.status.overall}`,
    `- Next: ${brief.status.nextStep}`,
    `- Link: ${brief.status.url || brief.status.href}`,
    "",
    "## Summary",
    "",
    `- Ready: ${brief.summary.ready}`,
    `- Review: ${brief.summary.review}`,
    `- Blocked: ${brief.summary.blocked}`,
    "",
    "## Payment",
    "",
    `- Mode: ${brief.payment.mode}`,
    `- Live enabled: ${brief.payment.livePaymentsEnabled ? "yes" : "no"}`,
    `- Approval ready: ${brief.payment.approvalReady ? "yes" : "no"}`,
    `- Posture: ${brief.payment.posture}`,
    "",
    "## Shipping",
    "",
    `- Mode: ${brief.shipping.mode}`,
    `- Live enabled: ${brief.shipping.liveShippingEnabled ? "yes" : "no"}`,
    `- Approval ready: ${brief.shipping.approvalReady ? "yes" : "no"}`,
    `- Posture: ${brief.shipping.posture}`,
    `- Standard Envelope evidence validator: ${brief.shipping.standardEnvelopeEvidenceContractReady ? "ready" : "blocked"}`,
    `- Provider purchase-attempt audit suite: ${brief.shipping.purchaseAttemptAuditRunStatus}; ${brief.shipping.purchaseAttemptAuditScenarioCount}/${brief.shipping.purchaseAttemptAuditExpectedScenarioCount} scenarios; key coverage ${brief.shipping.purchaseAttemptAuditKeyCoverageStatus}`,
    `- Missing purchase audit keys: ${inlineList(brief.shipping.purchaseAttemptAuditMissingScenarioKeys)}`,
    `- Unexpected purchase audit keys: ${inlineList(brief.shipping.purchaseAttemptAuditUnexpectedScenarioKeys)}`,
    `- Dry-run cleanup: ${brief.shipping.dryRunCleanup}`,
    `- Provider env template: ${brief.shipping.providerSetupEnvTemplateUrl || brief.shipping.providerSetupEnvTemplateHref}`,
    `- Provider Vercel commands: ${brief.shipping.providerSetupVercelCommandsUrl || brief.shipping.providerSetupVercelCommandsHref}`,
    `- Provider operator checklist: ${brief.shipping.providerSetupOperatorChecklistUrl || brief.shipping.providerSetupOperatorChecklistHref}`,
    "",
    "## Shipping Provider Unlock Action Plan",
    "",
    ...brief.shipping.providerSetupActionPlan.flatMap((step) => [
      `### ${step.order}. ${step.title}`,
      "",
      `- Status: ${step.status}`,
      `- Detail: ${step.detail}`,
      `- Action: ${step.action}`,
      ...step.evidence.map((evidence) => `- Evidence: ${evidence}`),
      "",
    ]),
    ...sellerProtectionLaunchMarkdownLines(brief.sellerProtection),
    "",
    ...sellerMarketplaceReceiptHandoffMarkdownLines(
      brief.sellerMarketplaceReceiptHandoff,
    ),
    "",
    "## Attention Items",
    "",
    cleanMarkdownListWithLinks(brief.attentionItems),
    "",
    ...deploymentSourceMarkdownLines(brief.deployment),
    "",
    ...deploySafetyMarkdownLines(),
    "",
    "## Launch Drill",
    "",
    `- Passed: ${brief.drill.passed}`,
    `- Review: ${brief.drill.warning}`,
    `- Failed: ${brief.drill.failed}`,
    "",
  ].join("\n");
}

function markdownForHandoffBundle(
  brief: Awaited<ReturnType<typeof buildBrief>>,
) {
  return [
    "# TCOS Launch Hand-off Bundle",
    "",
    `Generated: ${brief.generatedAt}`,
    `Store: ${brief.storeId}`,
    "",
    "## Current Launch Posture",
    "",
    `- Overall: ${brief.status.overall}`,
    `- Operator next step: ${brief.status.nextStep}`,
    `- Operator link: ${brief.status.url || brief.status.href}`,
    `- Ready: ${brief.summary.ready}`,
    `- Review: ${brief.summary.review}`,
    `- Blocked: ${brief.summary.blocked}`,
    "",
    "## Payment",
    "",
    `- Mode: ${brief.payment.mode}`,
    `- Live payments enabled: ${brief.payment.livePaymentsEnabled ? "yes" : "no"}`,
    `- Approval ready: ${brief.payment.approvalReady ? "yes" : "no"}`,
    `- Posture: ${brief.payment.posture}`,
    "",
    "## Shipping",
    "",
    `- Mode: ${brief.shipping.mode}`,
    `- Live shipping enabled: ${brief.shipping.liveShippingEnabled ? "yes" : "no"}`,
    `- Approval ready: ${brief.shipping.approvalReady ? "yes" : "no"}`,
    `- Posture: ${brief.shipping.posture}`,
    `- Standard Envelope evidence validator: ${brief.shipping.standardEnvelopeEvidenceContractReady ? "ready" : "blocked"}`,
    `- Provider purchase-attempt audit suite: ${brief.shipping.purchaseAttemptAuditRunStatus}; ${brief.shipping.purchaseAttemptAuditScenarioCount}/${brief.shipping.purchaseAttemptAuditExpectedScenarioCount} scenarios; key coverage ${brief.shipping.purchaseAttemptAuditKeyCoverageStatus}`,
    `- Missing purchase audit keys: ${inlineList(brief.shipping.purchaseAttemptAuditMissingScenarioKeys)}`,
    `- Unexpected purchase audit keys: ${inlineList(brief.shipping.purchaseAttemptAuditUnexpectedScenarioKeys)}`,
    `- Dry-run cleanup: ${brief.shipping.dryRunCleanup}`,
    `- Provider setup status: ${brief.shipping.providerSetupStatus}`,
    `- Provider setup summary: ${brief.shipping.providerSetupSummary}`,
    "",
    ...sellerProtectionLaunchMarkdownLines(brief.sellerProtection),
    "",
    "## Shipping Setup Exports",
    "",
    `- Env template: ${brief.shipping.providerSetupEnvTemplateUrl || brief.shipping.providerSetupEnvTemplateHref}`,
    `- Vercel commands: ${brief.shipping.providerSetupVercelCommandsUrl || brief.shipping.providerSetupVercelCommandsHref}`,
    `- Operator checklist: ${brief.shipping.providerSetupOperatorChecklistUrl || brief.shipping.providerSetupOperatorChecklistHref}`,
    "",
    "## Shipping Provider Unlock Action Plan",
    "",
    ...brief.shipping.providerSetupActionPlan.flatMap((step) => [
      `### ${step.order}. ${step.title}`,
      "",
      `- Status: ${step.status}`,
      `- Detail: ${step.detail}`,
      `- Action: ${step.action}`,
      ...step.evidence.map((evidence) => `- Evidence: ${evidence}`),
      "",
    ]),
    "## Safe Shipping Defaults",
    "",
    "- Keep `TCOS_SHIPPING_PURCHASE_MODE=dry_run` while provider credentials, live adapter, Coverage, webhooks, reconciliation, simulations, and admin approval are incomplete.",
    "- Keep `TCOS_LIVE_SHIPPING_ENABLED=false` until the live shipping gate is fully approved.",
    "- Do not paste provider secret values into Git, chat, screenshots, tickets, or exported packets.",
    "",
    "## Attention Items",
    "",
    cleanMarkdownListWithLinks(brief.attentionItems),
    "",
    ...deploymentSourceMarkdownLines(brief.deployment),
    "",
    "## Git Tip Verification",
    "",
    "- Before deployment, confirm the local worktree is clean and the local commit matches GitHub:",
    "",
    "```powershell",
    "git fetch origin main",
    "git status --short",
    "git rev-parse --short HEAD",
    "git rev-parse --short origin/main",
    "git log -5 --oneline",
    "```",
    "",
    "- Treat `HEAD` and `origin/main` matching as the deployable source of truth. Handoff-only commits may appear after the last launch-code commit.",
    "",
    "## Production Deploy Commands",
    "",
    "- Before deploying, run `npm run verify:production`; it covers InstaComp regressions, LetterTrack evidence checks, shipping purchase-attempt audit simulations, the twenty-scenario shipping simulation suite, build, production guardrails, and production preflight.",
    `- Check the local Vercel cooldown with \`${DEPLOY_SAFETY.quotaStatusCommand}\`; it is read-only and starts no upload or deployment.`,
    "- If Vercel deploy quota is open, run `npm run launch:production`.",
    `- If Vercel reports \`${DEPLOY_SAFETY.quotaBlockCode}\`, ${DEPLOY_SAFETY.quotaResetInstruction.replace("npm run launch:production", "the launch helper")}`,
    `- If the launch helper must be split up, run \`npm run deploy:production\` and then \`${DEPLOY_SAFETY.smokeCommand}\`.`,
    `- Keep \`${DEPLOY_SAFETY.cleanProductionDomain}\` as the clean production domain and reject the unwanted \`${DEPLOY_SAFETY.unwantedAlias}\` alias.`,
    `- ${DEPLOY_SAFETY.quotaMarkerClearCondition}`,
    `- ${DEPLOY_SAFETY.deployResultRequirement}`,
    `- ${DEPLOY_SAFETY.vercelCliRequirement}`,
    `- ${DEPLOY_SAFETY.scopeRequirement}`,
    `- ${DEPLOY_SAFETY.unwantedAliasCleanupRequirement}`,
    `- ${DEPLOY_SAFETY.targetHostRequirement}`,
    `- ${DEPLOY_SAFETY.smokeTargetRequirement}`,
    `- ${DEPLOY_SAFETY.quotaEarlyStopRequirement}`,
    `- The deploy live safety contract must keep ${deploySafetyContractMarkdown()} intact.`,
    `- Protected deploy sequence: ${deploySafetySequenceMarkdown()}.`,
    "",
    "## Production Go/No-Go Ladder",
    "",
    deploySafetyDecisionLadderMarkdown(),
    "",
    "## Post-deploy Verification",
    "",
    "- Confirm admin login returns 200.",
    "- Confirm `/admin/launch-readiness` renders.",
    "- Confirm `/api/admin/launch-readiness` returns JSON.",
    "- Confirm `/api/admin/launch-readiness?format=markdown` downloads Markdown.",
    "- Confirm `/api/admin/launch-readiness?format=handoff-bundle` downloads this bundle.",
    "- Confirm `/admin/live-payment-launch` still shows live payments open.",
    "- Confirm `/admin/live-shipping-launch` still shows shipping locked until provider work is complete.",
    "- Confirm production smoke POSTs `/api/admin/shipping/simulations` and verifies twenty expected shipping scenarios, five expected purchase-audit scenarios, passed key coverage, no missing or unexpected scenario keys, and no missing/unexpected purchase-audit keys.",
    "- Confirm `/api/admin/shipping/provider-setup` exposes export links and credential groups.",
    "",
    ...sellerMarketplaceReceiptHandoffMarkdownLines(
      brief.sellerMarketplaceReceiptHandoff,
    ),
    "",
    "- Confirm the clean production domain points at the latest deployment.",
    "",
  ].join("\n");
}

function absoluteUrl(origin: string | null, href: string | undefined) {
  if (!origin || !href) return undefined;

  try {
    return new URL(href, origin).toString();
  } catch {
    return undefined;
  }
}

function buildDeploymentSource(origin: string | null) {
  const vercelUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : origin || "local";
  const gitOwner = process.env.VERCEL_GIT_REPO_OWNER || "unknown-owner";
  const gitRepoSlug = process.env.VERCEL_GIT_REPO_SLUG || "unknown-repo";
  const gitCommitSha = process.env.VERCEL_GIT_COMMIT_SHA || "local-unknown";
  const gitCommitRef = process.env.VERCEL_GIT_COMMIT_REF || "local";

  return {
    vercelEnv: process.env.VERCEL_ENV || "local",
    vercelUrl,
    gitCommitSha,
    gitCommitShortSha:
      gitCommitSha.length >= 7 ? gitCommitSha.slice(0, 7) : gitCommitSha,
    gitCommitRef,
    gitRepo: `${gitOwner}/${gitRepoSlug}`,
    cleanProductionDomain: DEPLOY_SAFETY.cleanProductionDomain,
    smokeComparison:
      "Compare this Git commit SHA with origin/main before treating production smoke as current.",
  };
}

function buildOperatorStatus(params: {
  summary: ReturnType<typeof summarize>;
  paymentLiveEnabled: boolean;
  shippingLiveEnabled: boolean;
  shippingMode: string;
  drillFailed: number;
  firstAttentionItem: BriefItem | undefined;
}) {
  if (params.drillFailed > 0) {
    return {
      overall: "blocked",
      nextStep:
        "Open the Launch Gate Drill and fix failing runtime-lock checks before changing any launch switches.",
      href: "/admin/launch-gate-drill",
    };
  }

  if (params.summary.blocked > 0) {
    return {
      overall: "blocked",
      nextStep: params.firstAttentionItem
        ? `Clear the top blocked launch item: ${params.firstAttentionItem.label}.`
        : "Clear blocked launch readiness items before continuing launch work.",
      href: params.firstAttentionItem?.href || "/admin/launch-readiness",
    };
  }

  if (!params.paymentLiveEnabled) {
    return {
      overall: "review",
      nextStep:
        "Payment is not open; review the Live Payment Launch gate before accepting live Checkout.",
      href: "/admin/live-payment-launch",
    };
  }

  if (!params.shippingLiveEnabled || params.shippingMode !== "live") {
    return {
      overall: "review",
      nextStep:
        "Live payments are open; keep shipping safely locked while provider credentials, live adapter, Coverage, webhook, and reconciliation work is completed.",
      href: "/admin/live-shipping-launch",
    };
  }

  if (params.summary.review > 0) {
    return {
      overall: "review",
      nextStep: params.firstAttentionItem
        ? `Review the top launch attention item: ${params.firstAttentionItem.label}.`
        : "Review remaining launch attention items.",
      href: params.firstAttentionItem?.href || "/admin/launch-readiness",
    };
  }

  return {
    overall: "ready",
    nextStep:
      "Launch gates are clear. Continue monitoring orders, Stripe webhooks, reconciliation, shipping proof, and seller payout holds.",
    href: "/admin",
  };
}

async function buildBrief(origin: string | null = null) {
  const supabase = createSupabaseServerClient({ admin: true });
  const storeId = getActiveStoreId();

  const [
    paymentReport,
    shippingReport,
    drillReport,
    dryRunCleanup,
  ] = await Promise.all([
    evaluateLivePaymentLaunch({ supabase, storeId }),
    evaluateLiveShippingLaunch({ supabase, storeId }),
    runLaunchGateDrill({ supabase, storeId }),
    getDryRunShippingCleanupSummary({ supabase, storeId, sampleLimit: 500 }),
  ]);
  const providerSetup = buildShippingProviderSetupPacket();

  const paymentItems: BriefItem[] = paymentReport.checks.map((check) => ({
    label: `Payment: ${check.label}`,
    status: statusFromCheck(check.status),
    detail: check.detail,
    action: "Open /admin/live-payment-launch and clear this payment launch check.",
    href: "/admin/live-payment-launch",
  }));
  const shippingSafelyLocked =
    shippingReport.approvalDatabaseReady &&
    shippingReport.purchaseMode === "dry_run" &&
    !shippingReport.liveShippingEnabled;
  const shippingItems: BriefItem[] = shippingReport.checks.map((check) => ({
    label: `Shipping: ${check.label}`,
    status:
      shippingSafelyLocked && check.status === "blocked"
        ? "review"
        : statusFromCheck(check.status),
    detail: check.detail,
    action:
      check.key === "shipping_simulations"
        ? "Open /admin/shipping/simulations or run npm run simulate:shipping and save passing evidence."
        : check.key === "provider_purchase_attempt_audit_simulations"
          ? "Open /admin/shipping/simulations or run npm run simulate:shipping-purchase-audit and save the five-scenario pass evidence."
        : "Open /admin/live-shipping-launch or /admin/shipping and clear this shipping launch check.",
    href:
      check.key === "shipping_simulations"
        ? "/admin/shipping/simulations"
        : check.key === "provider_purchase_attempt_audit_simulations"
          ? "/admin/shipping/simulations"
        : "/admin/live-shipping-launch",
  }));
  const providerItems: BriefItem[] = providerSetup.readiness.map((item) => ({
    label: `Provider: ${item.label}`,
    status:
      item.status === "ready"
        ? "ready"
        : item.status === "blocked"
          ? "blocked"
          : "review",
    detail: item.detail,
    action: item.action,
    href: hrefForBriefItem({
      label: `Provider: ${item.label}`,
      status: item.status === "blocked" ? "blocked" : "review",
      detail: item.detail,
      action: item.action,
    }),
  }));
  const dryRunCleanupItem: BriefItem = dryRunCleanup.error
    ? {
        label: "Dry-Run Shipping Cleanup",
        status: "blocked",
        detail: `Dry-run cleanup could not be checked: ${dryRunCleanup.error.message}`,
        action: "Open /admin/shipping#dry-run-cleanup after shipping migrations are available.",
        href: "/admin/shipping#dry-run-cleanup",
      }
    : dryRunCleanup.total > 0
      ? {
          label: "Dry-Run Shipping Cleanup",
          status: "blocked",
          detail: dryRunCleanup.detail,
          action: "Open /admin/shipping#dry-run-cleanup and retire simulated proof before launch.",
          href: "/admin/shipping#dry-run-cleanup",
        }
      : {
          label: "Dry-Run Shipping Cleanup",
          status: "ready",
          detail: dryRunCleanup.detail,
          action: "Keep dry-run cleanup clear before seller payout release or shipping launch.",
          href: "/admin/shipping#dry-run-cleanup",
        };

  const items = [
    ...paymentItems,
    ...shippingItems,
    ...providerItems,
    dryRunCleanupItem,
  ];
  const attentionItems = sortAttentionItems(items)
    .slice(0, 15)
    .map((item) => ({
      ...item,
      href: item.href || hrefForBriefItem(item),
    }))
    .map((item) => ({
      ...item,
      url: absoluteUrl(origin, item.href),
    }));
  const summary = summarize(items);
  const operatorStatus = buildOperatorStatus({
    summary,
    paymentLiveEnabled: paymentReport.livePaymentsEnabled,
    shippingLiveEnabled: shippingReport.liveShippingEnabled,
    shippingMode: shippingReport.purchaseMode,
    drillFailed: drillReport.summary.failed,
    firstAttentionItem: attentionItems[0],
  });

  return {
    generatedAt: new Date().toISOString(),
    storeId,
    status: {
      ...operatorStatus,
      url: absoluteUrl(origin, operatorStatus.href),
    },
    deployment: buildDeploymentSource(origin),
    deploySafety: DEPLOY_SAFETY,
    summary,
    payment: {
      mode: paymentReport.paymentMode,
      livePaymentsEnabled: paymentReport.livePaymentsEnabled,
      approvalDatabaseReady: paymentReport.approvalDatabaseReady,
      approvalReady: paymentReport.approvalReady,
      posture: drillReport.posture.payment.label,
    },
    shipping: {
      mode: shippingReport.purchaseMode,
      liveShippingEnabled: shippingReport.liveShippingEnabled,
      approvalDatabaseReady: shippingReport.approvalDatabaseReady,
      approvalReady: shippingReport.approvalReady,
      posture: drillReport.posture.shipping.label,
      standardEnvelopeEvidenceContractReady:
        shippingReport.standardEnvelopeEvidenceContractReady,
      purchaseAttemptAuditRunStatus:
        shippingReport.purchaseAttemptAuditSimulation.run_status,
      purchaseAttemptAuditScenarioCount:
        shippingReport.purchaseAttemptAuditSimulation.scenario_count,
      purchaseAttemptAuditExpectedScenarioCount:
        shippingReport.purchaseAttemptAuditSimulation.expected_scenario_count,
      purchaseAttemptAuditKeyCoverageStatus:
        shippingReport.purchaseAttemptAuditSimulation
          .scenario_key_coverage_status,
      purchaseAttemptAuditMissingScenarioKeys:
        shippingReport.purchaseAttemptAuditSimulation.missing_scenario_keys,
      purchaseAttemptAuditUnexpectedScenarioKeys:
        shippingReport.purchaseAttemptAuditSimulation.unexpected_scenario_keys,
      dryRunCleanup: dryRunCleanup.detail,
      providerSetupStatus: providerSetup.decision.status,
      providerSetupSummary: providerSetup.decision.summary,
      providerSetupActionPlan: providerSetup.actionPlan,
      providerSetupEnvTemplateHref: SHIPPING_PROVIDER_ENV_TEMPLATE_HREF,
      providerSetupEnvTemplateUrl: absoluteUrl(
        origin,
        SHIPPING_PROVIDER_ENV_TEMPLATE_HREF,
      ),
      providerSetupVercelCommandsHref: SHIPPING_PROVIDER_VERCEL_COMMANDS_HREF,
      providerSetupVercelCommandsUrl: absoluteUrl(
        origin,
        SHIPPING_PROVIDER_VERCEL_COMMANDS_HREF,
      ),
      providerSetupOperatorChecklistHref:
        SHIPPING_PROVIDER_OPERATOR_CHECKLIST_HREF,
      providerSetupOperatorChecklistUrl: absoluteUrl(
        origin,
        SHIPPING_PROVIDER_OPERATOR_CHECKLIST_HREF,
      ),
    },
    sellerProtection: buildSellerProtectionLaunchContract(origin),
    sellerMarketplaceReceiptHandoff:
      buildSellerMarketplaceReceiptHandoffContract(origin),
    drill: {
      passed: drillReport.summary.passed,
      warning: drillReport.summary.warning,
      failed: drillReport.summary.failed,
    },
    attentionItems,
  };
}

export async function GET(request: Request) {
  try {
    const requestUrl = new URL(request.url);
    const brief = await buildBrief(requestUrl.origin);
    const format = requestUrl.searchParams.get("format");

    if (format === "markdown" || format === "md") {
      return new Response(markdownForBrief(brief), {
        headers: {
          "Cache-Control": "no-store",
          "Content-Disposition": 'attachment; filename="tcos-launch-readiness-brief.md"',
          "Content-Type": "text/markdown; charset=utf-8",
        },
      });
    }

    if (format === "handoff-bundle") {
      return new Response(markdownForHandoffBundle(brief), {
        headers: {
          "Cache-Control": "no-store",
          "Content-Disposition": 'attachment; filename="tcos-launch-handoff-bundle.md"',
          "Content-Type": "text/markdown; charset=utf-8",
        },
      });
    }

    return NextResponse.json(
      {
        success: true,
        brief,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error: unknown) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not build launch readiness brief.",
      },
      { status: 500 },
    );
  }
}
