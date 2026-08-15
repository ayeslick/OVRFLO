"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { formatTokenFromWei, interpolateAmount } from "./formatDisplay";
import { getReducedMotion, subscribeReducedMotion } from "./motion";
import { subscribeRaf } from "./rafDriver";
import "./kit.css";
import "./hero-rolling.css";

export type RollingSchedule = {
  startMs: number;
  endMs: number;
  startAmount: bigint;
  endAmount: bigint;
};

export function RollingNumber({
  value,
  schedule,
  nowMs,
  decimals = 18,
  displayDecimals = 8,
  locale = "en-US",
  ticking = false,
  accent,
  milestone,
  widthCh,
}: {
  value?: bigint;
  schedule?: RollingSchedule;
  nowMs?: number;
  decimals?: number;
  displayDecimals?: number;
  locale?: string;
  ticking?: boolean;
  accent?: "gold";
  milestone?: string;
  widthCh?: number;
}) {
  const staticValue = value ?? schedule?.endAmount ?? 0n;
  const reducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotion,
    () => false,
  );

  const formattedStatic = useMemo(
    () => formatTokenFromWei(staticValue, decimals, displayDecimals, locale),
    [decimals, displayDecimals, locale, staticValue],
  );

  const [text, setText] = useState(formattedStatic);

  useEffect(() => {
    if (nowMs !== undefined && schedule) {
      const amount = interpolateAmount({ ...schedule, nowMs });
      setText(formatTokenFromWei(amount, decimals, displayDecimals, locale));
      return;
    }
    if (!ticking || !schedule) {
      setText(formattedStatic);
      return;
    }
    // Under reduced motion, still paint vested math once. Skip continuous RAF
    // decorative updates when the parent does not pass nowMs.
    if (reducedMotion) {
      setText(
        formatTokenFromWei(
          interpolateAmount({ ...schedule, nowMs: Date.now() }),
          decimals,
          displayDecimals,
          locale,
        ),
      );
      return;
    }
    let last = "";
    const paint = () => {
      const amount = interpolateAmount({ ...schedule, nowMs: Date.now() });
      const next = formatTokenFromWei(amount, decimals, displayDecimals, locale);
      if (next === last) return;
      last = next;
      setText(next);
    };
    paint();
    return subscribeRaf(paint);
  }, [decimals, displayDecimals, formattedStatic, locale, nowMs, reducedMotion, schedule, ticking]);

  const capacity = useMemo(() => {
    if (widthCh !== undefined) return widthCh;
    const candidates = [formattedStatic];
    if (schedule) {
      candidates.push(formatTokenFromWei(schedule.startAmount, decimals, displayDecimals, locale));
      candidates.push(formatTokenFromWei(schedule.endAmount, decimals, displayDecimals, locale));
    }
    return Math.max(12, ...candidates.map((item) => item.length));
  }, [decimals, displayDecimals, formattedStatic, locale, schedule, widthCh]);

  return (
    <span
      className="kit-rolling"
      data-accent={accent}
      data-ticking={ticking ? "true" : "false"}
      data-reduced-motion={reducedMotion ? "true" : "false"}
      role={ticking ? "timer" : undefined}
      style={{ width: `${capacity}ch`, fontVariantNumeric: "tabular-nums" }}
    >
      {text}
      {milestone ? (
        <span className="kit-rolling-live" aria-live="polite">
          {milestone}
        </span>
      ) : null}
    </span>
  );
}
