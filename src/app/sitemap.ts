import type { MetadataRoute } from "next";
import { configuredSiteOrigin } from "../lib/site-origin";
import { inventoryEngine } from "../modules/inventory";

export const dynamic = "force-dynamic";
export const revalidate = 300;

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
      url: origin,
      lastModified: now,
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: `${origin}/shop`,
      lastModified: now,
      changeFrequency: "hourly",
      priority: 0.9,
    },
  ];

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
        url: `${origin}/product/${product.legacyProductId}`,
        lastModified: now,
        changeFrequency: "daily" as const,
        priority: 0.8,
        images: image ? [image] : undefined,
      };
    });

  return [...staticRoutes, ...productRoutes];
}
