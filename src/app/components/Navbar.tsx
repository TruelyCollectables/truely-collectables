import Link from "next/link";
import { STORE_BRAND_NAME } from "../../lib/legal";

function storeMark(value: string) {
  const initials = value
    .split(/\s+/)
    .map((part) => part.trim().charAt(0))
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return initials || "TC";
}

export default function Navbar() {
  return (
    <>
      <div className="border-b-2 border-neutral-950 bg-neutral-950 px-4 py-2 text-center text-[11px] font-black uppercase tracking-[0.16em] text-yellow-300 sm:text-xs">
        Real sports cards · live inventory · secure checkout · tracking included
      </div>
      <nav className="sticky top-0 z-50 w-full border-b-2 border-neutral-950 bg-white px-4 py-3 sm:px-6">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <Link
            href="/"
            className="flex min-w-0 items-center gap-3"
            aria-label={`${STORE_BRAND_NAME} home`}
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

          <div className="flex items-center gap-2 sm:gap-3">
            <div className="hidden items-center gap-5 lg:flex">
              <Link
                href="/shop"
                className="text-sm font-black text-neutral-800 hover:underline hover:decoration-yellow-300 hover:decoration-4 hover:underline-offset-4"
              >
                Shop
              </Link>
              <Link
                href="/shop?q=rookie"
                className="text-sm font-black text-neutral-800 hover:underline hover:decoration-yellow-300 hover:decoration-4 hover:underline-offset-4"
              >
                Rookies
              </Link>
              <Link
                href="/shop?q=autograph"
                className="text-sm font-black text-neutral-800 hover:underline hover:decoration-yellow-300 hover:decoration-4 hover:underline-offset-4"
              >
                Autos
              </Link>
              <Link
                href="/shop?q=PSA"
                className="text-sm font-black text-neutral-800 hover:underline hover:decoration-yellow-300 hover:decoration-4 hover:underline-offset-4"
              >
                Graded
              </Link>
              <Link
                href="/account"
                className="text-sm font-black text-neutral-800 hover:underline hover:decoration-yellow-300 hover:decoration-4 hover:underline-offset-4"
              >
                Account
              </Link>
            </div>

            <Link
              href="/cart"
              className="border-2 border-neutral-950 bg-yellow-300 px-4 py-2 text-sm font-black text-neutral-950 shadow-[3px_3px_0_#111318] transition hover:-translate-y-0.5"
            >
              Cart
            </Link>
          </div>
        </div>
      </nav>
    </>
  );
}
