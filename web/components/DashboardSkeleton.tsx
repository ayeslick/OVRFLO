export function DashboardSkeleton() {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 pb-10 pt-28 sm:px-6 lg:px-8 motion-safe:animate-pulse motion-reduce:animate-none">
      <div className="nb-panel p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="h-10 w-36 bg-[var(--color-surface-muted)]" />
          <div className="flex gap-3">
            <div className="h-12 w-36 border-2 border-[var(--color-border)] bg-[var(--color-accent)]" />
            <div className="h-12 w-28 border-2 border-[var(--color-border)] bg-[var(--color-surface)]" />
          </div>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-40 border-2 border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-hard-sm)]"
          />
        ))}
      </div>
      <div className="nb-panel p-6">
        <div className="flex flex-col gap-4 border-b-2 border-[var(--color-border)] pb-5 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap gap-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-10 w-28 border-2 border-[var(--color-border)] bg-[var(--color-surface-muted)]"
              />
            ))}
          </div>
          <div className="h-8 w-20 border-2 border-[var(--color-border)] bg-[var(--color-surface-muted)]" />
        </div>
        <div className="mt-6 grid gap-4 xl:grid-cols-2">
          <div className="h-12 w-36 border-2 border-[var(--color-border)] bg-[var(--color-accent)]" />
          <div className="h-12 w-28 border-2 border-[var(--color-border)] bg-[var(--color-surface)]" />
          <div className="h-56 border-2 border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-hard-sm)]" />
          <div className="h-56 border-2 border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-hard-sm)]" />
        </div>
      </div>
    </main>
  );
}
