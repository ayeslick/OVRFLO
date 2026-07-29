"use client";

import { useEffect, useState } from "react";

// R27/L-13: `formatAddress` and `formatId` truncate for display with no copy
// affordance and no title attribute, so a user could not recover a full stream
// id, loan id, or address from the UI at all — DESIGN.md §10 requires it.
//
// The full value goes on `title` as well as the clipboard: clipboard access can
// be denied by permissions or unavailable outside a secure context, and a
// hover/focus tooltip still lets someone read the value off the screen.
// The accessible name is deliberately left to the rendered text — the truncated
// value — rather than set with aria-label. An aria-label would override the
// name, so a control that visibly reads "0x7099…79C8" would announce (and be
// queryable as) something else entirely. `title` carries both the purpose and
// the untruncated value as the description.
export function CopyValue({ value, display, label }: { value: string; display: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  // Clear the acknowledgement on a timer, and cancel it on unmount so a card
  // that disappears mid-timeout does not set state on a dead component.
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(id);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      // Denied permission or a non-secure context. The title attribute is the
      // fallback path, so failing silently still leaves the value reachable.
    }
  }

  return (
    <button
      type="button"
      className="copy-value mono"
      title={`${label ?? "Copy"}: ${value}`}
      onClick={copy}
    >
      {display}
      <span aria-hidden="true" className="copy-value-icon">
        {copied ? "✓" : "⧉"}
      </span>
    </button>
  );
}
