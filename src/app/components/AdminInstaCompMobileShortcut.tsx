"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function AdminInstaCompMobileShortcut() {
  const pathname = usePathname();

  if (pathname !== "/admin") return null;

  return (
    <Link
      href="/admin/instacomp/mobile"
      aria-label="Open InstaComp Mobile"
      className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 z-[70] flex min-h-12 items-center gap-2 rounded-full border border-cyan-200 bg-neutral-950 px-4 py-3 text-sm font-black text-white shadow-2xl shadow-neutral-950/30 transition hover:-translate-y-0.5 hover:bg-neutral-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-400"
    >
      <span aria-hidden="true">📱</span>
      InstaComp Mobile
    </Link>
  );
}
