export const DEPLOY_SAFETY_SMOKE_COMMAND = "npm run smoke:production";

export const DEPLOY_SAFETY = {
  section: "Cloudflare Production Deploy Safety",
  cleanProductionDomain: "https://truelycollectables.com",
  unwantedAlias: "noncanonical deployment host",
  quotaBlockCode: "cloudflare-deployment-blocked",
  quotaResetInstruction:
    "Resolve the failed Cloudflare deployment check before retrying the production workflow.",
  quotaCooldownMarkerPath: "GitHub Actions deployment receipt",
  quotaStatusCommand: "npm run status:production",
  quotaStatusDescription:
    "Read-only production status for the Cloudflare-owned domain and current source revision.",
  quotaRetryOverrideEnv: "No automatic override",
  quotaRetryOverrideFlag: "No force flag",
  quotaUploadWarning:
    "A failed deployment must remain blocked until the build, Worker upload, domain, and smoke checks are healthy.",
  quotaMarkerClearCondition:
    "Treat a release as complete only after the Cloudflare deployment and production smoke checks pass.",
  deployResultRequirement:
    "Require the Cloudflare deployment workflow to finish successfully before recording a production release.",
  vercelCliRequirement:
    "Use the repository-pinned Cloudflare build and Wrangler versions in the production workflow.",
  scopeRequirement:
    "Restrict production deployment credentials to the Truely Collectables Cloudflare account and Worker.",
  unwantedAliasCleanupRequirement:
    "Keep the owned customer domain as the only canonical public production origin.",
  targetHostRequirement:
    "Accept production target overrides only as valid HTTPS DNS origins without credentials, ports, queries, or fragments.",
  smokeTargetRequirement:
    "Run production smoke checks only against the owned HTTPS storefront origin.",
  quotaEarlyStopRequirement:
    "Stop before upload whenever source validation, build, credential, or Cloudflare ownership checks fail.",
  contract: [
    "Cloudflare account and Worker ownership",
    "encrypted recovery backup receipt",
    "repository-pinned production build",
    "successful Worker upload",
    "owned-domain verification",
    "post-deploy production smoke",
    `${DEPLOY_SAFETY_SMOKE_COMMAND} handoff`,
  ],
  sequence: [
    "verify encrypted recovery backup",
    "build the Cloudflare Worker",
    "deploy the production Worker",
    "verify the owned custom domain",
    "run production smoke checks",
    "record the deployment receipt",
  ],
  decisionLadder: [
    {
      label: "1. Verify the pushed stack",
      command: "npm run verify:production",
      outcome: "lint, simulations, build, guardrails, and GitHub checks pass",
    },
    {
      label: "2. Deploy through Cloudflare",
      command: "Cloudflare production workflow",
      outcome: "the production Worker is built, uploaded, and attached to the owned domain",
    },
    {
      label: "3. Stop on any failed gate",
      command: "cloudflare-deployment-blocked",
      outcome: "do not bypass failed build, credential, ownership, or smoke checks",
    },
    {
      label: "4. Verify production",
      command: "npm run smoke:production",
      outcome: "the owned domain returns the expected Cloudflare Worker marker",
    },
  ],
  smokeCommand: DEPLOY_SAFETY_SMOKE_COMMAND,
} as const;

export function deploySafetyContractMarkdown() {
  return DEPLOY_SAFETY.contract.join(", ");
}

export function deploySafetySequenceMarkdown() {
  return DEPLOY_SAFETY.sequence.join(" -> ");
}

export function deploySafetyDecisionLadderMarkdown() {
  return DEPLOY_SAFETY.decisionLadder
    .map((step) => `- ${step.label}: \`${step.command}\` — ${step.outcome}.`)
    .join("\n");
}
