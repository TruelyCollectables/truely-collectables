const MAX_LISTING_IMAGES = 12;

function cleanImageUrl(value: unknown) {
  return String(value || "").trim();
}

export function preferHighResolutionListingImage(value: unknown) {
  const cleaned = cleanImageUrl(value);
  if (!cleaned) return "";

  return cleaned.replace(
    /\/s-l\d+\.(jpg|jpeg|png|webp)(\?.*)?$/i,
    "/s-l1600.$1$2",
  );
}

export function listingImageIdentity(value: unknown) {
  const normalized = preferHighResolutionListingImage(value);
  if (!normalized) return "";

  try {
    const url = new URL(normalized);
    const ebayMatch = /^\/images\/g\/([^/]+)\//i.exec(url.pathname);

    if (url.hostname.toLowerCase() === "i.ebayimg.com" && ebayMatch?.[1]) {
      return `ebay:${ebayMatch[1]}`;
    }

    url.hash = "";
    return url.toString();
  } catch {
    return normalized;
  }
}

export function normalizeListingImageUrls(values: unknown[]) {
  const images: string[] = [];
  const identities = new Set<string>();

  for (const value of values) {
    const normalized = preferHighResolutionListingImage(value);
    const identity = listingImageIdentity(normalized);

    if (!normalized || !identity || identities.has(identity)) continue;

    identities.add(identity);
    images.push(normalized);

    if (images.length >= MAX_LISTING_IMAGES) break;
  }

  return images;
}

export function listingImageLabel(index: number) {
  if (index === 0) return "front";
  if (index === 1) return "back";
  return `detail ${index + 1}`;
}

export function listingImageAltText(title: string, index: number) {
  return `${title} ${listingImageLabel(index)}`;
}
