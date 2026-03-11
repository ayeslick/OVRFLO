import type { MockStreamCardData } from "@/lib/mock-dashboard";

interface Props {
  tokenId: string;
  label: string;
  preview: MockStreamCardData;
}

export function PreviewStreamCard({ tokenId, label, preview }: Props) {
  return (
    <article className="nb-panel rounded-[4px] p-4 sm:p-5">
      <div className="flex flex-col gap-4">
        <div className="border-b-2 border-[var(--color-border)] pb-3">
          <h3 className="text-base text-[var(--color-ink)] sm:text-lg">{`OVRFLO #${tokenId} · ${label}`}</h3>
        </div>

        <div className="grid gap-2">
          <div className="flex items-center justify-between gap-3">
            <span className="nb-kicker text-[var(--color-border)]">Streamed</span>
            <span className="mono text-sm font-semibold tracking-[0.05em] text-[var(--color-ink)]">{preview.progressPct}% streamed</span>
          </div>
          <div
            role="progressbar"
            aria-label={`OVRFLO ${tokenId} streamed progress`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={preview.progressPct}
            className="overflow-hidden rounded-[4px] border-2 border-[var(--color-border)] bg-[var(--color-surface-muted)] shadow-[var(--shadow-hard-sm)]"
          >
            <div className="h-3 bg-[var(--color-accent)]" style={{ width: `${Math.min(preview.progressPct, 100)}%` }} />
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t-2 border-[var(--color-border)] pt-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-[var(--color-ink)]">
            <span className="nb-kicker mr-2 text-[var(--color-border)]">Withdrawable:</span>
            <span className="mono font-semibold uppercase tracking-[0.05em]">{preview.withdrawableLabel}</span>
          </p>
          <button type="button" disabled={!preview.claimable} className="nb-button w-full rounded-[4px] sm:w-auto">
            {preview.actionLabel ?? "Withdraw"}
          </button>
        </div>

        <p className="border-t-2 border-[var(--color-border)] pt-3 text-sm text-[var(--color-ink)]">
          <span className="nb-kicker mr-2 text-[var(--color-border)]">Ends:</span>
          <span className="font-semibold uppercase tracking-[0.05em]">{preview.endDateLabel}</span>
        </p>
      </div>
    </article>
  );
}