import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Create Buyer Account",
  alternates: {
    canonical: "/account/signup",
  },
  robots: {
    index: false,
    follow: false,
  },
};

export default function AccountSignupLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
