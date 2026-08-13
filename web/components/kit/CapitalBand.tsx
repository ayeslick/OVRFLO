"use client";

import { drawDotRibbon, RIBBON_FUTURE, RIBBON_INK } from "./drawRibbon";
import { useHiDpiCanvas } from "./useHiDpiCanvas";
import "./kit.css";

export type CapitalSegment = {
  id: string;
  fraction: number;
  kind: "filled" | "unfilled";
  divider?: boolean;
};

export type CapitalBandState = "resting" | "segmented" | "degraded";

export function CapitalBand({
  segments,
  state,
  valueText,
  widthPx = 640,
  heightPx = 44,
}: {
  segments: readonly CapitalSegment[];
  state: CapitalBandState;
  valueText: string;
  widthPx?: number;
  heightPx?: number;
}) {
  const canvasRef = useHiDpiCanvas({
    cssWidth: widthPx,
    cssHeight: heightPx,
    animate: false,
    draw: (ctx, w, h) => {
      if (state === "resting") {
        drawDotRibbon(ctx, w, h, [{ fraction: 1, color: RIBBON_FUTURE, rows: 3, inert: true }], null);
        return;
      }
      drawDotRibbon(
        ctx,
        w,
        h,
        segments.map((segment) => ({
          fraction: segment.fraction,
          color: segment.kind === "filled" ? RIBBON_INK : RIBBON_FUTURE,
          rows: 3,
          divider: segment.divider,
        })),
        null,
      );
    },
  });

  const filled = segments.filter((s) => s.kind === "filled").reduce((sum, s) => sum + s.fraction, 0);
  const percent = Math.round(Math.min(1, Math.max(0, filled)) * 100);

  return (
    <div className="kit-ribbon-wrap" data-state={state}>
      <canvas
        ref={canvasRef}
        className="kit-ribbon-canvas"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={valueText}
        data-state={state}
      />
    </div>
  );
}
