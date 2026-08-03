import { createHash } from "node:crypto";

export type AccessVerdict = "certified" | "review" | "quarantine" | "blocked";
export type CredentialStatus = "current" | "due" | "expired" | "revoked";

export interface PrincipalAccessEvidence {
  principalId: string;
  role: string;
  ownerApproved: boolean;
  leastPrivilegeVerified: boolean;
  mfaVerified: boolean;
  lastReviewedAt: string;
  sourceVerified: boolean;
}

export interface CredentialEvidence {
  credentialId: string;
  status: CredentialStatus;
  rotatedAt: string;
  maximumAgeDays: number;
  sourceVerified: boolean;
  fingerprint: string;
}

export interface AccessCertificationInput {
  now: string;
  ownerApproval: boolean;
  releaseCertified: boolean;
  auditTrailComplete: boolean;
  killSwitchReady: boolean;
  principals: PrincipalAccessEvidence[];
  credentials: CredentialEvidence[];
  requiredRoles: string[];
  maximumReviewAgeDays: number;
}

export interface AccessCertificationResult {
  verdict: AccessVerdict;
  reasons: string[];
  commands: Array<"require_owner_review" | "quarantine_privileged_writes" | "disable_credential" | "rotate_credential">;
  fingerprint: string;
}

const DAY_MS = 86_400_000;
const validDate = (value: string) => Number.isFinite(Date.parse(value));
const validFingerprint = (value: string) => /^[a-f0-9]{64}$/i.test(value);

export function certifyAccessAndRotation(input: AccessCertificationInput): AccessCertificationResult {
  const reasons: string[] = [];
  const commands = new Set<AccessCertificationResult["commands"][number]>();
  const nowMs = Date.parse(input.now);

  if (!validDate(input.now) || !Number.isFinite(input.maximumReviewAgeDays) || input.maximumReviewAgeDays <= 0) reasons.push("invalid_policy");
  if (!input.ownerApproval) reasons.push("owner_approval_missing");
  if (!input.releaseCertified) reasons.push("release_not_certified");
  if (!input.auditTrailComplete) reasons.push("audit_trail_incomplete");
  if (!input.killSwitchReady) reasons.push("kill_switch_unavailable");

  const principalIds = new Set<string>();
  const roles = new Set<string>();
  for (const principal of input.principals) {
    if (!principal.principalId || principalIds.has(principal.principalId)) reasons.push("duplicate_or_missing_principal");
    principalIds.add(principal.principalId);
    roles.add(principal.role);
    if (!principal.ownerApproved || !principal.leastPrivilegeVerified || !principal.mfaVerified || !principal.sourceVerified) reasons.push(`principal_not_certified:${principal.principalId}`);
    if (!validDate(principal.lastReviewedAt) || nowMs - Date.parse(principal.lastReviewedAt) > input.maximumReviewAgeDays * DAY_MS) reasons.push(`principal_review_stale:${principal.principalId}`);
  }
  for (const role of new Set(input.requiredRoles)) if (!roles.has(role)) reasons.push(`required_role_missing:${role}`);

  const credentialIds = new Set<string>();
  for (const credential of input.credentials) {
    if (!credential.credentialId || credentialIds.has(credential.credentialId)) reasons.push("duplicate_or_missing_credential");
    credentialIds.add(credential.credentialId);
    if (!credential.sourceVerified || !validFingerprint(credential.fingerprint) || !validDate(credential.rotatedAt) || !Number.isFinite(credential.maximumAgeDays) || credential.maximumAgeDays <= 0) reasons.push(`credential_evidence_invalid:${credential.credentialId}`);
    const ageDays = (nowMs - Date.parse(credential.rotatedAt)) / DAY_MS;
    if (credential.status === "revoked") commands.add("disable_credential");
    if (credential.status === "expired" || ageDays > credential.maximumAgeDays) {
      reasons.push(`credential_expired:${credential.credentialId}`);
      commands.add("disable_credential");
      commands.add("rotate_credential");
    } else if (credential.status === "due" || ageDays > credential.maximumAgeDays * 0.8) {
      reasons.push(`credential_rotation_due:${credential.credentialId}`);
      commands.add("rotate_credential");
    }
  }

  const severe = reasons.some((reason) => /invalid_policy|missing|expired|not_certified|incomplete|unavailable|duplicate|invalid/.test(reason));
  let verdict: AccessVerdict = "certified";
  if (severe) {
    verdict = input.ownerApproval && input.killSwitchReady ? "quarantine" : "blocked";
    commands.add("quarantine_privileged_writes");
    commands.add("require_owner_review");
  } else if (reasons.length > 0) {
    verdict = "review";
    commands.add("require_owner_review");
  }

  const normalized = JSON.stringify({ ...input, principals: [...input.principals].sort((a,b)=>a.principalId.localeCompare(b.principalId)), credentials: [...input.credentials].sort((a,b)=>a.credentialId.localeCompare(b.credentialId)), reasons: [...reasons].sort(), commands: [...commands].sort(), verdict });
  return { verdict, reasons: [...new Set(reasons)].sort(), commands: [...commands].sort(), fingerprint: createHash("sha256").update(normalized).digest("hex") };
}
