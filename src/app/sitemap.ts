import type { MetadataRoute } from "next";
import { BUYER_PROTECTION_PATH } from "../lib/buyer-protection";
import {
  CONTACT_PATH,
  PRIVACY_POLICY_PATH,
  RETURNS_POLICY_PATH,
  SHIPPING_POLICY_PATH,
  TERMS_OF_SERVICE_PATH,
} from "../lib/legal";
import { configuredSiteOrigin } from "../lib/site-origin";
import { createServerInventoryEngine } from "../lib/server-inventory-engine";

export const dynamic = "force-dynamic";
export const revalidate = 300;

// Next.js 16.2's sitemap serializer interpolates URL fields directly into XML.
// Escape URLs here so query strings (especially image URLs containing &) remain valid XML.
function xmlSafeUrl(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function absoluteUrl(origin: string, value: string | null | undefined) {
  if (!value) return null;

  try {
    return new URL(value, origin).toString();
  } catch {
    return null;
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = configuredSiteOrigin();
  const now = new Date();
  const staticRoutes: MetadataRoute.Sitemap = [
    {
      url: xmlSafeUrl(origin),
      lastModified: now,
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: xmlSafeUrl(`${origin}/shop`),
      lastModified: now,
      changeFrequency: "hourly",
      priority: 0.9,
    },
    ...[
      TERMS_OF_SERVICE_PATH,
      PRIVACY_POLICY_PATH,
      SHIPPING_POLICY_PATH,
      BUYER_PROTECTION_PATH,
      RETURNS_POLICY_PATH,
      CONTACT_PATH,
    ].map((path) => ({
      url: xmlSafeUrl(`${origin}${path}`),
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.4,
    })),
  ];

  const inventoryEngine = createServerInventoryEngine();
  let products: Awaited<ReturnType<typeof inventoryEngine.listAvailable>> = [];

  try {
    products = await inventoryEngine.listAvailable();
  } catch (error) {
    console.error("Could not build product sitemap entries", error);
  }

  const productRoutes = products
    .filter((product) => product.quantity > 0 && product.status === "active")
    .map((product) => {
      const image = absoluteUrl(origin, product.imageUrl);

      return {
        url: xmlSafeUrl(`${origin}/product/${product.legacyProductId}`),
        lastModified: now,
        changeFrequency: "daily" as const,
        priority: 0.8,
        images: image ? [xmlSafeUrl(image)] : undefined,
      };
    });

  return [...staticRoutes, ...productRoutes];
}
