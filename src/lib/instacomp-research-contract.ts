import type { InstaCompCapability } from "./instacomp-capabilities";
import type { InstaCompEvidenceReceiptV1 } from "./instacomp-evidence-contract";

export const INSTACOMP_RESEARCH_JOB_SCHEMA_VERSION =
  "tcos.instacomp.research-job.v1" as const;

export type InstaCompResearchJobStatus =
  | "queued"
  | "running"
  | "blocked"
  | "completed"
  | "failed"
  | "cancelled";

export type InstaCompResearchSourceRequest = {
  sourceKey: string;
  required: boolean;
  maximumAgeSeconds: number | null;
};

export type InstaCompRegistryIdentityReceipt = {
  identityId: string;
  fingerprint: string;
  lockedAt: string;
  schemaVersion: string;
};

export type InstaCompResearchSubject = {
  kind: "scan" | "inventory_item" | "collectible" | "player" | "release";
  subjectId: string;
  displayLabel: string;
  registryIdentity: InstaCompRegistryIdentityReceipt | null;
};

export type InstaCompRecommendation = {
  recommendationType:
    | "price"
    | "listing_content"
    | "buy_pass"
    | "reprice"
    | "review"
    | "research_summary";
  summary: string;
  confidence: number;
  proposedValue: unknown;
  sellerApprovalRequired: true;
  executableByInstaComp: false;
};

export type InstaCompResearchAuditReceipt = {
  requestId: string;
  producer: string;
  inputHash: string;
  outputHash: string | null;
  createdAt: string;
};

export type InstaCompResearchJobV1 = {
  schemaVersion: typeof INSTACOMP_RESEARCH_JOB_SCHEMA_VERSION;
  jobId: string;
  requestId: string;
  sellerId: string;
  storeId: string;
  capability: InstaCompCapability;
  subject: InstaCompResearchSubject;
  requestedSources: InstaCompResearchSourceRequest[];
  status: InstaCompResearchJobStatus;
  startedAt: string | null;
  completedAt: string | null;
  evidence: InstaCompEvidenceReceiptV1[];
  recommendation: InstaCompRecommendation | null;
  confidence: number | null;
  blockers: string[];
  failureCode: string | null;
  failureDetail: string | null;
  auditReceipt: InstaCompResearchAuditReceipt;
};

export function assertInstaCompResearchJob(
  job: InstaCompResearchJobV1,
): InstaCompResearchJobV1 {
  if (job.schemaVersion !== INSTACOMP_RESEARCH_JOB_SCHEMA_VERSION) {
    throw new Error("Unsupported InstaComp research-job schema version.");
  }
  for (const [label, value] of [
    ["job ID", job.jobId],
    ["request ID", job.requestId],
    ["seller ID", job.sellerId],
    ["store ID", job.storeId],
  ] as const) {
    if (!value.trim()) throw new Error(`${label} is required.`);
  }
  if (
    job.confidence !== null &&
    (!Number.isFinite(job.confidence) ||
      job.confidence < 0 ||
      job.confidence > 1)
  ) {
    throw new Error("Research confidence must be between zero and one.");
  }
  if (job.status === "failed" && !job.failureCode?.trim()) {
    throw new Error("Failed research jobs require a failure code.");
  }
  if (job.status === "blocked" && job.blockers.length === 0) {
    throw new Error("Blocked research jobs require at least one blocker.");
  }
  if (job.recommendation?.sellerApprovalRequired !== true) {
    throw new Error("InstaComp recommendations always require seller approval.");
  }
  if (job.recommendation?.executableByInstaComp !== false) {
    throw new Error("InstaComp recommendations are never directly executable.");
  }
  return job;
}
