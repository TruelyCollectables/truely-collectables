import Link from "next/link";
import type { ReactNode } from "react";

type InstaCompAdminFrameProps = {
  eyebrow: string;
  title: string;
  description: string;
  notice?: ReactNode;
  children: ReactNode;
};

const operatorCards = [
  {
    label: "Wrong scan cleanup",
    value: "Mark → remove",
    detail:
      "If OCR identifies the wrong card, mark “Wrong / needs fix,” then use “Remove Wrong Row” to drop the visible row and cancel saved storage when present.",
  },
  {
    label: "Duplicate quantity merge",
    value: "2 + 1 = 3",
    detail:
      "Select matching completed rows, then “Merge Selected Qty” keeps the first row, sums quantities, and cancels duplicate saved rows.",
  },
  {
    label: "Active scan control",
    value: "End / remove",
    detail:
      "Rows that are still scanning expose an “End / Remove” action so an active bad upload can be stopped instead of feeling stuck.",
  },
];

const quickLinks = [
  { href: "/admin", label: "Command Center" },
  { href: "/admin/products", label: "Products" },
  { href: "/admin/ebay/duplicates", label: "Duplicate Finder" },
  { href: "/admin/production-smoke", label: "Smoke Checks" },
];

export default function InstaCompAdminFrame({
  eyebrow,
  title,
  description,
  notice,
  children,
}: InstaCompAdminFrameProps) {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#ecfeff_0,#f8fafc_40%,#fff7ed_100%)] px-4 py-6 text-neutral-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1500px]">
        <section className="overflow-hidden rounded-[2rem] border border-neutral-900 bg-neutral-950 text-white shadow-2xl shadow-neutral-950/10">
          <div className="grid gap-8 p-6 lg:grid-cols-[1.08fr_0.92fr] lg:p-8">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.22em] text-cyan-300">
                {eyebrow}
              </p>
              <h1 className="mt-3 text-4xl font-black tracking-tight md:text-5xl">
                {title}
              </h1>
              <p className="mt-4 max-w-3xl text-sm font-semibold leading-6 text-neutral-300 md:text-base">
                {description}
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                {quickLinks.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-black text-white transition hover:bg-white/20"
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/[0.06] p-5">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-amber-300">
                No-dead-end controls
              </p>
              <div className="mt-4 grid gap-3">
                {operatorCards.map((card) => (
                  <article
                    key={card.label}
                    className="rounded-2xl border border-white/10 bg-black/20 p-4"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-xs font-black uppercase tracking-[0.16em] text-neutral-400">
                          {card.label}
                        </p>
                        <p className="mt-1 text-xl font-black">{card.value}</p>
                      </div>
                      <span className="rounded-full bg-cyan-300 px-3 py-1 text-xs font-black text-neutral-950">
                        Tested
                      </span>
                    </div>
                    <p className="mt-2 text-sm font-semibold leading-5 text-neutral-300">
                      {card.detail}
                    </p>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </section>

        {notice ? <div className="mt-5">{notice}</div> : null}

        <section className="mt-6">{children}</section>
      </div>
    </main>
  );
}
