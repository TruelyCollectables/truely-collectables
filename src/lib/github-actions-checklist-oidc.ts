const GITHUB_OIDC_ISSUER = "https://token.actions.githubusercontent.com";
const CHECKLIST_OIDC_AUDIENCE = "tcos-checklist-registry";
const TRUSTED_REPOSITORY = "TruelyCollectables/truely-collectables";
const TRUSTED_REF = "refs/heads/main";
const TRUSTED_WORKFLOW_REFS = new Set([
  `${TRUSTED_REPOSITORY}/.github/workflows/automatic-checklist-discovery.yml@${TRUSTED_REF}`,
  `${TRUSTED_REPOSITORY}/.github/workflows/automatic-topps-baseball-checklist-discovery.yml@${TRUSTED_REF}`,
]);
const TRUSTED_EVENTS = new Set(["schedule", "workflow_dispatch"]);

type GithubOidcHeader = {
  alg?: string;
  kid?: string;
  typ?: string;
};

export type GithubChecklistOidcClaims = {
  aud?: string | string[];
  exp?: number;
  iat?: number;
  iss?: string;
  nbf?: number;
  repository?: string;
  repository_id?: string;
  repository_owner?: string;
  repository_owner_id?: string;
  ref?: string;
  event_name?: string;
  workflow_ref?: string;
  run_id?: string;
  run_number?: string;
  [key: string]: unknown;
};

type GithubJwk = JsonWebKey & { kid?: string; alg?: string; use?: string };

let discoveryCache: { jwksUri: string; expiresAt: number } | null = null;
let jwksCache: { keys: GithubJwk[]; expiresAt: number } | null = null;

function base64UrlBytes(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodeJson<T>(segment: string): T {
  const bytes = base64UrlBytes(segment);
  const text = new TextDecoder().decode(bytes);
  return JSON.parse(text) as T;
}

function audienceMatches(audience: GithubChecklistOidcClaims["aud"]) {
  return Array.isArray(audience)
    ? audience.includes(CHECKLIST_OIDC_AUDIENCE)
    : audience === CHECKLIST_OIDC_AUDIENCE;
}

async function githubJwksUri() {
  const now = Date.now();
  if (discoveryCache && discoveryCache.expiresAt > now) return discoveryCache.jwksUri;

  const response = await fetch(`${GITHUB_OIDC_ISSUER}/.well-known/openid-configuration`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error("GitHub OIDC discovery failed.");
  const body = (await response.json()) as { issuer?: string; jwks_uri?: string };
  if (body.issuer !== GITHUB_OIDC_ISSUER || !body.jwks_uri) {
    throw new Error("GitHub OIDC discovery response was invalid.");
  }

  discoveryCache = { jwksUri: body.jwks_uri, expiresAt: now + 60 * 60 * 1000 };
  return body.jwks_uri;
}

async function githubJwks(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && jwksCache && jwksCache.expiresAt > now) return jwksCache.keys;

  const response = await fetch(await githubJwksUri(), {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error("GitHub OIDC signing keys could not be loaded.");
  const body = (await response.json()) as { keys?: GithubJwk[] };
  if (!Array.isArray(body.keys) || body.keys.length === 0) {
    throw new Error("GitHub OIDC signing keys were invalid.");
  }

  jwksCache = { keys: body.keys, expiresAt: now + 60 * 60 * 1000 };
  return body.keys;
}

async function signingKey(kid: string) {
  let keys = await githubJwks();
  let jwk = keys.find((candidate) => candidate.kid === kid);
  if (!jwk) {
    keys = await githubJwks(true);
    jwk = keys.find((candidate) => candidate.kid === kid);
  }
  if (!jwk) throw new Error("GitHub OIDC signing key was not found.");
  return crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
}

async function verifyToken(token: string) {
  const segments = token.split(".");
  if (segments.length !== 3) throw new Error("Malformed GitHub OIDC token.");

  const header = decodeJson<GithubOidcHeader>(segments[0]);
  const claims = decodeJson<GithubChecklistOidcClaims>(segments[1]);
  if (header.alg !== "RS256" || !header.kid) {
    throw new Error("Unsupported GitHub OIDC token algorithm.");
  }

  const key = await signingKey(header.kid);
  const verified = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    base64UrlBytes(segments[2]),
    new TextEncoder().encode(`${segments[0]}.${segments[1]}`),
  );
  if (!verified) throw new Error("GitHub OIDC signature verification failed.");

  const now = Math.floor(Date.now() / 1000);
  if (claims.iss !== GITHUB_OIDC_ISSUER) throw new Error("GitHub OIDC issuer mismatch.");
  if (!audienceMatches(claims.aud)) throw new Error("GitHub OIDC audience mismatch.");
  if (typeof claims.exp !== "number" || claims.exp <= now) throw new Error("GitHub OIDC token expired.");
  if (typeof claims.nbf === "number" && claims.nbf > now + 30) throw new Error("GitHub OIDC token is not active.");
  if (claims.repository !== TRUSTED_REPOSITORY) throw new Error("GitHub OIDC repository mismatch.");
  if (claims.repository_owner !== "TruelyCollectables") throw new Error("GitHub OIDC repository owner mismatch.");
  if (claims.ref !== TRUSTED_REF) throw new Error("GitHub OIDC ref mismatch.");
  if (!claims.event_name || !TRUSTED_EVENTS.has(claims.event_name)) throw new Error("GitHub OIDC event is not trusted.");
  if (!claims.workflow_ref || !TRUSTED_WORKFLOW_REFS.has(claims.workflow_ref)) {
    throw new Error("GitHub OIDC workflow is not trusted.");
  }

  return claims;
}

export async function authenticateChecklistDiscoveryAction(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new Error("Checklist discovery action authorization is required.");
  return verifyToken(match[1]);
}
