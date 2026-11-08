export default function SoldOverlay({
  label = "SOLD",
  compact = false,
}: {
  label?: string;
  compact?: boolean;
}) {
  return (
    <div
      aria-label={label}
      className="pointer-events-none absolute inset-0 z-20 overflow-hidden"
    >
      <div className="absolute inset-0 bg-white/20" />
      <div
        className={`absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 -rotate-[32deg] items-center justify-center border-y-4 border-red-950 bg-red-600/95 px-8 py-2 text-center font-black uppercase tracking-[0.18em] text-white shadow-lg shadow-red-950/30 ${
          compact ? "min-w-[145%] text-2xl" : "min-w-[135%] text-4xl sm:text-5xl"
        }`}
      >
        {label}
      </div>
    </div>
  );
}
