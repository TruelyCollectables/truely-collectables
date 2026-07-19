"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

type HotPlayerCard = {
  legacyProductId: number;
  title: string;
  player: string | null;
  sport: string | null;
  price: number;
  quantity: number;
  imageUrl: string;
  shippingLabel: string;
};

type HotPlayer = {
  subjectId: string;
  name: string;
  sport: string | null;
  league: string | null;
  team: string | null;
  heatScore: number;
  trendLabel: "SURGING" | "HOT" | "RISING" | "ACTIVE";
  reason: string;
  sevenDayChangePct: number | null;
  thirtyDayChangePct: number | null;
  recentVerifiedSales: number;
  confidenceScore: number;
  liquidityScore: number;
  calculatedAt: string;
  cards: HotPlayerCard[];
};

type HotPlayerResponse = {
  players: HotPlayer[];
  generatedAt: string;
  refreshHours: number;
};

function percent(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function trendTone(label: HotPlayer["trendLabel"]) {
  if (label === "SURGING") return "bg-rose-600 text-white";
  if (label === "HOT") return "bg-orange-500 text-white";
  if (label === "RISING") return "bg-yellow-300 text-neutral-950";
  return "bg-white text-neutral-950";
}

function findHomepageAnchor() {
  const headings = Array.from(document.querySelectorAll("main h2"));
  const freshHeading = headings.find(
    (heading) => heading.textContent?.trim() === "New cards on the wall",
  );
  const freshSection = freshHeading?.closest("section");
  if (freshSection) return { anchor: freshSection, position: "after" as const };

  const sportHeading = headings.find(
    (heading) => heading.textContent?.trim() === "Shop by sport",
  );
  const sportSection = sportHeading?.closest("section");
  if (sportSection) return { anchor: sportSection, position: "before" as const };

  const main = document.querySelector("main");
  return main ? { anchor: main, position: "append" as const } : null;
}

export default function HotPlayersHomepageEnhancer() {
  const pathname = usePathname();
  const [mountNode, setMountNode] = useState<HTMLElement | null>(null);
  const [data, setData] = useState<HotPlayerResponse | null>(null);

  useEffect(() => {
    if (pathname !== "/") {
      setMountNode(null);
      return;
    }

    const existing = document.querySelector<HTMLElement>(
      "[data-tcos-hot-players-mount='true']",
    );
    existing?.remove();

    const target = findHomepageAnchor();
    if (!target) return;

    const node = document.createElement("div");
    node.dataset.tcosHotPlayersMount = "true";

    if (target.position === "after") target.anchor.after(node);
    else if (target.position === "before") target.anchor.before(node);
    else target.anchor.append(node);

    setMountNode(node);
    return () => {
      node.remove();
      setMountNode(null);
    };
  }, [pathname]);

  useEffect(() => {
    if (pathname !== "/") return;
    const controller = new AbortController();

    void fetch("/api/storefront/hot-players", {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Hot-player feed unavailable");
        return (await response.json()) as HotPlayerResponse;
      })
      .then((payload) => setData(payload))
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        console.error("Hot-player homepage block failed:", error);
        setData(null);
      });

    return () => controller.abort();
  }, [pathname]);

  const players = useMemo(() => data?.players || [], [data]);
  if (!mountNode || players.length === 0) return null;

  return createPortal(
    <section className="border-y-2 border-neutral-950 bg-neutral-950 text-white">
      <div className="mx-auto max-w-7xl px-6 py-12">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.22em] text-yellow-300">
              Powered by TCOS Market Intel™
            </p>
            <h2 className="mt-2 text-4xl font-black tracking-tight sm:text-5xl">
              🔥 Hot players right now
            </h2>
            <p className="mt-3 max-w-3xl font-semibold leading-7 text-neutral-300">
              Real market movement, verified sales velocity, liquidity, and confidence—matched only to cards currently available in our shop.
            </p>
          </div>
          <div className="border-2 border-yellow-300 bg-neutral-900 px-4 py-3 text-sm font-bold text-neutral-200">
            Rankings refresh every {data?.refreshHours || 6} hours
          </div>
        </div>

        <div className="mt-8 grid gap-6 xl:grid-cols-2">
          {players.map((player, playerIndex) => (
            <article
              key={player.subjectId}
              className="border-2 border-white bg-[#f6f2e8] p-5 text-neutral-950 shadow-[7px_7px_0_#ffd633]"
            >
              <div className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-neutral-950 pb-4">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-blue-700">
                    #{playerIndex + 1} · {player.sport || player.league || "Sports Cards"}
                  </p>
                  <h3 className="mt-1 text-3xl font-black tracking-tight">
                    {player.name}
                  </h3>
                  <p className="mt-1 text-sm font-bold text-neutral-600">
                    {[player.team, player.league].filter(Boolean).join(" · ") || player.reason}
                  </p>
                </div>
                <div className="text-right">
                  <span
                    className={`inline-block border-2 border-neutral-950 px-3 py-1 text-xs font-black ${trendTone(player.trendLabel)}`}
                  >
                    {player.trendLabel}
                  </span>
                  <p className="mt-2 text-4xl font-black leading-none">
                    {player.heatScore}
                  </p>
                  <p className="text-[10px] font-black uppercase tracking-wider text-neutral-500">
                    Heat Score
                  </p>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs font-black">
                <div className="border-2 border-neutral-950 bg-white px-2 py-3">
                  <p className="text-neutral-500">7 DAY</p>
                  <p className="mt-1 text-lg">{percent(player.sevenDayChangePct)}</p>
                </div>
                <div className="border-2 border-neutral-950 bg-white px-2 py-3">
                  <p className="text-neutral-500">VERIFIED SALES</p>
                  <p className="mt-1 text-lg">{player.recentVerifiedSales}</p>
                </div>
                <div className="border-2 border-neutral-950 bg-white px-2 py-3">
                  <p className="text-neutral-500">LIQUIDITY</p>
                  <p className="mt-1 text-lg">{player.liquidityScore}</p>
                </div>
              </div>

              <p className="mt-4 border-l-4 border-orange-500 bg-white px-4 py-3 text-sm font-black">
                {player.reason}
              </p>

              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                {player.cards.map((card) => (
                  <Link
                    key={card.legacyProductId}
                    href={`/product/${card.legacyProductId}`}
                    className="group flex h-full flex-col border-2 border-neutral-950 bg-white p-2 transition hover:-translate-y-1 hover:shadow-[4px_4px_0_#111318]"
                  >
                    <div className="relative aspect-[4/5] overflow-hidden border-2 border-neutral-950 bg-[#efede7]">
                      <Image
                        src={card.imageUrl}
                        alt={card.title}
                        fill
                        unoptimized
                        sizes="(min-width: 1280px) 190px, (min-width: 640px) 30vw, 100vw"
                        className="object-contain p-2 transition group-hover:scale-[1.03]"
                      />
                    </div>
                    <div className="flex flex-1 flex-col p-2">
                      <p className="line-clamp-2 min-h-10 text-xs font-black leading-5">
                        {card.title}
                      </p>
                      <div className="mt-auto border-t-2 border-neutral-950 pt-2">
                        <p className="text-xl font-black">${card.price.toFixed(2)}</p>
                        <p className="mt-1 text-[10px] font-black text-neutral-500">
                          {card.shippingLabel}
                        </p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>

              <Link
                href={`/shop?q=${encodeURIComponent(player.name)}`}
                className="mt-5 block border-2 border-neutral-950 bg-yellow-300 px-4 py-3 text-center text-sm font-black shadow-[3px_3px_0_#111318] transition hover:-translate-y-0.5"
              >
                Shop all {player.name} cards →
              </Link>
            </article>
          ))}
        </div>

        <p className="mt-7 text-xs font-semibold leading-5 text-neutral-400">
          Heat Scores are directional market signals, not guarantees of future value. Rankings require positive momentum, multiple verified-market observations, minimum confidence, and live Truely Collectables inventory.
        </p>
      </div>
    </section>,
    mountNode,
  );
}
