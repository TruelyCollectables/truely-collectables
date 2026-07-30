export const MAX_LISTING_IMAGES = 20;

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

export function listingImageSide(value: unknown): "front" | "back" | null {
  const cleaned = cleanImageUrl(value);
  if (!cleaned) return null;

  let pathname = cleaned;
  try {
    pathname = new URL(cleaned).pathname;
  } catch {
    pathname = cleaned.split(/[?#]/, 1)[0];
  }

  const match = /(?:^|[-_/])(front|back)(?=\.[a-z0-9]+$)/i.exec(pathname);
  if (!match?.[1]) return null;
  return match[1].toLowerCase() === "back" ? "back" : "front";
}

export function companionBackListingImageUrl(value: unknown) {
  const cleaned = cleanImageUrl(value);
  if (!cleaned || listingImageSide(cleaned) !== "front") return "";

  try {
    const url = new URL(cleaned);
    const replaced = url.pathname.replace(
      /(^|[-_/])front(?=\.[a-z0-9]+$)/i,
      "$1back",
    );
    if (replaced === url.pathname) return "";
    url.pathname = replaced;
    return url.toString();
  } catch {
    return cleaned.replace(
      /(^|[-_/])front(?=\.[a-z0-9]+(?:[?#].*)?$)/i,
      "$1back",
    );
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

export function selectFrontBackListingImages(values: unknown[]) {
  const normalized = normalizeListingImageUrls(values);
  if (normalized.length <= 1) return normalized;

  const front = normalized[0];
  const remaining = normalized.slice(1);
  const explicitBack = remaining.find(
    (image) => listingImageSide(image) === "back",
  );
  const secondEbay = remaining.find((image) =>
    listingImageIdentity(image).startsWith("ebay:"),
  );
  const neutralDetail = remaining.find(
    (image) => listingImageSide(image) !== "front",
  );
  const back = explicitBack || secondEbay || neutralDetail;

  return back ? [front, back] : [front];
}

export function listingImageLabel(index: number) {
  if (index === 0) return "front";
  if (index === 1) return "back";
  return `detail ${index + 1}`;
}

export function listingImageAltText(title: string, index: number) {
  return `${title} ${listingImageLabel(index)}`;
}
