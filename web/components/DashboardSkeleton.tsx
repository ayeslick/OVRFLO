export function DashboardSkeleton() {
  return (
    <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-8 animate-pulse">
      <div className="flex items-center justify-between mb-6">
        <div className="h-8 w-40 rounded bg-[var(--color-border)]" />
        <div className="flex gap-3">
          <div className="h-10 w-28 rounded-lg bg-[var(--color-border)]" />
          <div className="h-10 w-20 rounded-lg bg-[var(--color-border)]" />
        </div>
      </div>
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-28 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)]"
          />
        ))}
      </div>
    </main>
  );
}
