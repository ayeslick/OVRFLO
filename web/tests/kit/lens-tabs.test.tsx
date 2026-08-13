import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { LensTabs, type LensId } from "@/components/kit/LensTabs";

const TABS = [
  { id: "supplied" as const, label: "SUPPLIED", visible: true },
  { id: "borrowed" as const, label: "BORROWED", visible: true },
  { id: "streams" as const, label: "STREAMS", visible: true },
];

function Harness({ hideStreams = false }: { hideStreams?: boolean }) {
  const [selected, setSelected] = useState<LensId>("supplied");
  return (
    <LensTabs
      selected={selected}
      onSelect={setSelected}
      tabs={TABS.map((tab) => (tab.id === "streams" && hideStreams ? { ...tab, visible: false } : tab))}
    />
  );
}

describe("LensTabs APG tablist", () => {
  it("is a tablist with roving tabindex and automatic activation", () => {
    render(<Harness />);
    const list = screen.getByRole("tablist", { name: "Watch lens" });
    const supplied = screen.getByRole("tab", { name: "SUPPLIED" });
    const borrowed = screen.getByRole("tab", { name: "BORROWED" });
    expect(supplied).toHaveAttribute("aria-selected", "true");
    expect(supplied).toHaveAttribute("tabIndex", "0");
    expect(borrowed).toHaveAttribute("tabIndex", "-1");

    fireEvent.keyDown(list, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "BORROWED" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "BORROWED" })).toHaveAttribute("tabIndex", "0");

    fireEvent.keyDown(list, { key: "End" });
    expect(screen.getByRole("tab", { name: "STREAMS" })).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(list, { key: "Home" });
    expect(screen.getByRole("tab", { name: "SUPPLIED" })).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(list, { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: "STREAMS" })).toHaveAttribute("aria-selected", "true");
  });

  it("hides a zero-count lens instead of rendering it empty", () => {
    render(<Harness hideStreams />);
    expect(screen.queryByRole("tab", { name: "STREAMS" })).not.toBeInTheDocument();
  });
});
