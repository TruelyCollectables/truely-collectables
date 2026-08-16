export type ListingChannel =
  | "draft"
  | "site_only"
  | "ebay_only"
  | "site_and_ebay"
  | "off_market";

export function isSiteLive(status: string | null | undefined, quantity: number) {
  return String(status || "").toLowerCase() === "active" && Number(quantity || 0) > 0;
}

export function isEbayLive(
  ebayItemId: string | null | undefined,
  quantity: number,
) {
  return Boolean(String(ebayItemId || "").trim()) && Number(quantity || 0) > 0;
}

export function deriveListingChannel(params: {
  status: string | null | undefined;
  quantity: number;
  ebayItemId: string | null | undefined;
}): ListingChannel {
  const quantity = Math.max(0, Number(params.quantity || 0));
  const siteLive = isSiteLive(params.status, quantity);
  const ebayLive = isEbayLive(params.ebayItemId, quantity);

  if (siteLive && ebayLive) return "site_and_ebay";
  if (siteLive) return "site_only";
  if (ebayLive) return "ebay_only";
  if (quantity <= 0 || ["sold", "archived"].includes(String(params.status || ""))) {
    return "off_market";
  }
  return "draft";
}

export function listingChannelLabel(channel: ListingChannel) {
  switch (channel) {
    case "site_and_ebay":
      return "Site + eBay";
    case "site_only":
      return "Site only";
    case "ebay_only":
      return "eBay only";
    case "off_market":
      return "Off market";
    default:
      return "Draft / unlisted";
  }
}

export function recommendedEbayPrice(sitePrice: number, markupPercent = 10) {
  const site = Math.max(0, Number(sitePrice || 0));
  const markup = Math.max(0, Number(markupPercent || 0));
  if (!site) return 0;

  const markedUp = Math.round(site * (1 + markup / 100) * 100) / 100;
  return Math.max(markedUp, Math.round((site + 0.01) * 100) / 100);
}

export function directPriceAdvantage(sitePrice: number, ebayPrice: number) {
  const site = Number(sitePrice || 0);
  const ebay = Number(ebayPrice || 0);
  if (!(site > 0) || !(ebay > 0)) return null;

  const dollars = Math.round((ebay - site) * 100) / 100;
  const percent = ebay > 0 ? Math.round((dollars / ebay) * 1000) / 10 : 0;

  return {
    dollars,
    percent,
    isAdvantaged: dollars > 0,
  };
}
