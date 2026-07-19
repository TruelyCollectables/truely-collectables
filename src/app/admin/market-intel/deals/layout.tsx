import Link from "next/link";
import type { ReactNode } from "react";
import {
  getMarketIntelSourceRegistry,
  marketIntelSourceStatusTone,
} from "../../../../lib/market-intel-sources";
import BlowoutProfitHunterPanel from "./BlowoutProfitHunterPanel";

export default function ProfitHunterLayout({ children }: { children: ReactNode }) {
  const sources = getMarketIntelSourceRegistry();

  return (
    <>
      <aside id="top" className="border-b border-neutral-300 bg-white text-neutral-950">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-6 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-neutral-500">
              Marketplace access
            </p>
            <p className="mt-1 text-sm font-semibold text-neutral-700">
              Search hits stay unverified until the private owner clears the Identity Proof Gate™.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {sources.map((source) => {
              const classes = `rounded-full border px-3 py-1 text-xs font-black ${marketIntelSourceStatusTone(
                source.status,
              )}`;
              return source.slug === "blowout_forums" ? (
                <a
                  key={source.slug}
                  href="#blowout-research"
                  title="Open Blowout indexed bargain searches inside Profit Hunter"
                  className={`${classes} hover:underline`}
                >
                  {source.displayName}: {source.statusLabel} ↓
                </a>
              ) : (
                <span
                  key={source.slug}
                  title={source.authorizationStatus}
                  className={classes}
                >
                  {source.displayName}: {source.statusLabel}
                </span>
              );
            })}
            <Link
              href="/admin/market-intel/deals/identity-review"
              className="rounded-full bg-fuchsia-800 px-3 py-1.5 text-xs font-black text-white hover:bg-fuchsia-900"
            >
              IDENTITY PROOF QUEUE →
            </Link>
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
      <BlowoutProfitHunterPanel />
    </>
  );
}
