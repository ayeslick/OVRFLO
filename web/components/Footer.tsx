export function Footer() {
  return (
    <footer className="mt-auto border-t-2 border-[var(--color-border)] bg-[var(--color-bg)]">
      <div className="mx-auto flex max-w-7xl justify-center px-4 py-4 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-6">
          <a
            href="https://twitter.com/overflow_fi"
            target="_blank"
            rel="noopener noreferrer"
            className="nb-link"
          >
            Twitter
          </a>
          <a
            href="https://docs.overflow.finance"
            target="_blank"
            rel="noopener noreferrer"
            className="nb-link"
          >
            Docs
          </a>
          <a
            href="https://github.com/overflow-finance"
            target="_blank"
            rel="noopener noreferrer"
            className="nb-link"
          >
            GitHub
          </a>
        </div>
      </div>
    </footer>
  );
}
