import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { PLATFORM_SOFTWARE_NAME, STORE_BRAND_NAME } from "../lib/legal";
import "./globals.css";
import Navbar from "./components/Navbar";

export const metadata: Metadata = {
  title: STORE_BRAND_NAME,
  description: `${STORE_BRAND_NAME} on ${PLATFORM_SOFTWARE_NAME}: collector-first marketplace for cards, memorabilia, and future collectable categories.`,
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
      <body className="min-h-full flex flex-col bg-[#f6f4ef] text-neutral-950">
        <Navbar />
        {children}
      </body>
    </html>
  );
}
