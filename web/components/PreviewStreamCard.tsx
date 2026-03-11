import type { MockStreamCardData } from "@/lib/mock-dashboard";

interface Props {
  tokenId: string;
  label: string;
  preview: MockStreamCardData;
}

export function PreviewStreamCard({ tokenId, label, preview }: Props) {
  return (
    <article className="nb-panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="nb-kicker text-[var(--color-border)]">OVRFLO #{tokenId}</p>
          <h3 className="mt-2 text-xl text-[var(--color-ink)]">{label}</h3>
        </div>
        <span className="nb-chip nb-kicker">{preview.badge}</span>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[88px_minmax(0,1fr)] lg:items-start">
        <div className="flex h-[88px] w-[88px] items-center justify-center border-2 border-[var(--color-ink)] bg-[var(--color-accent)] text-center text-xs font-bold uppercase tracking-[0.05em] text-[var(--color-ink)] shadow-[var(--shadow-hard-sm)]">
          PT
          <br />
          Flow
        </div>

        <div>
          <p className="nb-kicker text-[var(--color-border)]">{preview.metricLabel}</p>
          <p className="mt-2 text-3xl font-bold uppercase tracking-[0.05em] text-[var(--color-ink)] sm:text-[2rem]">
            {preview.metricValue}
          </p>
          <p className="mt-2 text-sm text-[var(--color-ink)]/75">{preview.metricContext}</p>
        </div>
      </div>

      <div className="mt-5 overflow-hidden rounded-[8px] border-2 border-[var(--color-border)] bg-[repeating-linear-gradient(90deg,var(--color-surface-muted)_0_18px,var(--color-surface)_18px_36px)]">
        <div
          className="h-4 border-r-2 border-[var(--color-ink)] bg-[var(--color-accent)]"
          style={{ width: `${Math.min(preview.progressPct, 100)}%` }}
        />
      </div>

      <div className="mt-5 grid gap-3 text-sm text-[var(--color-ink)] sm:grid-cols-3">
        <div className="rounded-[8px] border-2 border-[var(--color-border)] bg-[var(--color-surface-muted)] px-4 py-3 shadow-[var(--shadow-hard-sm)]">
          <div className="nb-kicker text-[var(--color-border)]">Deposited</div>
          <div className="mt-2 font-semibold uppercase tracking-[0.05em]">{preview.depositedValue}</div>
        </div>
        <div className="rounded-[8px] border-2 border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 shadow-[var(--shadow-hard-sm)]">
          <div className="nb-kicker text-[var(--color-border)]">Maturity</div>
          <div className="mt-2 font-semibold uppercase tracking-[0.05em]">{preview.maturityLabel}</div>
        </div>
        <div className="rounded-[8px] border-2 border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 shadow-[var(--shadow-hard-sm)]">
          <div className="nb-kicker text-[var(--color-border)]">Withdraw fee</div>
          <div className="mt-2 font-semibold uppercase tracking-[0.05em]">{preview.feeLabel}</div>
        </div>
      </div>
    </article>
  );
}