import Link from "next/link";
import { createAdminSessionValue } from "../../../../lib/admin-session";
import EbayInventoryIntakeClient from "./EbayInventoryIntakeClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function adminHref(href: string, handoff: string) {
  if (!href.startsWith("/admin")) return href;

  const [path, query = ""] = href.split("?", 2);
  const params = new URLSearchParams(query);
  params.set("admin_handoff", handoff);
  return `${path}?${params.toString()}`;
}

export default async function EbayInventoryIntakePage() {
  const adminHandoff = await createAdminSessionValue();

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(245,158,11,0.15),_transparent_34%),linear-gradient(180deg,_#faf7ef_0%,_#f4f1ea_42%,_#eee7da_100%)] px-4 py-6 text-neutral-950 sm:px-6 lg:px-8">
      <section className="mx-auto max-w-[1500px] overflow-hidden rounded-[2rem] border border-neutral-900 bg-neutral-950 text-white shadow-2xl shadow-neutral-950/10">
        <div className="flex flex-col gap-5 border-b border-white/10 bg-[radial-gradient(circle_at_top_right,_rgba(245,158,11,0.22),_transparent_32%),linear-gradient(135deg,_rgba(255,255,255,0.08),_transparent)] p-6 lg:flex-row lg:items-end lg:justify-between lg:p-8">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-amber-300">
              Simple Intake
            </p>
            <h1 className="mt-2 text-4xl font-black tracking-tight">
              eBay Inventory Intake
            </h1>
            <p className="mt-2 max-w-3xl text-sm font-semibold text-neutral-300">
              One clean working table: review what is for sale, select rows,
              push good listings live, and send problem rows to InstaComp™.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <HeaderLink href={adminHref("/admin", adminHandoff)} label="Command Center" />
            <HeaderLink
              href={adminHref("/admin/ebay/import-runner", adminHandoff)}
              label="Import More"
              primary
            />
            <HeaderLink
              href={adminHref("/admin/ebay/duplicates", adminHandoff)}
              label="Duplicates"
            />
            <HeaderLink
              href={adminHref("/admin/instacomp", adminHandoff)}
              label="InstaComp™"
            />
            <HeaderLink href="/shop" label="Shop" />
          </div>
        </div>
      </section>

      <EbayInventoryIntakeClient adminHandoff={adminHandoff} />
    </main>
  );
}

function HeaderLink({
  href,
  label,
  primary,
}: {
  href: string;
  label: string;
  primary?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`rounded-full px-4 py-2 text-sm font-bold shadow-sm transition ${
        primary
          ? "bg-amber-300 text-neutral-950 hover:bg-amber-200"
          : "border border-white/15 bg-white/10 text-white hover:bg-white/15"
      }`}
    >
      {label}
    </Link>
  );
}
