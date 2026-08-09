import Link from "next/link";
import type { Metadata } from "next";
import InstaCompFastWorkbench from "./InstaCompFastWorkbench";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "InstaComp | Fast Admin Scanner",
  description:
    "Fast drag-and-drop InstaComp workbench for front/back sports-card identification, correction, progress tracking, exact comps, and teacher-learning follow-up.",
  robots: { index: false, follow: false },
};

export default function InstaCompFastPage() {
  return (
    <main className="min-h-screen bg-neutral-100 text-neutral-950">
      <header className="border-b border-neutral-800 bg-neutral-950 text-white shadow-lg">
        <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 px-4 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-300">
              Truely Collectables Admin
            </p>
            <h1 className="mt-1 text-3xl font-black tracking-tight">InstaComp</h1>
            <p className="mt-2 max-w-3xl text-sm font-semibold text-neutral-300">
              Drop front/back card images. InstaComp auto-rotates each side upright,
              returns identity on the fast lane, shows live job progress, lets you correct
              the exact card, then finishes sold comps and teacher learning in the background.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/admin"
              className="rounded-xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-black text-white hover:bg-white/15"
            >
              Admin Home
            </Link>
            <Link
              href="/admin/instacomp/v2"
              className="rounded-xl border border-cyan-300/40 bg-cyan-300/10 px-4 py-2 text-sm font-black text-cyan-100 hover:bg-cyan-300/15"
            >
              Full InstaComp 2.0
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[1500px] px-4 py-6 sm:px-6 lg:px-8">
        <InstaCompFastWorkbench />
      </div>
    </main>
  );
}
