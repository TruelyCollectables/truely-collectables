import Link from "next/link";
import { addAdminHandoff, ADMIN_HANDOFF_PARAM } from "../../../../lib/admin-handoff";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  searchParams?: Promise<{ [ADMIN_HANDOFF_PARAM]?: string }>;
};

type Workspace = {
  eyebrow: string;
  title: string;
  detail: string;
  href: string;
  action: string;
  tone: "amber" | "cyan" | "neutral";
};

const workspaces: Workspace[] = [
  {
    eyebrow: "Decision History",
    title: "Pricing Receipts",
    detail: "Search, filter, inspect, compare, and export immutable advisory decision receipts.",
    href: "/admin/instacomp/pricing/receipts",
    action: "Open Receipt Desk",
    tone: "cyan",
  },
  {
    eyebrow: "Operating Metrics",
    title: "Pricing Analytics",
    detail: "Track ready rate, review pressure, confidence, sold-comp depth, suggested prices, and estimated profit.",
    href: "/admin/instacomp/pricing/analytics",
    action: "Open Analytics",
    tone: "cyan",
  },
  {
    eyebrow: "Coverage Intelligence",
    title: "Coverage Attack Queue",
    detail: "Rank missing releases, pending checklists, set gaps, and identity gaps by the number of private reference rows each fix can unlock.",
    href: "/admin/instacomp/pricing/coverage",
    action: "Open Coverage Queue",
    tone: "cyan",
  },
  {
    eyebrow: "Economics Control",
    title: "Pricing Profiles",
    detail: "Create from presets, clone, edit, switch defaults, retire safely, and review profile audit history.",
    href: "/admin/instacomp/pricing/profiles",
    action: "Manage Profiles",
    tone: "amber",
  },
  {
    eyebrow: "Capital Planning",
    title: "Bulk Planner",
    detail: "Evaluate up to 100 candidates, enforce buy ceilings, rank opportunities, and export the advisory plan.",
    href: "/admin/instacomp/pricing/bulk-plan",
    action: "Build Bulk Plan",
    tone: "amber",
  },
  {
    eyebrow: "Scenario Lab",
    title: "Profile Comparison",
    detail: "Compare up to ten profile outcomes and identify the strongest advisory scenario without changing inventory.",
    href: "/admin/instacomp/pricing/scenarios",
    action: "Compare Scenarios",
    tone: "amber",
  },
  {
    eyebrow: "Review Operations",
    title: "Exception Queue",
    detail: "Focus on review-required and insufficient-evidence decisions before trusting or exporting recommendations.",
    href: "/admin/instacomp/pricing/review",
    action: "Open Review Queue",
    tone: "neutral",
  },
  {
    eyebrow: "Reusable Workflows",
    title: "Saved Views",
    detail: "Save common receipt filters and operating views for repeatable seller and admin workflows.",
    href: "/admin/instacomp/pricing/views",
    action: "Manage Saved Views",
    tone: "neutral",
  },
  {
    eyebrow: "Audit Trail",
    title: "Profile Activity",
    detail: "Review immutable create, update, clone, default, and retirement events for Pricing Profiles.",
    href: "/admin/instacomp/pricing/audit",
    action: "Open Audit Trail",
    tone: "neutral",
  },
];

