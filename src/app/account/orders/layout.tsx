import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Your Orders",
  robots: {
    index: false,
    follow: false,
  },
};

export default function BuyerOrdersLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
