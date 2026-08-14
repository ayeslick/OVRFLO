"use client";

import { useMemo } from "react";
import { drawDotRibbon, RIBBON_FUTURE, RIBBON_GOLD, RIBBON_INK } from "./drawRibbon";
import { progress01 } from "./formatDisplay";
import { useHiDpiCanvas } from "./useHiDpiCanvas";
import "./kit.css";
import "./forced-colors.css";

export type RibbonState = "recorded" | "edge" | "future" | "inert" | "degraded";

export function Ribbon({
  progress,
  state,
  valueText,
  originLabel,
  terminalLabel,
  widthPx = 640,
  heightPx = 36,
  nowMs,
  startMs,
  endMs,
}: {
  progress?: number;
  state: RibbonState;
  valueText: string;
  originLabel: string;
  terminalLabel: string;
  widthPx?: number;
  heightPx?: number;
  nowMs?: number;
  startMs?: number;
  endMs?: number;
}) {
  const inert = state === "inert";
  const frac = useMemo(() => {
    if (typeof progress === "number") return Math.min(1, Math.max(0, progress));
    if (nowMs !== undefined && startMs !== undefined && endMs !== undefined) {
      return progress01(nowMs, startMs, endMs);
    }
    return 0;
  }, [endMs, nowMs, progress, startMs]);

  const canvasRef = useHiDpiCanvas({
    cssWidth: widthPx,
    cssHeight: heightPx,
    animate: !inert && state !== "recorded",
    draw: (ctx, w, h, frameNow) => {
      const live =
        nowMs === undefined && startMs !== undefined && endMs !== undefined
          ? progress01(frameNow, startMs, endMs)
          : frac;
      const clamped = Math.min(1, Math.max(0, live));
      if (inert) {
        drawDotRibbon(
          ctx,
          w,
          h,
          [{ fraction: 1, color: RIBBON_FUTURE, rows: 3, inert: true }],
          null,
        );
        return;
      }
      drawDotRibbon(
        ctx,
        w,
        h,
        [
          { fraction: clamped, color: state === "degraded" ? RIBBON_INK : RIBBON_INK, rows: 3 },
          { fraction: 1 - clamped, color: RIBBON_FUTURE, rows: 3 },
        ],
        { fraction: clamped, color: RIBBON_GOLD },
      );
    },
  });

  const percent = Math.round(frac * 1000) / 10;

  return (
    <div className="kit-ribbon-wrap" data-state={state}>
      <div className="kit-ribbon-labels">
        <span>{originLabel}</span>
        <span>{terminalLabel}</span>
      </div>
      <canvas
        ref={canvasRef}
        className="kit-ribbon-canvas"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={valueText}
        data-state={state}
        data-progress={String(frac)}
      />
    </div>
  );
}
