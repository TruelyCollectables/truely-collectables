export const DEPLOY_SAFETY_SMOKE_COMMAND = "npm run smoke:production";

export const DEPLOY_SAFETY = {
  section: "Production Deploy Safety",
  cleanProductionDomain: "https://truely-collectables.vercel.app",
  unwantedAlias: "truely-collectables-tt3b.vercel.app",
  quotaBlockCode: "api-deployments-free-per-day",
  quotaResetInstruction:
    "Wait for the rolling 24-hour quota reset before retrying npm run launch:production.",
  contract: [
    "Vercel quota messaging",
    "unwanted alias removal for truely-collectables-tt3b.vercel.app",
    "clean-domain aliasing",
    "deployed URL output",
    "clean URL output",
    `${DEPLOY_SAFETY_SMOKE_COMMAND} handoff`,
  ],
  sequence: [
    "remove unwanted alias",
    "set clean production alias",
    "print DEPLOYED_PRODUCTION",
    "print CLEAN_PRODUCTION",
    "print smoke handoff command",
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
