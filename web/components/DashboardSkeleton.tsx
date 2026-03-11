export function DashboardSkeleton() {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 pb-10 pt-28 sm:px-6 lg:px-8 motion-safe:animate-pulse motion-reduce:animate-none">
      <div className="nb-panel p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="h-10 w-36 bg-[var(--color-surface-muted)]" />
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="h-12 w-36 border-2 border-[var(--color-border)] bg-[var(--color-accent)]" />
            <div className="h-12 w-28 border-2 border-[var(--color-border)] bg-[var(--color-surface)]" />
          </div>
        </div>
      </div>
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="h-44 border-2 border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-hard-sm)]"
        />
      ))}
    </main>
  );
}
