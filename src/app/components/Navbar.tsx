import Link from "next/link";
import { STORE_BRAND_NAME } from "../../lib/legal";
import MobileNavigation from "./MobileNavigation";

const navigationLinks = [
  { href: "/shop", label: "Shop" },
  { href: "/shop?q=rookie", label: "Rookies" },
  { href: "/shop?q=autograph", label: "Autos" },
  { href: "/shop?q=PSA", label: "Graded" },
  { href: "/recently-sold", label: "Recently Sold" },
  { href: "/account/orders", label: "Orders" },
  { href: "/account", label: "Account" },
];

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
      className="inline-flex min-h-11 items-center justify-center whitespace-nowrap text-sm font-black text-neutral-800 hover:underline hover:decoration-yellow-300 hover:decoration-4 hover:underline-offset-4"
    >
      {label}
    </Link>
  );
}

export default function Navbar() {
  return (
    <>
      <div className="border-b-2 border-neutral-950 bg-neutral-950 px-4 py-2 text-center text-[11px] font-black uppercase tracking-[0.16em] text-yellow-300 sm:text-xs">
        Real sports cards · live inventory · secure checkout · tracking included
      </div>
      <nav className="sticky top-0 z-50 w-full border-b-2 border-neutral-950 bg-white px-4 py-3 sm:px-6">
        <div className="mx-auto max-w-7xl">
          <div className="flex items-center justify-between gap-3 sm:gap-4">
            <Link
              href="/"
              prefetch={false}
              className="flex min-w-0 items-center gap-3"
            >
              <div className="flex h-11 w-11 shrink-0 items-center justify-center border-2 border-neutral-950 bg-yellow-300 text-sm font-black uppercase shadow-[3px_3px_0_#111318]">
                {storeMark(STORE_BRAND_NAME)}
              </div>
              <div className="min-w-0">
                <span className="block truncate text-base font-black leading-none tracking-tight sm:text-xl">
                  {STORE_BRAND_NAME}
                </span>
                <span className="mt-1 block text-[10px] font-black uppercase tracking-[0.18em] text-neutral-500">
                  The Card Wall
                </span>
              </div>
            </Link>

            <div className="flex shrink-0 items-center gap-2 sm:gap-3">
              <div className="hidden items-center gap-5 lg:flex">
                {navigationLinks.map((item) => (
                  <NavigationLink key={item.href} {...item} />
                ))}
              </div>

              <Link
                href="/cart"
                prefetch={false}
                className="inline-flex min-h-11 items-center justify-center border-2 border-neutral-950 bg-yellow-300 px-4 py-2 text-sm font-black text-neutral-950 shadow-[3px_3px_0_#111318] transition hover:-translate-y-0.5"
              >
                Cart
              </Link>
            </div>
          </div>

          <MobileNavigation links={navigationLinks} />
        </div>
      </nav>
    </>
  );
}
