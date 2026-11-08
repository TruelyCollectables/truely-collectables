import { createHash, timingSafeEqual } from "node:crypto";

export type KingmakerActionKind = "buy" | "offer" | "watch" | "research" | "reject";
export type KingmakerActionState = "proposed" | "authorized" | "executing" | "succeeded" | "failed" | "cancelled" | "expired";

export type KingmakerActionProposal = {
  actionId: string;
  decisionFingerprint: string;
  entityKey: string;
  source: string;
  action: KingmakerActionKind;
  amount?: number | null;
  currency?: string | null;
  sourceUrl?: string | null;
  proposedAt: string;
  expiresAt: string;
  riskScore: number;
  confidence: number;
  expectedProfit?: number | null;
  expectedRoiPercent?: number | null;
};

export type KingmakerOwnerAuthorization = {
  actionId: string;
  ownerId: string;
  authorizedAt: string;
  expiresAt: string;
  nonce: string;
  signature: string;
};

export type KingmakerActionTransition = {
  actionId: string;
  from: KingmakerActionState;
  to: KingmakerActionState;
  occurredAt: string;
  reason: string;
  fingerprint: string;
};

export type KingmakerAuthorizedAction = {
  proposal: KingmakerActionProposal;
  authorization: KingmakerOwnerAuthorization;
  state: "authorized";
  authorizationFingerprint: string;
};

const allowedTransitions: Record<KingmakerActionState, KingmakerActionState[]> = {
  proposed: ["authorized", "cancelled", "expired"],
  authorized: ["executing", "cancelled", "expired"],
  executing: ["succeeded", "failed"],
  succeeded: [],
  failed: [],
  cancelled: [],
  expired: [],
};

