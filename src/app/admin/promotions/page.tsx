import Link from "next/link";
import PromotionsClient from "./PromotionsClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function PromotionsPage() {
  return (
    <main className="min-h-screen bg-neutral-100 px-4 py-6 text-neutral-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-5 flex flex-wrap gap-3">
          <Link
            href="/admin"
            className="rounded-full border border-neutral-300 bg-white px-4 py-2 text-sm font-black text-neutral-950 shadow-sm transition hover:border-neutral-400 hover:bg-neutral-50"
          >
            ← Main Admin
          </Link>
          <Link
            href="/admin/instacomp"
            className="rounded-full border border-neutral-300 bg-white px-4 py-2 text-sm font-black text-neutral-950 shadow-sm transition hover:border-neutral-400 hover:bg-neutral-50"
          >
            InstaComp
          </Link>
        </div>
        <PromotionsClient />
      </div>
    </main>
  );
}
