import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import {
  ADMIN_SESSION_COOKIE_NAMES,
  isValidAdminSessionValue,
} from "../../lib/admin-session";
import KingmakerShell from "./KingmakerShell";

export const metadata: Metadata = {
  title: "KINGMAKER | Truely Collectables",
  description:
    "Seller operations powered by direct front/back InstaComp vision and seller verification.",
};

export default async function KingmakerLayout({
  children,
}: {
  children: ReactNode;
}) {
  const cookieStore = await cookies();
  for (const name of ADMIN_SESSION_COOKIE_NAMES) {
    if (await isValidAdminSessionValue(cookieStore.get(name)?.value)) {
      return <KingmakerShell adminAuthenticated>{children}</KingmakerShell>;
    }
  }

  redirect(`/admin/login?next=${encodeURIComponent("/kingmaker")}`);
}
