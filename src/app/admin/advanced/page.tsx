import Link from "next/link";
import LegacyAdminDashboard from "../LegacyAdminDashboard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function AdvancedAdminPage() {
  return (
    <main className="bg-neutral-100 text-neutral-950">
      <div className="border-b border-neutral-300 bg-amber-50 px-4 py-4 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-amber-800">
              Advanced Admin
            </p>
            <p className="mt-1 text-sm font-semibold text-neutral-700">
              The original command center is preserved here for diagnostics and uncommon operations.
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/admin"
              className="rounded-xl border border-neutral-300 bg-white px-4 py-2 text-sm font-black"
            >
              Simple Admin Home
            </Link>
            <Link
              href="/kingmaker"
              className="rounded-xl bg-neutral-950 px-4 py-2 text-sm font-black text-white"
            >
              Open KINGMAKER
            </Link>
          </div>
        </div>
      </div>
      <LegacyAdminDashboard />
    </main>
  );
}