function parseTime(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label}_invalid`);
  return parsed;
}

function fixedCurrency(value: string | null | undefined): string | null {
  if (value == null) return null;
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) throw new Error("currency_invalid");
  return normalized;
}

function safeUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("source_url_unsafe");
  return parsed.toString();
}

function canonicalProposal(proposal: KingmakerActionProposal) {
  return {
    ...proposal,
    amount: proposal.amount == null ? null : Number(proposal.amount.toFixed(2)),
    currency: fixedCurrency(proposal.currency),
    sourceUrl: safeUrl(proposal.sourceUrl),
    riskScore: Number(proposal.riskScore.toFixed(4)),
    confidence: Number(proposal.confidence.toFixed(4)),
    expectedProfit: proposal.expectedProfit == null ? null : Number(proposal.expectedProfit.toFixed(2)),
    expectedRoiPercent: proposal.expectedRoiPercent == null ? null : Number(proposal.expectedRoiPercent.toFixed(2)),
  };
}

export function validateKingmakerActionProposal(proposal: KingmakerActionProposal, now = new Date()): KingmakerActionProposal {
  if (!proposal.actionId.trim()) throw new Error("action_id_required");
  if (!proposal.decisionFingerprint.trim()) throw new Error("decision_fingerprint_required");
  if (!proposal.entityKey.trim()) throw new Error("entity_key_required");
  if (!proposal.source.trim()) throw new Error("source_required");
  if (proposal.riskScore < 0 || proposal.riskScore > 100) throw new Error("risk_score_invalid");
  if (proposal.confidence < 0 || proposal.confidence > 1) throw new Error("confidence_invalid");
  if ((proposal.action === "buy" || proposal.action === "offer") && !(proposal.amount && proposal.amount > 0)) {
    throw new Error("money_required_for_execution_action");
  }
  const proposedAt = parseTime(proposal.proposedAt, "proposed_at");
  const expiresAt = parseTime(proposal.expiresAt, "expires_at");
  if (expiresAt <= proposedAt) throw new Error("proposal_expiration_invalid");
  if (expiresAt <= now.getTime()) throw new Error("proposal_expired");
  if (proposal.action === "buy" || proposal.action === "offer") {
    if (proposal.riskScore >= 70) throw new Error("risk_too_high_for_execution");
    if (proposal.confidence < 0.7) throw new Error("confidence_too_low_for_execution");
    if ((proposal.expectedProfit ?? 0) <= 0) throw new Error("positive_profit_required");
    if ((proposal.expectedRoiPercent ?? 0) <= 0) throw new Error("positive_roi_required");
  }
  return canonicalProposal(proposal);
}

export function buildKingmakerAuthorizationPayload(input: {
  proposal: KingmakerActionProposal;
  ownerId: string;
  authorizedAt: string;
  expiresAt: string;
  nonce: string;
}): string {
  const proposal = canonicalProposal(input.proposal);
  return JSON.stringify({
    actionId: proposal.actionId,
    decisionFingerprint: proposal.decisionFingerprint,
    entityKey: proposal.entityKey,
    source: proposal.source,
    action: proposal.action,
    amount: proposal.amount ?? null,
    currency: proposal.currency ?? null,
    ownerId: input.ownerId,
    authorizedAt: input.authorizedAt,
    expiresAt: input.expiresAt,
    nonce: input.nonce,
  });
}

export function signKingmakerOwnerAuthorization(input: {
  proposal: KingmakerActionProposal;
  ownerId: string;
  authorizedAt: string;
  expiresAt: string;
  nonce: string;
  secret: string;
}): KingmakerOwnerAuthorization {
  if (input.secret.length < 32) throw new Error("authorization_secret_too_short");
  const payload = buildKingmakerAuthorizationPayload(input);
  const signature = createHash("sha256").update(`${input.secret}:${payload}`).digest("hex");
  return {
    actionId: input.proposal.actionId,
    ownerId: input.ownerId,
    authorizedAt: input.authorizedAt,
    expiresAt: input.expiresAt,
    nonce: input.nonce,
    signature,
  };
}

export function authorizeKingmakerAction(input: {
  proposal: KingmakerActionProposal;
  authorization: KingmakerOwnerAuthorization;
  secret: string;
  now?: Date;
  usedNonces?: ReadonlySet<string>;
}): KingmakerAuthorizedAction {
  const now = input.now ?? new Date();
  const proposal = validateKingmakerActionProposal(input.proposal, now);
  const authorization = input.authorization;
  if (authorization.actionId !== proposal.actionId) throw new Error("authorization_action_mismatch");
  if (!authorization.ownerId.trim()) throw new Error("owner_id_required");
  if (!authorization.nonce.trim()) throw new Error("authorization_nonce_required");
  if (input.usedNonces?.has(authorization.nonce)) throw new Error("authorization_nonce_replayed");
  const authorizedAt = parseTime(authorization.authorizedAt, "authorized_at");
  const authorizationExpiresAt = parseTime(authorization.expiresAt, "authorization_expires_at");
  if (authorizedAt > now.getTime() + 60_000) throw new Error("authorization_from_future");
  if (authorizationExpiresAt <= now.getTime()) throw new Error("authorization_expired");
  if (authorizationExpiresAt > parseTime(proposal.expiresAt, "proposal_expires_at")) {
    throw new Error("authorization_outlives_proposal");
  }
  const expected = signKingmakerOwnerAuthorization({
    proposal,
    ownerId: authorization.ownerId,
    authorizedAt: authorization.authorizedAt,
    expiresAt: authorization.expiresAt,
    nonce: authorization.nonce,
    secret: input.secret,
  }).signature;
  const expectedBuffer = Buffer.from(expected, "hex");
  const actualBuffer = Buffer.from(authorization.signature, "hex");
  if (expectedBuffer.length !== actualBuffer.length || !timingSafeEqual(expectedBuffer, actualBuffer)) {
    throw new Error("authorization_signature_invalid");
  }
  const authorizationFingerprint = createHash("sha256")
    .update(JSON.stringify({ proposal, authorization }))
    .digest("hex");
  return { proposal, authorization, state: "authorized", authorizationFingerprint };
}

export function transitionKingmakerAction(input: {
  actionId: string;
  from: KingmakerActionState;
  to: KingmakerActionState;
  occurredAt: string;
  reason: string;
}): KingmakerActionTransition {
  if (!allowedTransitions[input.from].includes(input.to)) throw new Error("action_transition_invalid");
  parseTime(input.occurredAt, "transition_time");
  if (!input.reason.trim()) throw new Error("transition_reason_required");
  const canonical = { ...input, reason: input.reason.trim() };
  return {
    ...canonical,
    fingerprint: createHash("sha256").update(JSON.stringify(canonical)).digest("hex"),
  };
}

export function summarizeKingmakerActionQueue(proposals: KingmakerActionProposal[], now = new Date()) {
  const accepted: KingmakerActionProposal[] = [];
  const rejected: Array<{ actionId: string; reason: string }> = [];
  for (const proposal of proposals) {
    try {
      accepted.push(validateKingmakerActionProposal(proposal, now));
    } catch (error) {
      rejected.push({ actionId: proposal.actionId, reason: error instanceof Error ? error.message : "unknown_error" });
    }
  }
  return {
    received: proposals.length,
    accepted,
    rejected,
    executable: accepted.filter((proposal) => proposal.action === "buy" || proposal.action === "offer").length,
    fingerprint: createHash("sha256")
      .update(JSON.stringify({ accepted, rejected }))
      .digest("hex"),
  };
}
