import type { MockStreamCardData } from "@/lib/mock-dashboard";

interface Props {
  tokenId: string;
  label: string;
  preview: MockStreamCardData;
  index: number;
}

export function PreviewStreamTableRow({
  tokenId,
  label,
  preview,
  index,
}: Props) {
  const isDepleted = preview.progressPct >= 100 && !preview.claimable;
  const statusLabel = isDepleted
    ? "Depleted"
    : preview.progressPct >= 100
      ? "Fully Vested"
      : "Active";
  const buttonLabel = preview.actionLabel ?? "Withdraw";

  // Parse withdrawable label into amount + token
  const parts = preview.withdrawableLabel.split(" ");
  const amount = parts[0] ?? "0";
  const token = parts.slice(1).join(" ");

  return (
    <>
      {/* Desktop row */}
      <tr
        className="nb-table-row group hidden sm:table-row"
        data-testid={`row-preview-${tokenId}`}
      >
        {/* # */}
        <td className="nb-table-cell w-12 text-center">
          <span className="nb-badge nb-badge-cyan mono text-[10px]">
            {String(index + 1).padStart(2, "0")}
          </span>
        </td>
        {/* Stream */}
        <td className="nb-table-cell">
          <div>
            <span className="text-sm font-bold uppercase tracking-wide text-black">
              OVRFLO #{tokenId}
            </span>
            <span
              className={`nb-badge ml-2 text-[9px] ${isDepleted ? "nb-badge-dark opacity-50" : "nb-badge-active"}`}
            >
              {statusLabel}
            </span>
            <p className="nb-kicker mt-0.5 text-black/40">{label}</p>
          </div>
        </td>
        {/* Streamed */}
        <td className="nb-table-cell w-40">
          <div className="flex items-center gap-2">
            <div className="nb-progress-track-sm flex-1">
              <div
                className="nb-progress-fill"
                style={{
                  width: `${Math.min(preview.progressPct, 100)}%`,
                }}
              />
            </div>
            <span className="mono text-xs font-bold text-[#5dc0f5] whitespace-nowrap">
              {preview.progressPct}%
            </span>
          </div>
        </td>
        {/* Withdrawable */}
        <td className="nb-table-cell">
          <span className="mono text-sm font-bold text-black">{amount}</span>
          <p className="nb-kicker mt-0.5 text-black/30">{token}</p>
        </td>
        {/* Ends */}
        <td className="nb-table-cell">
          <span className="text-sm text-black">{preview.endDateLabel}</span>
        </td>
        {/* Action */}
        <td className="nb-table-cell w-32 text-right">
          <button
            type="button"
            disabled={!preview.claimable}
            className="nb-button nb-button-dark px-3 py-1.5 text-[11px] min-h-0 h-9"
            data-testid={`button-preview-withdraw-${tokenId}`}
          >
            {buttonLabel}
          </button>
        </td>
      </tr>

      {/* Mobile card fallback */}
      <tr className="sm:hidden" data-testid={`row-preview-mobile-${tokenId}`}>
        <td colSpan={6} className="p-0">
          <div className="nb-stream-card mx-0 mb-3 p-4">
            <div className="mb-3 flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="nb-badge nb-badge-cyan mono text-[10px]">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <span className="text-sm font-bold uppercase tracking-wide text-black">
                    OVRFLO #{tokenId}
                  </span>
                  <p className="nb-kicker mt-0.5 text-black/40">{label}</p>
                </div>
              </div>
              <span
                className={`nb-badge text-[9px] ${isDepleted ? "nb-badge-dark opacity-50" : "nb-badge-active"}`}
              >
                {statusLabel}
              </span>
            </div>
            <div className="mb-3 flex items-center gap-2">
              <div className="nb-progress-track-sm flex-1">
                <div
                  className="nb-progress-fill"
                  style={{
                    width: `${Math.min(preview.progressPct, 100)}%`,
                  }}
                />
              </div>
              <span className="mono text-xs font-bold text-[#5dc0f5]">
                {preview.progressPct}%
              </span>
            </div>
            <div className="mb-3 grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="nb-kicker text-black/40">Withdrawable</span>
                <p className="mono mt-0.5 font-bold text-black">{amount}</p>
                <p className="nb-kicker mt-0.5 text-black/30">{token}</p>
              </div>
              <div>
                <span className="nb-kicker text-black/40">Ends</span>
                <p className="mt-0.5 font-bold text-black">
                  {preview.endDateLabel}
                </p>
              </div>
            </div>
            <button
              type="button"
              disabled={!preview.claimable}
              className="nb-button nb-button-dark w-full"
              data-testid={`button-preview-withdraw-mobile-${tokenId}`}
            >
              {buttonLabel}
            </button>
          </div>
        </td>
      </tr>
    </>
  );
}
