import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { STORE_BRAND_NAME } from "../lib/legal";
import { configuredSiteOrigin } from "../lib/site-origin";
import "./globals.css";
import Navbar from "./components/Navbar";

export const metadata: Metadata = {
  metadataBase: new URL(configuredSiteOrigin()),
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
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-[#f6f4ef] text-neutral-950">
        <Navbar />
        {children}
      </body>
    </html>
  );
}
