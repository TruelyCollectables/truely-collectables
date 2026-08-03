import Link from "next/link";
import LegacyAdminDashboard from "./LegacyAdminDashboard";
import { createAdminSessionValue } from "../../lib/admin-session";
import { addAdminHandoff } from "../../lib/admin-handoff";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminDashboardPage() {
  const handoff = await createAdminSessionValue();
  const kingmakerHref = addAdminHandoff(
    "/admin/market-intel/kingmaker/morning-intelligence",
    handoff,
  );

  return (
    <>
      <LegacyAdminDashboard />
      <Link
        href={kingmakerHref}
        className="fixed bottom-5 right-5 z-50 rounded-full border border-amber-300 bg-neutral-950 px-5 py-3 text-sm font-black text-amber-300 shadow-2xl transition hover:-translate-y-0.5 hover:bg-neutral-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-400"
        title="Open the KINGMAKER Morning Intelligence controlled delivery console."
      >
        KINGMAKER Morning Intelligence
      </Link>
    </>
  );
}
