export default function AdminLoading() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#eff6ff_0,#f8fafc_40%,#fff7ed_100%)] px-4 py-6 text-neutral-950 sm:px-6 lg:px-8">
      <section className="mx-auto max-w-[1500px]">
        <div className="rounded-[2rem] border border-neutral-900 bg-neutral-950 p-8 text-white shadow-2xl shadow-neutral-950/10">
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
              className="rounded-3xl border border-neutral-200 bg-white/95 p-5 shadow-sm ring-1 ring-black/[0.02]"
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
