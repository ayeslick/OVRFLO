"use client";

// R25/L-2: enumerated lists were truncated in three different places with three
// different levels of honesty. The 500-id scans rendered their own copy, the
// ladder rendered different copy, and the vault/market list at 100 rendered
// nothing at all — markets past the hundredth simply vanished with no
// indication. One component so every truncated list says so the same way, and
// so a fourth capped list cannot quietly skip the disclosure.
//
// `detail` carries what is specific to a surface; the shared half is the shape
// of the sentence and the fact that it is a warning rather than an error — a
// truncated list is incomplete, not broken.
import "@/app/status-warning.css";

export function TruncationNotice({ limit, noun, detail }: { limit: number; noun: string; detail?: string }) {
  return (
    <div className="label mono status-warning" role="status">
      SHOWING FIRST {limit} {noun} — {detail ?? "DATA TRUNCATED"}
    </div>
  );
}
