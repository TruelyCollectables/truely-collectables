export const LIVE_MONEY_JSON_EVIDENCE = {
  title: "Live Money JSON Evidence",
  schema: "tcos.liveMoneyGoNoGo.v1",
  statusCommand: "npm --silent run status:live-money:json",
  preflightCommand: "npm --silent run preflight:live-money:json",
  archiveCommand: "npm run archive:live-money",
  preflightArchiveCommand: "npm run archive:live-money:preflight",
  archiveDirectory: ".codex-run/live-money-evidence/",
  readyStates: ["READY_FOR_RUNTIME_SWITCH", "LIVE_MONEY_OPEN"],
  blockedStates: [
    "BLOCKED_UNEVALUATED",
    "BLOCKED_APPROVAL",
    "READY_FOR_DATABASE_APPROVAL",
    "BLOCKED_LAUNCH_GATE",
  ],
  archiveRequirement:
    "Archive the status JSON after production smoke passes, preferably with npm run archive:live-money, then archive the preflight JSON during the final go-live window with npm run archive:live-money:preflight before changing TCOS_LIVE_PAYMENTS_ENABLED.",
  readOnlyGuarantee:
    "Both commands are read-only evidence commands and must not create Checkout Sessions, Customers, PaymentIntents, refunds, disputes, payouts, labels, postage purchases, Coverage policies, launch approvals, or revocations.",
} as const;

export function liveMoneyJsonEvidenceMarkdownLines(
  evidence = LIVE_MONEY_JSON_EVIDENCE,
) {
  return [
    "## Live Money JSON Evidence",
    "",
    `- Schema: \`${evidence.schema}\``,
    `- Post-smoke archive command: \`${evidence.statusCommand}\``,
    `- Final-window preflight command: \`${evidence.preflightCommand}\``,
    `- Post-smoke archive helper: \`${evidence.archiveCommand}\``,
    `- Final-window preflight archive helper: \`${evidence.preflightArchiveCommand}\``,
    `- Timestamped archive directory: \`${evidence.archiveDirectory}\``,
    `- Accepted go-live states: ${evidence.readyStates.join(", ")}`,
    `- Halt states: ${evidence.blockedStates.join(", ")}`,
    `- Archive requirement: ${evidence.archiveRequirement}`,
    `- Read-only guarantee: ${evidence.readOnlyGuarantee}`,
  ];
}
