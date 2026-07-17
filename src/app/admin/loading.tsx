export default function AdminLoading() {
  return (
    <main className="min-h-screen bg-[#f4f1ea] px-6 py-8 text-neutral-950">
      <section className="mx-auto max-w-7xl">
        <div className="rounded-2xl border border-neutral-800 bg-[#101418] p-8 text-white shadow-sm">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-300">
            Admin command center
          </p>
          <div className="mt-4 h-10 max-w-xl animate-pulse rounded bg-white/20" />
          <div className="mt-4 h-4 max-w-3xl animate-pulse rounded bg-white/10" />
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div
              key={index}
              className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm"
            >
              <div className="h-3 w-24 animate-pulse rounded bg-neutral-200" />
              <div className="mt-4 h-8 w-32 animate-pulse rounded bg-neutral-200" />
              <div className="mt-3 h-3 w-full animate-pulse rounded bg-neutral-100" />
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
