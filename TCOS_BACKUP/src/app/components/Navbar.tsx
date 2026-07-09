import Link from "next/link";
import { PLATFORM_SHORT_NAME, STORE_BRAND_NAME } from "../../lib/legal";

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
    <nav className="sticky top-0 z-50 w-full border-b border-neutral-200 bg-[#f6f4ef]/90 px-6 py-4 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded bg-neutral-950 text-sm font-black uppercase text-yellow-300">
            {storeMark(STORE_BRAND_NAME)}
          </div>
          <div>
            <span className="block text-base font-black leading-none">
              {STORE_BRAND_NAME}
            </span>
            <span className="block text-xs font-medium text-neutral-500">
              Powered by {PLATFORM_SHORT_NAME}
            </span>
          </div>
        </div>

        <div className="hidden items-center gap-6 md:flex">
          <Link href="/" className="text-sm font-medium text-neutral-700 hover:text-black">
            Home
          </Link>
          <Link href="/shop" className="text-sm font-medium text-neutral-700 hover:text-black">
            Shop
          </Link>
          <Link href="/cart" className="text-sm font-medium text-neutral-700 hover:text-black">
            Cart
          </Link>
          <Link href="/account" className="text-sm font-medium text-neutral-700 hover:text-black">
            Account
          </Link>
          <Link href="/terms" className="text-sm font-medium text-neutral-700 hover:text-black">
            Terms
          </Link>
          <Link href="/seller-terms" className="text-sm font-medium text-neutral-700 hover:text-black">
            Seller Terms
          </Link>
          <Link href="/admin" className="rounded bg-neutral-950 px-4 py-2 text-sm font-bold text-white hover:bg-neutral-800">
            Admin
          </Link>
        </div>
      </div>
    </nav>
  );
}
