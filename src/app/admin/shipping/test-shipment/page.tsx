import Link from "next/link";
import ControlledTestShipment from "./ControlledTestShipment";

export const dynamic = "force-dynamic";

export default function ControlledTestShipmentPage() {
  return (
    <main className="min-h-screen bg-neutral-50 px-6 py-8 text-neutral-950">
      <div className="mx-auto max-w-5xl space-y-6">
        <section className="rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Shipping validation</p>
              <h1 className="mt-2 text-3xl font-black tracking-tight">Controlled 1 oz Test Shipment</h1>
              <p className="mt-3 max-w-3xl text-sm font-semibold leading-6 text-neutral-600">
                Send one real test card to any US address without creating a fake customer order. Quote first with no purchase, then explicitly authorize one capped ShipStation API postage transaction and print the returned PDF from TruelyCollectables.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href="/admin/shipping/shipstation-test" className="rounded-2xl border border-neutral-300 bg-white px-4 py-2 text-sm font-black hover:bg-neutral-50">
                ShipStation Diagnostic
              </Link>
              <Link href="/admin/shipping" className="rounded-2xl border border-neutral-300 bg-white px-4 py-2 text-sm font-black hover:bg-neutral-50">
                Shipping Operations
              </Link>
            </div>
          </div>
        </section>

        <ControlledTestShipment />
      </div>
    </main>
  );
}
