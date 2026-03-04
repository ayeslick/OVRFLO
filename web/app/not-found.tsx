export default function NotFound() {
  return (
    <main className="flex-1 flex flex-col items-center justify-center min-h-[50vh] px-4 text-center">
      <h2 className="text-2xl font-bold mb-2">Page not found</h2>
      <p className="text-[var(--color-muted)] mb-6">
        The page you are looking for does not exist.
      </p>
      <a
        href="/"
        className="px-4 py-2 rounded-lg bg-[var(--color-accent)] text-[var(--color-bg)] font-semibold text-sm hover:brightness-110 transition"
      >
        Go home
      </a>
    </main>
  );
}
