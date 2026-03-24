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

      {/* Cards skeleton */}
      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="border-2 border-black/20 border-l-4 border-l-[#5dc0f5]/40 bg-white/90 p-6"
          >
            <div className="mb-4 flex items-center gap-3">
              <div className="h-7 w-7 bg-[#5dc0f5]/30" />
              <div className="h-5 w-32 bg-black/10" />
            </div>
            <div className="mb-4 h-5 w-full bg-[#0b1221]/20" />
            <div className="mb-4 grid grid-cols-2 gap-0">
              <div className="h-16 bg-[#f0f4f8]" />
              <div className="h-16 bg-[#5dc0f5]/5" />
            </div>
            <div className="h-12 w-full bg-black/70" />
          </div>
        ))}
      </div>
    </main>
  );
}
