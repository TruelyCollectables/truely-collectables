import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function TradeSearchPage({
  searchParams,
}: {
  searchParams?: Promise<{
    q?: string;
  }>;
}) {
  const params = await searchParams;
  const query = (params?.q || "").trim();

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <section className="rounded border bg-white p-6">
        <p className="text-sm font-black uppercase tracking-wide text-blue-700">
          TCOS Trade Search
        </p>
        <h1 className="mt-2 text-4xl font-black">Trade For Me on TCOS</h1>
        <p className="mt-3 max-w-3xl text-neutral-600">
          This is the permanent trade-side search target for InstaComp™ card
          identity. As the trading platform comes online, this page will match
          collector wants, trade inventory, completed trades, and TCOS-only
          trade confidence data.
        </p>
      </section>

      <form className="mt-6 grid gap-3 rounded border bg-white p-4 md:grid-cols-[1fr_auto]">
        <input
          type="text"
          name="q"
          defaultValue={query}
          placeholder="Search player, set, card number, parallel..."
          className="rounded border px-4 py-3"
        />
        <button
          type="submit"
          className="rounded bg-blue-700 px-5 py-3 font-bold text-white hover:bg-blue-800"
        >
          Search Trades
        </button>
      </form>

      {query ? (
        <section className="mt-6 rounded border bg-blue-50 p-5">
          <h2 className="text-xl font-black">Saved trade intent</h2>
          <p className="mt-2 text-neutral-700">
            TCOS is ready to search trade inventory for:
          </p>
          <p className="mt-3 rounded bg-white p-3 font-mono text-sm font-bold">
            {query}
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              href={`/shop?q=${encodeURIComponent(query)}`}
              className="rounded border border-neutral-950 bg-white px-4 py-2 font-bold hover:bg-neutral-950 hover:text-white"
            >
              Check Buy Side
            </Link>
            <Link
              href="/account/collector/items"
              className="rounded border border-blue-700 bg-white px-4 py-2 font-bold text-blue-700 hover:bg-blue-700 hover:text-white"
            >
              Open Collection
            </Link>
          </div>
        </section>
      ) : (
        <section className="mt-6 rounded border bg-neutral-50 p-5 text-neutral-700">
          Enter a card search above, or launch this page from InstaComp™ with
          the Trade For Me on TCOS button.
        </section>
      )}
    </main>
  );
}
