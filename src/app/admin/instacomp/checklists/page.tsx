import Link from "next/link";
import type { Metadata } from "next";
import ChecklistRegistryImporter from "./ChecklistRegistryImporter";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "InstaComp Checklist Registry | Truely Collectables",
  description:
    "Private owner workspace for validating and importing official card checklists into InstaComp.",
  robots: { index: false, follow: false },
};

export default function ChecklistRegistryPage() {
  return (
    <main className="min-h-screen bg-neutral-100 text-neutral-950">
      <header className="border-b border-white/10 bg-neutral-950 text-white shadow-lg">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-7 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-300">
              Private InstaComp infrastructure
            </p>
            <h1 className="mt-2 text-3xl font-black tracking-tight">
              Checklist Registry
            </h1>
            <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-neutral-300">
              Preserve official source files privately, validate every row, and
              create exact base, insert, parallel, autograph, relic, variation,
              and serial-run identities without merging different cards together.
            </p>
          </div>
          <nav className="flex flex-wrap gap-2">
            <Link
              href="/admin/instacomp/v2"
              className="rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-black"
            >
              InstaComp 2.0
            </Link>
            <Link
              href="/admin"
              className="rounded-full bg-amber-300 px-4 py-2 text-sm font-black text-neutral-950"
            >
              Admin
            </Link>
          </nav>
        </div>
      </header>

      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
        <section className="mb-5 grid gap-3 md:grid-cols-3">
          <InfoCard
            title="Originals stay private"
            text="Source files are archived in a private bucket with SHA-256 deduplication and no public URL."
          />
          <InfoCard
            title="Validation before import"
            text="Unsupported, incomplete, or duplicate rows are rejected or sent to review instead of being guessed."
          />
          <InfoCard
            title="Exact identities"
            text="Base cards and every parallel or numbered run receive separate permanent fingerprints."
          />
        </section>

        <ChecklistRegistryImporter />
      </div>
    </main>
  );
}

function InfoCard({ title, text }: { title: string; text: string }) {
  return (
    <article className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
      <h2 className="font-black">{title}</h2>
      <p className="mt-1 text-sm font-semibold leading-5 text-neutral-600">{text}</p>
    </article>
  );
}
