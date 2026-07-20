import Link from "next/link";

export default async function MarketIntelCompIdentityLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <>
      <nav className="border-b border-neutral-300 bg-white px-6 py-3">
        <div className="mx-auto flex max-w-7xl flex-wrap gap-2">
          <Link
            href={`/admin/market-intel/comps/${id}`}
            className="rounded-md border border-neutral-300 bg-neutral-950 px-4 py-2 text-sm font-black text-white hover:bg-black"
          >
            VERIFIED SOLD COMPS
          </Link>
          <Link
            href={`/admin/market-intel/comps/${id}/item-price-research`}
            className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-black text-amber-950 hover:bg-amber-100"
          >
            ITEM-ONLY PRICE RESEARCH
          </Link>
        </div>
      </nav>
      {children}
    </>
  );
}
