import Link from "next/link";
import type { ReactNode } from "react";
import {
  getMarketIntelSourceRegistry,
  marketIntelSourceStatusTone,
} from "../../../../lib/market-intel-sources";

export default function ProfitHunterLayout({ children }: { children: ReactNode }) {
  const sources = getMarketIntelSourceRegistry();

  return (
    <>
      <aside className="border-b border-neutral-300 bg-white text-neutral-950">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-6 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-neutral-500">
              Marketplace access
            </p>
            <p className="mt-1 text-sm font-semibold text-neutral-700">
              Statuses describe what is genuinely connected—not what TCOS merely plans to support.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {sources.map((source) => (
              <span
                key={source.slug}
                title={source.authorizationStatus}
                className={`rounded-full border px-3 py-1 text-xs font-black ${marketIntelSourceStatusTone(
                  source.status,
                )}`}
              >
                {source.displayName}: {source.statusLabel}
              </span>
            ))}
            <Link
              href="/admin/market-intel/sources"
              className="rounded-full bg-neutral-950 px-3 py-1.5 text-xs font-black text-white hover:bg-black"
            >
              SOURCE DETAILS →
            </Link>
          </div>
        </div>
      </aside>
      {children}
    </>
  );
}
