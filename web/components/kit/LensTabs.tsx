"use client";

import { useCallback, type KeyboardEvent } from "react";
import "./kit.css";

export type LensId = "supplied" | "borrowed" | "streams";

export type LensTab = {
  id: LensId;
  label: string;
  visible: boolean;
  state?: "ready" | "loading" | "unavailable";
};

export function LensTabs({
  tabs,
  selected,
  onSelect,
}: {
  tabs: readonly LensTab[];
  selected: LensId;
  onSelect: (id: LensId) => void;
}) {
  const visible = tabs.filter((tab) => tab.visible);
  const selectedIndex = visible.findIndex((tab) => tab.id === selected);

  const activateAt = useCallback(
    (index: number) => {
      const tab = visible[index];
      if (!tab) return;
      onSelect(tab.id);
      document.getElementById(`lens-tab-${tab.id}`)?.focus();
    },
    [onSelect, visible],
  );

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (visible.length === 0) return;
    const last = visible.length - 1;
    const current = selectedIndex < 0 ? 0 : selectedIndex;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      activateAt(current === last ? 0 : current + 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      activateAt(current === 0 ? last : current - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      activateAt(0);
    } else if (event.key === "End") {
      event.preventDefault();
      activateAt(last);
    }
  }

  return (
    <div
      className="kit-lens"
      role="tablist"
      aria-label="Watch lens"
      data-ui="UI-WATCH-LENS"
      onKeyDown={onKeyDown}
    >
      {visible.map((tab) => {
        const isSelected = tab.id === selected;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`lens-tab-${tab.id}`}
            aria-selected={isSelected}
            aria-controls={`lens-panel-${tab.id}`}
            tabIndex={isSelected ? 0 : -1}
            data-state={tab.state ?? "ready"}
            onClick={() => onSelect(tab.id)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
