import type { MockStreamCardData } from "@/lib/mock-dashboard";

interface Props {
  tokenId: string;
  label: string;
  preview: MockStreamCardData;
  index: number;
}

export function PreviewStreamCard({ tokenId, label, preview, index }: Props) {
  const isDepleted = preview.progressPct >= 100 && !preview.claimable;

  return (
    <article
      className="nb-stream-card p-5 sm:p-6"
      data-testid={`card-preview-stream-${tokenId}`}
    >
      {/* Top row: Badge + Title + Status */}
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="nb-badge nb-badge-cyan mono">
            {String(index + 1).padStart(2, "0")}
          </span>
          <div>
            <h3 className="text-base font-bold uppercase tracking-wide text-black">
              OVRFLO #{tokenId}
            </h3>
            <p className="nb-kicker mt-0.5 text-black/40">{label}</p>
          </div>
        </div>
        <span className={`nb-badge ${isDepleted ? "nb-badge-dark opacity-50" : "nb-badge-active"}`}>
          {isDepleted ? "Depleted" : preview.progressPct >= 100 ? "Fully Vested" : "Active"}
        </span>
      </div>

      {/* Progress */}
      <div className="mb-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="nb-kicker text-black/40">Streamed</span>
          <span className="mono text-sm font-bold text-[#5dc0f5]">
            {preview.progressPct}% STREAMED
          </span>
        </div>
        <div
          role="progressbar"
          aria-label={`OVRFLO ${tokenId} streamed progress`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={preview.progressPct}
          className="nb-progress-track"
          data-testid={`progress-preview-${tokenId}`}
        >
          <div
            className="nb-progress-fill"
            style={{ width: `${Math.min(preview.progressPct, 100)}%` }}
          />
        </div>
      </div>

      {/* Info boxes */}
      <div className="mb-4 grid grid-cols-2 gap-0">
        <div className="nb-info-box nb-info-box-principal flex-col items-start gap-1">
          <span className="nb-preview-label">Withdrawable</span>
          <span className="mono text-base font-bold text-black">
            {preview.withdrawableLabel}
          </span>
        </div>
        <div className="nb-info-box nb-info-box-streaming flex-col items-start gap-1">
          <span className="nb-preview-label">Ends</span>
          <span className="text-base font-bold text-black">
            {preview.endDateLabel}
          </span>
        </div>
      </div>

      {/* Button */}
      <button
        type="button"
        disabled={!preview.claimable}
        className="nb-button nb-button-dark w-full"
        data-testid={`button-preview-withdraw-${tokenId}`}
      >
        {preview.actionLabel ?? "Withdraw"}
      </button>
    </article>
  );
}
