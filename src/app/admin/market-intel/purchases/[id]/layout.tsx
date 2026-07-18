import Link from "next/link";
import { addAdminHandoff } from "../../../../../lib/admin-handoff";
import { createAdminSessionValue } from "../../../../../lib/admin-session";

export default async function PurchaseDetailLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const handoff = await createAdminSessionValue();
  const adminHref = (href: string) => addAdminHandoff(href, handoff);

  return (
    <>
      <nav className="sticky top-0 z-40 border-b border-neutral-300 bg-white/95 px-4 py-3 shadow-sm backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2">
          <Link
            href={adminHref(`/admin/market-intel/purchases/${id}`)}
            className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-black hover:bg-neutral-100"
          >
            Purchase Details
          </Link>
          <Link
            href={adminHref(`/admin/market-intel/purchases/${id}/edit`)}
            className="rounded-md bg-amber-400 px-4 py-2 text-sm font-black text-black hover:bg-amber-300"
          >
            Edit / Correct Purchase
          </Link>
          <Link
            href={adminHref("/admin/market-intel/purchases")}
            className="rounded-md bg-black px-4 py-2 text-sm font-black text-white"
          >
            Purchase Ledger
          </Link>
        </div>
      </nav>
      {children}
    </>
  );
}
