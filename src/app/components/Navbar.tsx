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
    <nav className="sticky top-0 z-50 w-full border-b border-neutral-200 bg-[#f6f4ef]/95 px-4 py-3 backdrop-blur-md sm:px-6">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
        <Link href="/" className="flex min-w-0 items-center gap-3" aria-label={`${STORE_BRAND_NAME} home`}>
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-neutral-950 text-sm font-black uppercase text-yellow-300">
            {storeMark(STORE_BRAND_NAME)}
          </div>
          <div className="min-w-0">
            <span className="block truncate text-base font-black leading-none sm:text-lg">
              {STORE_BRAND_NAME}
            </span>
            <span className="mt-1 block text-[11px] font-bold uppercase tracking-[0.14em] text-neutral-500">
              Sports Card Store
            </span>
          </div>
        </Link>

        <div className="flex items-center gap-2 sm:gap-3">
          <div className="hidden items-center gap-5 lg:flex">
            <Link href="/" className="text-sm font-bold text-neutral-700 hover:text-black">
              Home
            </Link>
            <Link href="/shop?q=rookie" className="text-sm font-bold text-neutral-700 hover:text-black">
              Rookies
            </Link>
            <Link href="/shop?q=autograph" className="text-sm font-bold text-neutral-700 hover:text-black">
              Autographs
            </Link>
            <Link href="/account" className="text-sm font-bold text-neutral-700 hover:text-black">
              Account
            </Link>
            <Link href="/terms" className="text-sm font-bold text-neutral-700 hover:text-black">
              Terms
            </Link>
          </div>

          <Link
            href="/cart"
            className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-black text-neutral-950 hover:border-neutral-950 sm:px-4"
          >
            Cart
          </Link>
          <Link
            href="/shop"
            className="rounded-md bg-neutral-950 px-3 py-2 text-sm font-black text-white hover:bg-neutral-800 sm:px-5"
          >
            Shop Cards
          </Link>
        </div>
      </div>
    </nav>
  );
}
