const TRUSTED_EBAY_IMAGE_HOSTS = [
  "ebayimg.com",
  "ebaystatic.com",
] as const;

function trustedHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return TRUSTED_EBAY_IMAGE_HOSTS.some(
    (root) => normalized === root || normalized.endsWith(`.${root}`),
  );
}

export function normalizeSellerSweepImageUrl(value: unknown) {
  const input = String(value || "").trim();
  if (!input || input.length > 2_048) return null;

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }

  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (url.port && url.port !== "443") return null;
  if (!trustedHostname(url.hostname)) return null;
  if (!url.pathname || url.pathname === "/") return null;

  url.hash = "";
  return url.toString();
}

export function requireTrustedSellerSweepImageUrl(value: unknown) {
  const normalized = normalizeSellerSweepImageUrl(value);
  if (!normalized) {
    throw new Error(
      "Seller Sweep image URL is not a trusted HTTPS eBay image resource.",
    );
  }
  return normalized;
}

export function trustedSellerSweepImageUrls(
  value: unknown,
  maximum: number,
) {
  const source = Array.isArray(value) ? value : [];
  const normalized = source
    .map(normalizeSellerSweepImageUrl)
    .filter((item): item is string => Boolean(item));
  return [...new Set(normalized)].slice(0, Math.max(0, maximum));
}

export const sellerSweepTrustedImageRoots = [
  ...TRUSTED_EBAY_IMAGE_HOSTS,
];
