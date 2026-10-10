export default function KingmakerLoading() {
  return (
    <main className="min-h-screen bg-neutral-100 px-4 py-6 sm:px-6">
      <div className="mx-auto max-w-7xl animate-pulse space-y-5">
        <div className="h-14 rounded-2xl border-2 border-neutral-300 bg-white" />
        <div className="grid gap-4 md:grid-cols-3">
          <div className="h-28 rounded-2xl border-2 border-neutral-300 bg-white" />
          <div className="h-28 rounded-2xl border-2 border-neutral-300 bg-white" />
          <div className="h-28 rounded-2xl border-2 border-neutral-300 bg-white" />
        </div>
        <div className="h-72 rounded-2xl border-2 border-neutral-300 bg-white" />
      </div>
    </main>
  );
}
