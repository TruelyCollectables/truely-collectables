import Link from "next/link";
import { STORE_BRAND_NAME } from "../../lib/legal";
import MobileNavigation from "./MobileNavigation";

const navigationLinks = [
  { href: "/shop", label: "Shop" },
  { href: "/shop?feature=rookie", label: "Rookies" },
  { href: "/shop?feature=autograph", label: "Autos" },
  { href: "/shop?feature=graded", label: "Graded" },
  { href: "/recently-sold", label: "Recently Sold" },
  { href: "/account/orders", label: "Orders" },
  { href: "/account", label: "Account" },
];

const mobileNavigationLinks = navigationLinks;

function storeMark(value: string) {
  const initials = value
    .split(/\s+/)
    .map((part) => part.trim().charAt(0))
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return initials || "TC";
}

function NavigationLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      prefetch={false}
      className="inline-flex min-h-10 items-center justify-center whitespace-nowrap text-sm font-bold text-slate-200 transition hover:text-[#facc15]"
    >
      {label}
    </Link>
  );
}

export default function Navbar() {
  return (
    <>
      <div className="border-b border-slate-800 bg-[#0b1120] px-4 py-2 text-center text-[11px] font-bold uppercase tracking-[0.18em] text-[#facc15] sm:text-xs">
        Real sports cards · live inventory · secure checkout · tracking included
      </div>
      <nav className="sticky top-0 z-50 w-full border-b border-slate-800 bg-[#0f172a]/95 px-4 py-3 text-white backdrop-blur sm:px-6">
        <div className="mx-auto max-w-7xl">
          <div className="flex items-center justify-between gap-3 sm:gap-4">
            <Link
              href="/"
              prefetch={false}
              className="flex min-w-0 items-center gap-3"
            >
              <div className="font-display flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-[#facc15] text-lg font-extrabold uppercase tracking-tight text-[#0f172a] shadow-sm">
                {storeMark(STORE_BRAND_NAME)}
              </div>
              <div className="min-w-0">
                <span className="font-display block truncate text-xl font-extrabold uppercase leading-none tracking-wide text-white sm:text-2xl">
                  {STORE_BRAND_NAME}
                </span>
                <span className="mt-1 block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
                  The Card Wall
                </span>
              </div>
            </Link>

            <div className="flex shrink-0 items-center gap-2 sm:gap-4">
              <div className="hidden items-center gap-5 lg:flex">
                {navigationLinks.map((item) => (
                  <NavigationLink key={item.href} {...item} />
                ))}
              </div>

              <Link
                href="/cart"
                prefetch={false}
                className="inline-flex min-h-10 items-center justify-center rounded-lg bg-[#facc15] px-4 py-2 text-sm font-extrabold text-[#0f172a] transition hover:-translate-y-0.5 hover:bg-[#eab308]"
              >
                Cart
              </Link>
            </div>
          </div>

          <MobileNavigation links={mobileNavigationLinks} />
        </div>
      </nav>
    </>
  );
}
