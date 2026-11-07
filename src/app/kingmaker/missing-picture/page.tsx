import Link from "next/link";
import { cookies } from "next/headers";
import { GET as getPendingCards } from "../../api/account/seller/instacomp-pending/route";

export const dynamic = "force-dynamic";

type HeldCard = { inventoryItemId?: string; id?: string; title?: string };

export default async function MissingPicturePage() {
  const cookieHeader = (await cookies()).getAll().map((c) => `${c.name}=${c.value}`).join("; ");
  const response = await getPendingCards(
    new Request("http://localhost/api/account/seller/instacomp-pending?queue=missing_picture&folder=pending&surface=kingmaker", {
      headers: cookieHeader ? { cookie: cookieHeader } : undefined,
    }),
  ).catch(() => null);
  const data = response ? await response.json().catch(() => ({})) : {};
  const cards: HeldCard[] = Array.isArray(data.items) ? data.items : [];
  return (
    <main className="mx-auto max-w-6xl px-4 py-8 text-neutral-950">
      <p className="text-xs font-bold uppercase tracking-wider text-neutral-600">KINGMAKER / Hold for later</p>
      <h1 className="mt-2 text-3xl font-black">Missing Picture</h1>
      <p className="mt-3 max-w-3xl text-neutral-700">These cards are parked until you add their original front and back pictures. Nothing in this section can be published or verified automatically.</p>
      <Link href="/kingmaker/pending?queue=verification" className="mt-4 inline-block font-bold underline">Back to Pending Verification</Link>
      {!response?.ok ? <p role="alert" className="mt-5 font-semibold text-red-700">The Mac inventory is unavailable. Please reload later.</p> : (
        <>
          <p className="mt-5 font-bold">{cards.length} card{cards.length === 1 ? "" : "s"} on hold</p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {cards.map((card) => <article key={String(card.inventoryItemId || card.id)} className="rounded-xl border-2 border-neutral-300 bg-white p-5">
              <p className="text-xs font-bold uppercase text-amber-800">On hold · Missing picture</p>
              <h2 className="mt-2 text-lg font-black">{card.title || "Unnamed card"}</h2>
              <p className="mt-2 font-semibold">Front and back photos needed</p>
              <p className="mt-3 break-all font-mono text-xs text-neutral-600">Card ID: {card.inventoryItemId || card.id}</p>
              <p className="mt-2 text-sm text-neutral-600">Saved for later; no duplicate listing created.</p>
            </article>)}
          </div>
        </>
      )}
    </main>
  );
}
