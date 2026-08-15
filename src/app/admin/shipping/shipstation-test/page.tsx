import Link from "next/link";
import ShipStationConnectionTest from "./ShipStationConnectionTest";

export const dynamic = "force-dynamic";

export default function ShipStationTestPage() {
  return (
    <main className="min-h-screen bg-neutral-50 px-6 py-8 text-neutral-950">
      <div className="mx-auto max-w-5xl space-y-6">
        <section className="rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-sky-700">
                Shipping provider setup
              </p>
              <h1 className="mt-2 text-3xl font-black tracking-tight">
                ShipStation Connection Test
              </h1>
              <p className="mt-3 max-w-3xl text-sm font-semibold leading-6 text-neutral-600">
                Authenticate the configured ShipStation API key, inspect connected
                carrier IDs, and verify the USPS service codes TCOS needs for
                First-Class Letter, Ground Advantage, and Priority Mail.
              </p>
            </div>
            <Link
              href="/admin/shipping"
              className="rounded-2xl border border-neutral-300 bg-white px-4 py-2 text-sm font-black hover:bg-neutral-50"
            >
              Back to Shipping
            </Link>
          </div>

          <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold leading-6 text-emerald-950">
            This diagnostic uses ShipStation read-only carrier/service GET requests.
            It never calls the label-purchase endpoint and cannot buy postage.
          </div>
        </section>

        <section className="rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm">
          <ShipStationConnectionTest />
        </section>
      </div>
    </main>
  );
}
