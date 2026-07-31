"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const adminMobileLinks = [
  {
    href: "/admin/instacomp/mobile",
    label: "InstaComp Mobile",
    icon: "📱",
  },
  {
    href: "/admin/products/new",
    label: "Card Studio",
    icon: "📸",
  },
  {
    href: "/admin/products",
    label: "Products",
    icon: "🗂️",
  },
  {
    href: "/admin/orders",
    label: "Orders",
    icon: "📦",
  },
];

export default function AdminInstaCompMobileShortcut() {
  const pathname = usePathname();

  if (pathname !== "/admin") return null;

  return (
    <aside
      aria-label="Mobile admin quick tools"
      className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-[70] rounded-2xl border border-white/10 bg-neutral-950/95 p-2 text-white shadow-2xl shadow-neutral-950/40 backdrop-blur sm:left-auto sm:right-4 sm:w-auto"
    >
      <div className="grid grid-cols-4 gap-1 sm:flex sm:items-center sm:gap-2">
        {adminMobileLinks.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="flex min-h-14 flex-col items-center justify-center rounded-xl px-2 py-2 text-center text-[10px] font-black leading-tight transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 sm:min-h-12 sm:flex-row sm:gap-2 sm:px-3 sm:text-xs"
          >
            <span className="text-base" aria-hidden="true">
              {item.icon}
            </span>
            <span>{item.label}</span>
          </Link>
        ))}
      </div>
    </aside>
  );
}
