import type { MetadataRoute } from "next";
import { configuredSiteOrigin } from "../lib/site-origin";

export default function robots(): MetadataRoute.Robots {
  const origin = configuredSiteOrigin();

  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/shop", "/product/"],
      disallow: [
        "/account/",
        "/admin/",
        "/api/",
        "/cart",
        "/seller/",
        "/success",
      ],
    },
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  };
}
