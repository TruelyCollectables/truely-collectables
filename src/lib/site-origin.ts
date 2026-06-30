const DEFAULT_SITE_ORIGIN = "https://truely-collectables.vercel.app";

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

export function configuredSiteOrigin() {
  return (
    normalizeOrigin(process.env.NEXT_PUBLIC_SITE_URL) ||
    normalizeOrigin(process.env.SITE_URL) ||
    DEFAULT_SITE_ORIGIN
  );
}

export function trustedRequestOrigin(request: Request) {
  const configuredOrigin = configuredSiteOrigin();
  const requestOrigin = normalizeOrigin(request.headers.get("origin"));

  if (!requestOrigin) return configuredOrigin;
  if (requestOrigin === configuredOrigin) return requestOrigin;

  if (process.env.NODE_ENV !== "production" && isLocalOrigin(requestOrigin)) {
    return requestOrigin;
  }

  return configuredOrigin;
}
