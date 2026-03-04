"use client";

export default function Error({
  error: _error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex-1 flex flex-col items-center justify-center min-h-[50vh] px-4 text-center">
      <h2 className="text-2xl font-bold mb-2">Something went wrong</h2>
      <p className="text-[var(--color-muted)] mb-6 max-w-md">
        An unexpected error occurred. You can try again or return to the home
        page.
      </p>
      <div className="flex gap-3">
        <button
          onClick={reset}
          className="px-4 py-2 rounded-lg bg-[var(--color-accent)] text-[var(--color-bg)] font-semibold text-sm hover:brightness-110 transition"
        >
          Try again
        </button>
        <a
          href="/"
          className="px-4 py-2 rounded-lg border border-[var(--color-border)] text-[var(--color-heading)] font-semibold text-sm hover:border-[var(--color-accent)] transition"
        >
          Go home
        </a>
      </div>
    </main>
  );
}