export default async function PricingCommandCenterPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const handoff = query?.[ADMIN_HANDOFF_PARAM];

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(245,158,11,0.14),_transparent_34%),linear-gradient(180deg,_#faf7ef_0%,_#f4f1ea_42%,_#eee7da_100%)] px-4 py-6 text-neutral-950 sm:px-6 lg:px-8">
      <section className="mx-auto max-w-[1500px] overflow-hidden rounded-[2rem] border border-neutral-900 bg-neutral-950 text-white shadow-2xl shadow-neutral-950/10">
        <div className="border-b border-white/10 bg-[radial-gradient(circle_at_top_right,_rgba(245,158,11,0.24),_transparent_32%),linear-gradient(135deg,_rgba(255,255,255,0.08),_transparent)] p-6 lg:p-8">
          <div className="flex flex-wrap gap-3">
            <Link
              href={addAdminHandoff("/admin", handoff)}
              className="inline-flex rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-black text-white shadow-sm transition hover:bg-white/15"
            >
              ← Main Admin
            </Link>
            <Link
              href={addAdminHandoff("/admin/instacomp", handoff)}
              className="inline-flex rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-black text-white shadow-sm transition hover:bg-white/15"
            >
              InstaComp Operations
            </Link>
          </div>
          <p className="mt-5 text-xs font-black uppercase tracking-[0.2em] text-amber-300">
            KINGMAKER Pricing Operations
          </p>
          <h1 className="mt-2 text-4xl font-black md:text-5xl">Pricing Command Center</h1>
          <p className="mt-3 max-w-4xl font-semibold text-neutral-300">
            One private workspace for advisory pricing history, coverage intelligence, analytics,
            profile economics, scenario comparison, bulk capital planning, review queues, exports,
            and audit visibility.
          </p>
          <div className="mt-5 flex flex-wrap gap-2 text-xs font-black uppercase tracking-[0.14em]">
            <span className="rounded-full border border-emerald-300/30 bg-emerald-300/10 px-3 py-2 text-emerald-200">Advisory only</span>
            <span className="rounded-full border border-cyan-300/30 bg-cyan-300/10 px-3 py-2 text-cyan-200">Owner scoped</span>
            <span className="rounded-full border border-white/15 bg-white/10 px-3 py-2 text-neutral-200">No automatic buying</span>
            <span className="rounded-full border border-white/15 bg-white/10 px-3 py-2 text-neutral-200">No automatic listing</span>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-[1500px] space-y-6 py-6">
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Evidence Rule" value="3+ verified sold comps" />
          <Metric label="Identity Rule" value="Exact match required" />
          <Metric label="Batch Capacity" value="100 candidates" />
          <Metric label="Scenario Capacity" value="10 profiles" />
        </section>

        <section className="rounded-3xl border border-amber-200 bg-amber-50 p-5 text-amber-950 shadow-sm ring-1 ring-amber-950/5">
          <p className="text-xs font-black uppercase tracking-[0.16em]">Operating Boundary</p>
          <h2 className="mt-1 text-2xl font-black">Recommendations never mutate products or purchases</h2>
          <p className="mt-2 max-w-5xl font-semibold leading-6">
            This workspace calculates, compares, ranks, stores receipts, and exports advisory results.
            Any inventory, listing, offer, purchase, or price change remains a separate explicit operator action.
          </p>
        </section>

        <section className="grid grid-cols-1 gap-5 lg:grid-cols-2 xl:grid-cols-3">
          {workspaces.map((workspace) => (
            <Workbench
              key={workspace.href}
              {...workspace}
              href={addAdminHandoff(workspace.href, handoff)}
            />
          ))}
        </section>

        <section className="rounded-3xl border border-neutral-200 bg-white/95 p-6 shadow-sm ring-1 ring-black/[0.02]">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-neutral-500">Recommended Operating Order</p>
          <h2 className="mt-1 text-3xl font-black">Fix identity coverage before trusting economics</h2>
          <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Step number="1" title="Attack coverage gaps" detail="Prioritize Registry work that unlocks the most private reference rows." />
            <Step number="2" title="Clear review cases" detail="Resolve identity, evidence, and confidence problems next." />
            <Step number="3" title="Confirm profile economics" detail="Use the correct fees, shipping cost, and target margin." />
            <Step number="4" title="Plan and act separately" detail="Rank opportunities, export advice, and keep mutations explicit." />
          </div>
        </section>
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-3xl border border-neutral-200 bg-white/95 p-5 shadow-sm ring-1 ring-black/[0.02]">
      <p className="text-xs font-black uppercase tracking-wider text-neutral-500">{label}</p>
      <p className="mt-2 text-xl font-black">{value}</p>
    </div>
  );
}

function Workbench({ eyebrow, title, detail, href, action, tone }: Workspace) {
  const toneClass = tone === "amber"
    ? "border-amber-200 bg-amber-50 ring-amber-950/5"
    : tone === "cyan"
      ? "border-cyan-200 bg-cyan-50 ring-cyan-950/5"
      : "border-neutral-200 bg-white/95 ring-black/[0.02]";

  return (
    <article className={`rounded-3xl border p-6 shadow-sm ring-1 transition hover:-translate-y-0.5 hover:shadow-md ${toneClass}`}>
      <p className="text-xs font-black uppercase tracking-[0.18em] text-neutral-600">{eyebrow}</p>
      <h2 className="mt-1 text-3xl font-black">{title}</h2>
      <p className="mt-3 font-semibold leading-6 text-neutral-700">{detail}</p>
      <Link href={href} className="mt-5 inline-block rounded-full bg-black px-4 py-2.5 text-sm font-black text-white shadow-sm transition hover:bg-neutral-800">
        {action}
      </Link>
    </article>
  );
}

function Step({ number, title, detail }: { number: string; title: string; detail: string }) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 shadow-sm">
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-black text-sm font-black text-white">{number}</span>
      <h3 className="mt-3 text-lg font-black">{title}</h3>
      <p className="mt-1 text-sm font-semibold leading-5 text-neutral-600">{detail}</p>
    </div>
  );
}
