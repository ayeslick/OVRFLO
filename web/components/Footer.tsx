export function Footer() {
  return (
    <footer className="mt-auto border-t border-[var(--color-border)] px-6 py-4 text-sm text-[var(--color-muted)] flex gap-6">
      <a
        href="https://twitter.com/overflow_fi"
        target="_blank"
        rel="noopener noreferrer"
        className="hover:text-[var(--color-accent)] transition-colors"
      >
        Twitter
      </a>
      <a
        href="https://docs.overflow.finance"
        target="_blank"
        rel="noopener noreferrer"
        className="hover:text-[var(--color-accent)] transition-colors"
      >
        Docs
      </a>
      <a
        href="https://github.com/overflow-finance"
        target="_blank"
        rel="noopener noreferrer"
        className="hover:text-[var(--color-accent)] transition-colors"
      >
        GitHub
      </a>
    </footer>
  );
}
