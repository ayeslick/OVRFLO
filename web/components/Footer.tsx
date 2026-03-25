export function Footer() {
  return (
    <footer className="mt-auto border-t-2 border-[#000] bg-white" data-testid="footer">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-5 lg:px-8">
        {/* Logo + brand */}
        <div className="flex items-center gap-2.5">
          <img
            src="/brand/overflow-icon.jpg"
            alt=""
            className="h-7 w-7 rounded-full"
            width={28}
            height={28}
          />
          <span className="text-sm font-bold uppercase tracking-tight text-black">OVERFLOW</span>
        </div>

        {/* Links */}
        <div className="flex items-center gap-4 sm:gap-6">
          <a
            href="https://twitter.com/overflow_fi"
            target="_blank"
            rel="noopener noreferrer"
            className="nb-footer-link"
            data-testid="link-twitter"
          >
            Twitter
          </a>
          <a
            href="https://docs.overflow.finance"
            target="_blank"
            rel="noopener noreferrer"
            className="nb-footer-link"
            data-testid="link-docs"
          >
            Docs
          </a>
          <a
            href="https://github.com/ayeslick/OVRFLO"
            target="_blank"
            rel="noopener noreferrer"
            className="nb-footer-link"
            data-testid="link-github"
          >
            GitHub
          </a>
        </div>

        {/* Copyright + Attribution */}
        <div className="flex items-center gap-4">
          <span className="hidden text-xs text-[#3d5f88] sm:block">
            &copy; {new Date().getFullYear()} OVRFLO
          </span>
          <a
            href="https://www.perplexity.ai/computer"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-[#3d5f88] transition-colors hover:text-black"
            data-testid="link-attribution"
          >
            Created with Perplexity Computer
          </a>
        </div>
      </div>
    </footer>
  );
}
