export function DashboardSkeleton() {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-6 pb-12 pt-8 lg:px-8 motion-safe:animate-pulse motion-reduce:animate-none">
      {/* Header area */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="h-9 w-48 bg-white/20" />
          <div className="mt-2 h-4 w-64 bg-white/10" />
        </div>
        <div className="flex gap-3">
          <div className="h-12 w-36 border-2 border-[#5dc0f5]/50 bg-[#5dc0f5]/20" />
          <div className="h-12 w-28 border-2 border-white/20 bg-white/10" />
        </div>
      </div>

      {/* Summary bar skeleton */}
      <div className="grid grid-cols-3 gap-0 border-2 border-black/20 bg-white/90">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="flex flex-col items-center gap-2 border-r border-black/10 px-4 py-5 last:border-r-0"
          >
            <div className="h-3 w-24 bg-black/10" />
            <div className="h-6 w-16 bg-black/15" />
          </div>
        ))}
      </div>

      {/* Table skeleton */}
      <div className="overflow-hidden border-2 border-black/20 bg-white/90">
        <div className="border-b border-black/10 bg-[#f0f4f8] px-4 py-3">
          <div className="h-3 w-80 bg-black/10" />
        </div>
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="flex items-center gap-6 border-b border-black/5 px-4 py-4"
          >
            <div className="h-7 w-7 bg-[#5dc0f5]/30" />
            <div className="flex flex-col gap-1">
              <div className="h-4 w-28 bg-black/10" />
              <div className="h-2.5 w-20 bg-black/5" />
            </div>
            <div className="h-2.5 w-24 bg-[#0b1221]/20" />
            <div className="h-4 w-16 bg-black/10" />
            <div className="h-4 w-16 bg-black/5" />
            <div className="ml-auto h-9 w-24 bg-black/70" />
          </div>
        ))}
      </div>
    </main>
  );
}
