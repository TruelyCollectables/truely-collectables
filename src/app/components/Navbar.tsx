export default function Navbar() {
  return (
    <nav className="sticky top-0 z-50 w-full border-b border-neutral-200 bg-[#f6f4ef]/90 px-6 py-4 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded bg-neutral-950 text-sm font-black uppercase text-yellow-300">
            TC
          </div>
          <div>
            <span className="block text-base font-black leading-none">
              Truely Collectables
            </span>
            <span className="block text-xs font-medium text-neutral-500">
              Powered by TCOS
            </span>
          </div>
        </div>

        <div className="hidden items-center gap-6 md:flex">
          <a href="/" className="text-sm font-medium text-neutral-700 hover:text-black">
            Home
          </a>
          <a href="/shop" className="text-sm font-medium text-neutral-700 hover:text-black">
            Shop
          </a>
          <a href="/cart" className="text-sm font-medium text-neutral-700 hover:text-black">
            Cart
          </a>
          <a href="/terms" className="text-sm font-medium text-neutral-700 hover:text-black">
            Terms
          </a>
          <a href="/seller-terms" className="text-sm font-medium text-neutral-700 hover:text-black">
            Seller Terms
          </a>
          <a href="/admin" className="rounded bg-neutral-950 px-4 py-2 text-sm font-bold text-white hover:bg-neutral-800">
            Admin
          </a>
        </div>
      </div>
    </nav>
  );
}
