import { isIP } from "node:net";

function clean(value: unknown) {
  return String(value || "").trim();
}

function configuredHost(value: string | undefined) {
  try {
    return value ? new URL(value).hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

function configuredImageHosts() {
  return new Set(
    [
      configuredHost(process.env.NEXT_PUBLIC_SUPABASE_URL),
      configuredHost(process.env.NEXT_PUBLIC_SITE_URL),
      ...clean(process.env.INSTACOMP_ALLOWED_IMAGE_HOSTS)
        .split(",")
        .map((host) => host.trim().toLowerCase())
        .filter(Boolean),
    ].filter((host): host is string => Boolean(host)),
  );
}

function isEbayImageHost(hostname: string) {
  return hostname === "i.ebayimg.com" || hostname.endsWith(".ebayimg.com");
}

function isForbiddenHostname(hostname: string) {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (!host || isIP(host)) return true;
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".home") ||
    host.endsWith(".lan")
  );
}

export function assertSafeInstaCompRemoteImageUrl(
  value: string,
  options: { ebayOnly?: boolean } = {},
) {
  let url: URL;
  try {
    url = new URL(clean(value));
  } catch {
    throw new Error("Remote image URL was invalid.");
  }

  if (url.protocol !== "https:") {
    throw new Error("Remote image URL must use HTTPS.");
  }
  if (url.username || url.password) {
    throw new Error("Remote image URL must not contain credentials.");
  }
  if (url.port && url.port !== "443") {
    throw new Error("Remote image URL must use the standard HTTPS port.");
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (isForbiddenHostname(hostname)) {
    throw new Error("Remote image host was not allowed.");
  }

  if (options.ebayOnly) {
    if (!isEbayImageHost(hostname)) {
      throw new Error("Competition images must come from the trusted eBay image CDN.");
    }
  } else {
    const allowed = configuredImageHosts();
    if (!isEbayImageHost(hostname) && !allowed.has(hostname)) {
      throw new Error(
        "Remote image host was not configured for InstaComp. Add it to INSTACOMP_ALLOWED_IMAGE_HOSTS.",
      );
    }
  }

  url.hash = "";
  return url.toString();
}

export function sanitizeInstaCompProviderError(value: unknown, fallback = "Provider request failed.") {
  const raw = clean(value) || fallback;
  const sanitized = raw
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+/gi, "Bearer [REDACTED]")
    .replace(/\bsk-(?:proj-)?[A-Za-z0-9_-]{8,}\b/g, "[REDACTED_API_KEY]")
    .replace(
      /((?:api|secret|access)[_\s-]?(?:key|token)\s*(?:is|=|:)?\s*)[A-Za-z0-9._~+\/-]{8,}/gi,
      "$1[REDACTED]",
    )
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (sanitized || fallback).slice(0, 500);
}
