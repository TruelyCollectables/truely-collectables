import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import GoogleCustomerReviewsBadge from "../components/GoogleCustomerReviewsBadge";
import {
  STORE_ADDRESS_CITY,
  STORE_ADDRESS_COUNTRY,
  STORE_ADDRESS_POSTAL_CODE,
  STORE_ADDRESS_REGION,
  STORE_ADDRESS_STREET,
  STORE_BRAND_NAME,
  STORE_LEGAL_NAME,
  STORE_SUPPORT_EMAIL,
  STORE_SUPPORT_PHONE_E164,
} from "../lib/legal";
import { configuredSiteOrigin } from "../lib/site-origin";
import "./globals.css";
import AccountCardIntakeShortcut from "./components/AccountCardIntakeShortcut";
import AdminInstaCompMobileShortcut from "./components/AdminInstaCompMobileShortcut";
import Footer from "./components/Footer";
import Navbar from "./components/Navbar";
import WholeCardUploadGuard from "./components/WholeCardUploadGuard";

const siteOrigin = configuredSiteOrigin();

export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin),
  title: {
    default: `${STORE_BRAND_NAME} | Sports Cards for Sale`,
    template: `%s | ${STORE_BRAND_NAME}`,
  },
  description:
    "Shop sports cards from Truely Collectables. Search active inventory by player, team, set, sport, rookie, autograph, parallel, grade, or card number and check out securely online.",
  keywords: [
    "sports cards for sale",
    "baseball cards",
    "basketball cards",
    "football cards",
    "hockey cards",
    "rookie cards",
    "autograph cards",
    "graded sports cards",
    "Truely Collectables",
  ],
  alternates: {
    canonical: "/",
  },
  verification: {
    google: process.env.GOOGLE_SITE_VERIFICATION || undefined,
  },
  openGraph: {
    title: `${STORE_BRAND_NAME} | Sports Cards for Sale`,
    description:
      "Search live sports-card inventory and buy securely from Truely Collectables.",
    url: "/",
    siteName: STORE_BRAND_NAME,
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: `${STORE_BRAND_NAME} | Sports Cards for Sale`,
    description:
      "Search live sports-card inventory and buy securely from Truely Collectables.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const organizationJsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: STORE_LEGAL_NAME,
    alternateName: STORE_BRAND_NAME,
    description:
      "Online sports-card and collectibles retailer operating TruelyCollectables.com.",
    url: siteOrigin,
    email: STORE_SUPPORT_EMAIL,
    telephone: STORE_SUPPORT_PHONE_E164,
    address: {
      "@type": "PostalAddress",
      streetAddress: STORE_ADDRESS_STREET,
      addressLocality: STORE_ADDRESS_CITY,
      addressRegion: STORE_ADDRESS_REGION,
      postalCode: STORE_ADDRESS_POSTAL_CODE,
      addressCountry: STORE_ADDRESS_COUNTRY,
    },
    contactPoint: {
      "@type": "ContactPoint",
      contactType: "customer service",
      email: STORE_SUPPORT_EMAIL,
      telephone: STORE_SUPPORT_PHONE_E164,
      availableLanguage: ["English"],
    },
    sameAs: ["https://www.ebay.com/str/truelycollectablessports"],
  };

  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-[#f6f4ef] text-neutral-950">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(organizationJsonLd).replaceAll("<", "\\u003c"),
          }}
        />
        <WholeCardUploadGuard />
        <Navbar />
        <AccountCardIntakeShortcut />
        <AdminInstaCompMobileShortcut />
        {children}
        <Footer />
        <GoogleCustomerReviewsBadge />
      </body>
    </html>
  );
}
