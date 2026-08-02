const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export type AdminMutationSecurityDecision = {
  allowed: boolean;
  code: string | null;
  reason: string | null;
};

export class AdminMutationSecurityError extends Error {
  readonly code: string;
  readonly status = 403;

  constructor(code: string, message: string) {
    super(message);
    this.name = "AdminMutationSecurityError";
    this.code = code;
  }
}

function requestOrigin(request: Request) {
  try {
    return new URL(request.url).origin.toLowerCase();
  } catch {
    return null;
  }
}

function headerOrigin(value: string | null) {
  if (!value) return null;
  try {
    return new URL(value).origin.toLowerCase();
  } catch {
    return null;
  }
}

export function adminMutationSecurityDecision(
  request: Request,
): AdminMutationSecurityDecision {
  const method = String(request.method || "GET").toUpperCase();
  if (SAFE_METHODS.has(method)) {
    return { allowed: true, code: null, reason: null };
  }

  const expectedOrigin = requestOrigin(request);
  if (!expectedOrigin) {
    return {
      allowed: false,
      code: "ADMIN_MUTATION_INVALID_REQUEST_URL",
      reason: "The privileged request URL could not be validated.",
    };
  }

  const fetchSite = String(request.headers.get("sec-fetch-site") || "")
    .trim()
    .toLowerCase();
  if (fetchSite === "cross-site" || fetchSite === "same-site") {
    return {
      allowed: false,
      code: "ADMIN_MUTATION_CROSS_ORIGIN",
      reason:
        "Privileged state changes require an exact same-origin browser request.",
    };
  }

  const originHeader = request.headers.get("origin");
  if (originHeader) {
    const suppliedOrigin = headerOrigin(originHeader);
    if (!suppliedOrigin || suppliedOrigin !== expectedOrigin) {
      return {
        allowed: false,
        code: "ADMIN_MUTATION_ORIGIN_MISMATCH",
        reason:
          "Privileged state changes require an Origin matching the request origin.",
      };
    }
    return { allowed: true, code: null, reason: null };
  }

  const refererHeader = request.headers.get("referer");
  if (refererHeader) {
    const suppliedOrigin = headerOrigin(refererHeader);
    if (!suppliedOrigin || suppliedOrigin !== expectedOrigin) {
      return {
        allowed: false,
        code: "ADMIN_MUTATION_REFERER_MISMATCH",
        reason:
          "Privileged state changes require a Referer matching the request origin.",
      };
    }
    return { allowed: true, code: null, reason: null };
  }

  if (fetchSite === "same-origin") {
    return { allowed: true, code: null, reason: null };
  }

  return {
    allowed: false,
    code: "ADMIN_MUTATION_ORIGIN_PROOF_MISSING",
    reason:
      "Privileged state changes require same-origin request metadata.",
  };
}

export function assertTrustedAdminMutationRequest(request: Request) {
  const decision = adminMutationSecurityDecision(request);
  if (!decision.allowed) {
    throw new AdminMutationSecurityError(
      decision.code || "ADMIN_MUTATION_REJECTED",
      decision.reason || "Privileged state change rejected.",
    );
  }
  return decision;
}
