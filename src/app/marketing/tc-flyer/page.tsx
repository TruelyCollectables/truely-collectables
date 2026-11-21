"use client";

const cards = Array.from({ length: 4 });

export default function TruelyCollectablesFlyerPage() {
  return (
    <main className="min-h-screen bg-neutral-200 p-6 text-neutral-950 print:bg-white print:p-0">
      <div className="mx-auto mb-5 flex max-w-5xl items-center justify-between print:hidden">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-700">TC marketing</p>
          <h1 className="text-3xl font-black">Print flyer - four per sheet</h1>
          <p className="mt-1 text-sm font-semibold text-neutral-600">Print at 100% scale, then cut on the grid.</p>
        </div>
        <button type="button" onClick={() => window.print()} className="rounded-lg bg-neutral-950 px-5 py-3 font-black text-white">Print Flyers</button>
      </div>

      <section className="mx-auto grid max-w-5xl grid-cols-2 gap-4 print:max-w-none print:gap-0">
        {cards.map((_, index) => (
          <article key={index} className="flyer-card relative flex min-h-[4.7in] flex-col justify-between overflow-hidden rounded-2xl border-2 border-neutral-950 bg-white p-7 shadow-lg print:min-h-0 print:h-[5in] print:rounded-none print:p-6 print:shadow-none">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.24em] text-cyan-700">Truely Collectables</p>
              <h2 className="mt-3 text-3xl font-black leading-none">Find the card your collection is missing.</h2>
              <p className="mt-4 text-sm font-bold leading-6 text-neutral-700">
                Real sports cards, live inventory, secure checkout, and careful shipping from our Colorado shop.
              </p>
              <div className="mt-5 grid grid-cols-3 gap-2 text-center text-[10px] font-black uppercase">
                <span className="rounded bg-neutral-100 p-2">Live cards</span>
                <span className="rounded bg-neutral-100 p-2">Secure checkout</span>
                <span className="rounded bg-neutral-100 p-2">Tracking</span>
              </div>
            </div>
            <div>
              <div className="rounded-xl bg-cyan-700 p-4 text-white">
                <p className="text-xs font-black uppercase tracking-[0.16em]">First order offer</p>
                <p className="mt-1 text-2xl font-black">10% off + free shipping</p>
                <p className="mt-1 text-xs font-bold">Use code: TCWELCOME10</p>
              </div>
              <p className="mt-4 text-center text-sm font-black">Shop now: truelycollectables.com</p>
              <p className="mt-1 text-center text-[10px] font-bold text-neutral-500">One redemption per customer and mailing address. While active.</p>
            </div>
          </article>
        ))}
      </section>

      <style jsx global>{`
        @media print {
          @page { size: letter; margin: 0; }
          body { margin: 0; }
          .flyer-card { break-inside: avoid; }
        }
      `}</style>
    </main>
  );
}
