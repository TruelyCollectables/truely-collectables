import { DEPLOY_SAFETY } from "./deploy-safety";

function normalizeOrigin(value: string | null | undefined) {
  const text = String(value || "").trim();

  if (!text) return null;

  try {
    return new URL(text).origin;
  } catch {
    return null;
  }
}

function isLocalOrigin(origin: string) {
  try {
    const hostname = new URL(origin).hostname;
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1"
    );
  } catch {
    return false;
  }
}

function isVercelOrigin(origin: string) {
  try {
    return new URL(origin).hostname.toLowerCase().endsWith(".vercel.app");
  } catch {
    return false;
  }
}

export function configuredSiteOrigin() {
  const configuredOrigin =
    normalizeOrigin(process.env.NEXT_PUBLIC_SITE_URL) ||
    normalizeOrigin(process.env.SITE_URL);

  // Public SEO surfaces must always point at the owned store domain. An old
  // Vercel alias in Production caused every sitemap URL to be rejected by
  // Google Search Console as outside the submitted sitemap property.
  if (configuredOrigin && !isVercelOrigin(configuredOrigin)) {
    return configuredOrigin;
  }

  return DEPLOY_SAFETY.cleanProductionDomain;
}

export function trustedRequestOrigin(request: Request) {
  const configuredOrigin = configuredSiteOrigin();
  const requestOrigin = normalizeOrigin(request.headers.get("origin"));

  if (!requestOrigin) return configuredOrigin;
  if (requestOrigin === configuredOrigin) return requestOrigin;

  // Keep Vercel preview deployments usable without allowing a preview alias
  // to become the canonical public store origin.
  if (process.env.VERCEL_ENV === "preview" && isVercelOrigin(requestOrigin)) {
    return requestOrigin;
  }

  if (process.env.NODE_ENV !== "production" && isLocalOrigin(requestOrigin)) {
    return requestOrigin;
  }

  return configuredOrigin;
}
