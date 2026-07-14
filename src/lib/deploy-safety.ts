export const DEPLOY_SAFETY_SMOKE_COMMAND = "npm run smoke:production";

export const DEPLOY_SAFETY = {
  section: "Production Deploy Safety",
  cleanProductionDomain: "https://truely-collectables.vercel.app",
  unwantedAlias: "truely-collectables-tt3b.vercel.app",
  quotaBlockCode: "api-deployments-free-per-day",
  quotaResetInstruction:
    "Wait for the rolling 24-hour quota reset before retrying npm run launch:production.",
  quotaCooldownMarkerPath: ".codex-run/vercel-quota-block.json",
  quotaStatusCommand: "npm run status:production",
  quotaStatusDescription:
    "Read-only local cooldown check with exact blocked/retry timestamps and no Git fetch, build, Vercel upload, or deployment.",
  quotaRetryOverrideEnv: "TCOS_VERCEL_QUOTA_RETRY_OVERRIDE=true",
  quotaRetryOverrideFlag: "--force-quota-retry",
  quotaUploadWarning:
    "Vercel can still upload files before returning the quota error, so the deploy helper records a local cooldown marker and stops later attempts before upload unless an intentional override is used.",
  quotaMarkerClearCondition:
    "Clear the local quota marker only after Vercel returns a parsed deployment URL and the clean production alias succeeds.",
  deployResultRequirement:
    "Require vercel --prod to exit successfully before parsing its deployment URL, running alias commands, or clearing the quota marker.",
  contract: [
    "Vercel quota messaging",
    "local Vercel quota cooldown marker",
    "read-only quota status via npm run status:production",
    "unwanted alias removal for truely-collectables-tt3b.vercel.app",
    "clean-domain aliasing",
    "success-only quota marker clearing",
    "successful Vercel deploy exit before URL and alias handling",
    "deployed URL output",
    "clean URL output",
    `${DEPLOY_SAFETY_SMOKE_COMMAND} handoff`,
  ],
  sequence: [
    "remove unwanted truely-collectables-tt3b.vercel.app alias",
    "set clean production alias",
    "clear local quota marker after clean alias succeeds",
    "print DEPLOYED_PRODUCTION",
    "print CLEAN_PRODUCTION",
    "print smoke handoff command",
  ],
  decisionLadder: [
    {
      label: "1. Verify the pushed stack",
      command: "npm run verify:production",
      outcome:
        "lint, simulations, build, guardrails, and GitHub preflight pass without touching Vercel",
    },
    {
      label: "2. Launch only when quota is open",
      command: "npm run launch:production",
      outcome:
        "production deploy, clean-domain aliasing, unwanted-alias removal, and smoke run in order",
    },
    {
      label: "3. Halt on Vercel quota",
      command: "api-deployments-free-per-day",
      outcome:
        "do not force alternate deploy paths; let the local cooldown marker stop repeat uploads, then wait for the rolling 24-hour reset and rerun the launch helper",
    },
    {
      label: "4. Split only after a successful deploy",
      command: "npm run deploy:production && npm run smoke:production",
      outcome:
        "use the split path only when rerunning deploy and smoke separately is intentional",
    },
    {
      label: "5. Ship only after smoke passes clean production",
      command: "https://truely-collectables.vercel.app",
      outcome:
        "clean URL serves the latest GitHub tip and the unwanted preview-style alias does not respond",
    },
  ],
  smokeCommand: DEPLOY_SAFETY_SMOKE_COMMAND,
} as const;

export function deploySafetyContractMarkdown() {
  const contractWithoutSmoke = DEPLOY_SAFETY.contract.slice(0, -1).join(", ");

  return `${contractWithoutSmoke}, and the \`${DEPLOY_SAFETY.smokeCommand}\` handoff`;
}

export function deploySafetySequenceMarkdown() {
  return DEPLOY_SAFETY.sequence.join(" -> ");
}

export function deploySafetyDecisionLadderMarkdown() {
  return DEPLOY_SAFETY.decisionLadder
    .map((step) => `- ${step.label}: \`${step.command}\` — ${step.outcome}.`)
    .join("\n");
}
