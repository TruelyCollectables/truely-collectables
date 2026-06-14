export default function Navbar() {
  return (
    <nav className="w-full border-b border-neutral-200 bg-white/80 backdrop-blur-md px-6 py-4 shadow-sm">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-black text-sm font-bold uppercase text-white">
            TC
          </div>
          <span className="text-lg font-semibold">Truely Collectables</span>
        </div>

        <div className="hidden items-center gap-6 md:flex">
          <a href="#" className="text-sm font-medium text-neutral-700 hover:text-black">
            Home
          </a>
          <a href="#" className="text-sm font-medium text-neutral-700 hover:text-black">
            Shop
          </a>
          <a href="#" className="text-sm font-medium text-neutral-700 hover:text-black">
            About
          </a>
        </div>
      </div>
    </nav>
  );
}
