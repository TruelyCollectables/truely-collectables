import {
  adminMutationSecurityDecision,
  type AdminMutationSecurityDecision,
} from "./admin-request-security";
import {
  isValidInstaCompServiceRequest,
  type InstaCompJobActor,
} from "./instacomp-job-server";

export type InstaCompMutationChannel =
  | "service_token"
  | "seller_bearer"
  | "admin_same_origin";

export type InstaCompMutationSecurityDecision = {
  allowed: boolean;
  channel: InstaCompMutationChannel | null;
  code: string | null;
  reason: string | null;
};

export class InstaCompMutationSecurityError extends Error {
  readonly code: string;
  readonly status = 403;

  constructor(code: string, message: string) {
    super(message);
    this.name = "InstaCompMutationSecurityError";
    this.code = code;
  }
}

function bearerCredential(request: Request) {
  const authorization = String(request.headers.get("authorization") || "").trim();
  return /^Bearer\s+\S+$/i.test(authorization);
}

function denied(
  code: string,
  reason: string,
): InstaCompMutationSecurityDecision {
  return { allowed: false, channel: null, code, reason };
}

function fromAdminDecision(
  decision: AdminMutationSecurityDecision,
): InstaCompMutationSecurityDecision {
  return decision.allowed
    ? {
        allowed: true,
        channel: "admin_same_origin",
        code: null,
        reason: null,
      }
    : denied(
        decision.code || "INSTACOMP_ADMIN_MUTATION_REJECTED",
        decision.reason || "Privileged InstaComp mutation rejected.",
      );
}

export function instaCompMutationSecurityDecision(params: {
  request: Request;
  actor: InstaCompJobActor;
  expectedServiceToken?: string | null;
}): InstaCompMutationSecurityDecision {
  const expectedServiceToken =
    params.expectedServiceToken === undefined
      ? undefined
      : String(params.expectedServiceToken || "");
  const serviceRequest =
    expectedServiceToken === undefined
      ? isValidInstaCompServiceRequest(params.request)
      : isValidInstaCompServiceRequest(params.request, expectedServiceToken);

  if (serviceRequest) {
    if (params.actor.type !== "admin") {
      return denied(
        "INSTACOMP_SERVICE_ACTOR_MISMATCH",
        "The internal InstaComp service credential did not resolve to the expected service actor.",
      );
    }
    return {
      allowed: true,
      channel: "service_token",
      code: null,
      reason: null,
    };
  }

  if (params.actor.type === "seller") {
    if (!bearerCredential(params.request)) {
      return denied(
        "INSTACOMP_SELLER_BEARER_REQUIRED",
        "Seller InstaComp mutations require an authenticated bearer token.",
      );
    }
    return {
      allowed: true,
      channel: "seller_bearer",
      code: null,
      reason: null,
    };
  }

  return fromAdminDecision(adminMutationSecurityDecision(params.request));
}

export function assertTrustedInstaCompMutationRequest(params: {
  request: Request;
  actor: InstaCompJobActor;
  expectedServiceToken?: string | null;
}) {
  const decision = instaCompMutationSecurityDecision(params);
  if (!decision.allowed) {
    throw new InstaCompMutationSecurityError(
      decision.code || "INSTACOMP_MUTATION_REJECTED",
      decision.reason || "InstaComp mutation rejected.",
    );
  }
  return decision;
}
