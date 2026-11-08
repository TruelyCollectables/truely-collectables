"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

type MobileNavigationLink = {
  href: string;
  label: string;
};

export default function MobileNavigation({
  links,
}: {
  links: MobileNavigationLink[];
}) {
  const pathname = usePathname();
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    element.scrollLeft = 0;
  }, [pathname]);

  return (
    <div
      ref={scrollRef}
      className="-mx-4 mt-3 overflow-x-auto overscroll-x-contain border-t border-neutral-200 px-4 pt-2 lg:hidden sm:-mx-6 sm:px-6"
      aria-label="Mobile store navigation"
    >
      <div className="flex min-w-max items-center gap-5 pr-4 sm:pr-6">
        {links.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            prefetch={false}
            className="inline-flex min-h-11 items-center justify-center whitespace-nowrap text-sm font-black text-neutral-800 hover:underline hover:decoration-yellow-300 hover:decoration-4 hover:underline-offset-4"
          >
            {item.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
