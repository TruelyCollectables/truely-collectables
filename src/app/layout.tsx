import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import {
  STORE_BRAND_NAME,
  STORE_LEGAL_NAME,
  STORE_SUPPORT_EMAIL,
} from "../lib/legal";
import { configuredSiteOrigin } from "../lib/site-origin";
import "./globals.css";
import AccountCardIntakeShortcut from "./components/AccountCardIntakeShortcut";
import AdminInstaCompMobileShortcut from "./components/AdminInstaCompMobileShortcut";
import Navbar from "./components/Navbar";
import Footer from "./components/Footer";

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
    url: siteOrigin,
    email: STORE_SUPPORT_EMAIL,
    sameAs: [],
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
        <Navbar />
        <AccountCardIntakeShortcut />
        <AdminInstaCompMobileShortcut />
        {children}
        <Footer />
      </body>
    </html>
  );
}
