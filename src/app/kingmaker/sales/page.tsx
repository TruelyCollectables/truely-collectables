import SalesClient from "../../admin/sales/SalesClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Kingmaker operators use the same authenticated sale engine as TCOS Admin.
export default function KingmakerSalesPage() {
  return (
    <section className="min-w-0 rounded-xl bg-neutral-100 p-4 text-neutral-950 sm:p-6">
      <SalesClient />
    </section>
  );
}
