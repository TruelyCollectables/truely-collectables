import Link from "next/link";
import SalesClient from "./SalesClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function SalesPage() {
  return (
    <main className="min-h-screen bg-neutral-100 px-4 py-6 text-neutral-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-5 flex flex-wrap gap-3">
          <Link href="/admin" className="rounded-full border border-neutral-300 bg-white px-4 py-2 text-sm font-black shadow-sm hover:bg-neutral-50">← Main Admin</Link>
          <Link href="/admin/promotions" className="rounded-full border border-neutral-300 bg-white px-4 py-2 text-sm font-black shadow-sm hover:bg-neutral-50">Coupons</Link>
        </div>
        <SalesClient />
      </div>
    </main>
  );
}
