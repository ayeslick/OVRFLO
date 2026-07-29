import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RateLadder } from "@/components/RateLadder";

// R15/M-4. The group already claimed role="radiogroup" with role="radio"
// children but behaved like a row of plain buttons: every option sat in the tab
// order and arrow keys did nothing. A radiogroup is a single tab stop.

function rows() {
  return [
    { aprBps: 1000, cells: ["a"] },
    { aprBps: 1100, cells: ["b"] },
    { aprBps: 1200, cells: ["c"], best: true },
  ];
}

function renderLadder(selected: number | null = null) {
  const onSelect = vi.fn();
  const utils = render(
    <RateLadder label="Rates" rows={rows()} selectedAprBps={selected} onSelect={onSelect} emptyText="NONE" />,
  );
  return { ...utils, onSelect, options: screen.getAllByRole("radio") };
}

describe("rate ladder keyboard model (R15)", () => {
  it("is one tab stop: only the selected option is tabbable", () => {
    const { options } = renderLadder(1100);
    expect(options.map((o) => o.getAttribute("tabindex"))).toEqual(["-1", "0", "-1"]);
  });

  it("puts the tab stop on the first option when nothing is selected", () => {
    // Otherwise the group is unreachable by keyboard before a first choice.
    const { options } = renderLadder(null);
    expect(options.map((o) => o.getAttribute("tabindex"))).toEqual(["0", "-1", "-1"]);
  });

  it("ArrowDown and ArrowRight move to the next option", () => {
    const { options, onSelect } = renderLadder(1000);
    fireEvent.keyDown(options[0], { key: "ArrowDown" });
    expect(onSelect).toHaveBeenCalledWith(1100);

    onSelect.mockClear();
    fireEvent.keyDown(options[0], { key: "ArrowRight" });
    expect(onSelect).toHaveBeenCalledWith(1100);
  });

  it("ArrowUp and ArrowLeft move to the previous option", () => {
    const { options, onSelect } = renderLadder(1100);
    fireEvent.keyDown(options[1], { key: "ArrowUp" });
    expect(onSelect).toHaveBeenCalledWith(1000);

    onSelect.mockClear();
    fireEvent.keyDown(options[1], { key: "ArrowLeft" });
    expect(onSelect).toHaveBeenCalledWith(1000);
  });

  it("wraps at both ends", () => {
    const { options, onSelect } = renderLadder(1000);
    fireEvent.keyDown(options[0], { key: "ArrowUp" });
    expect(onSelect).toHaveBeenCalledWith(1200);

    onSelect.mockClear();
    fireEvent.keyDown(options[2], { key: "ArrowDown" });
    expect(onSelect).toHaveBeenCalledWith(1000);
  });

  it("Home and End jump to the first and last option", () => {
    const { options, onSelect } = renderLadder(1100);
    fireEvent.keyDown(options[1], { key: "Home" });
    expect(onSelect).toHaveBeenCalledWith(1000);

    onSelect.mockClear();
    fireEvent.keyDown(options[1], { key: "End" });
    expect(onSelect).toHaveBeenCalledWith(1200);
  });

  it("moves focus along with selection", () => {
    // The radiogroup pattern announces each option as arrowing selects it;
    // selection without focus would leave a screen reader on the old row.
    const { options } = renderLadder(1000);
    options[0].focus();
    fireEvent.keyDown(options[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(options[1]);
  });

  it("leaves other keys to the browser", () => {
    const { options, onSelect } = renderLadder(1000);
    fireEvent.keyDown(options[0], { key: "Tab" });
    fireEvent.keyDown(options[0], { key: "a" });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("still selects on click", () => {
    const { options, onSelect } = renderLadder(1000);
    fireEvent.click(options[2]);
    expect(onSelect).toHaveBeenCalledWith(1200);
  });

  it("reflects selection in aria-checked, not only in a class", () => {
    const { options } = renderLadder(1100);
    expect(options.map((o) => o.getAttribute("aria-checked"))).toEqual(["false", "true", "false"]);
  });
});
