export const EMERGENCY_BACKUP_EVIDENCE = {
  title: "Emergency Backup Evidence",
  statusSchema: "tcos.nightlyBackupStatus.v1",
  verificationSchema: "tcos.nightlyEmergencyBackupVerification.v1",
  runwaySchema: "tcos.goLiveRunwayStatus.v1",
  statusCommand: "npm run status:nightly-backup",
  statusJsonCommand: "npm --silent run status:nightly-backup:json",
  verificationCommand: "npm run verify:nightly-backup",
  verificationJsonCommand: "npm --silent run verify:nightly-backup:json",
  statusArchiveCommand: "npm run archive:nightly-backup-status",
  verificationArchiveCommand: "npm run archive:nightly-backup-verification",
  runwayStatusCommand: "npm run status:go-live",
  runwayArchiveCommand: "npm run archive:go-live-runway",
  statusArchiveDirectory: ".codex-run/nightly-backup-status/",
  verificationArchiveDirectory: ".codex-run/nightly-backup-verification/",
  runwayArchiveDirectory: ".codex-run/go-live-runway/",
  backupFolder: "~/Backups by default; reinstall with --backup-dir /Backups only after the Mac grants that folder",
  retentionWindow: "Seven dated backups; day 8 replaces day 1, day 9 replaces day 2, and so on.",
  launchProof:
    "Before go-live, capture current schedule health, scheduler proof, launchd loaded/runs/last-exit evidence, verification ok, failed-check count, verified archive path, and computed SHA-256.",
  acceptedStatus:
    "`scheduleHealth: current`, `verification.ok: true`, and either `schedulerProof: automatic_proven` or a documented first-run/manual-backup exception while launchd is loaded.",
  readOnlyGuarantee:
    "The status and verification helpers read LaunchAgent, launchd, backup metadata, archive manifest, checksum, and tar listing only. Archive helpers only write timestamped evidence under .codex-run; they do not create a backup archive or push Git.",
  sideEffectBoundary:
    "Emergency-backup evidence commands must not deploy, upload, create Checkout, buy postage, release payouts, approve launch, or revoke anything.",
} as const;

export function emergencyBackupEvidenceMarkdownLines(
  evidence = EMERGENCY_BACKUP_EVIDENCE,
) {
  return [
    "## Emergency Backup Evidence",
    "",
    `- Status schema: \`${evidence.statusSchema}\``,
    `- Verification schema: \`${evidence.verificationSchema}\``,
    `- Go-live runway schema: \`${evidence.runwaySchema}\``,
    `- Status command: \`${evidence.statusCommand}\``,
    `- Raw status JSON command: \`${evidence.statusJsonCommand}\``,
    `- Verification command: \`${evidence.verificationCommand}\``,
    `- Raw verification JSON command: \`${evidence.verificationJsonCommand}\``,
    `- Status archive helper: \`${evidence.statusArchiveCommand}\``,
    `- Verification archive helper: \`${evidence.verificationArchiveCommand}\``,
    `- Combined runway command: \`${evidence.runwayStatusCommand}\``,
    `- Combined runway archive helper: \`${evidence.runwayArchiveCommand}\``,
    `- Evidence directories: \`${evidence.statusArchiveDirectory}\`, \`${evidence.verificationArchiveDirectory}\`, \`${evidence.runwayArchiveDirectory}\``,
    `- Backup folder: ${evidence.backupFolder}`,
    `- Retention: ${evidence.retentionWindow}`,
    `- Launch proof: ${evidence.launchProof}`,
    `- Accepted status: ${evidence.acceptedStatus}`,
    `- Read-only guarantee: ${evidence.readOnlyGuarantee}`,
    `- Side-effect boundary: ${evidence.sideEffectBoundary}`,
  ];
}
