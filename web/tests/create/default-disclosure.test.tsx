import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DefaultHub } from "@/components/kit/DefaultHub";

const FORBIDDEN = /\b(APY|protocol|router|PT|market|route)\b/i;

describe("Default create disclosure", () => {
  it("offers two position types without protocol labels", () => {
    const { container } = render(<DefaultHub welcome="Choose a position type" />);
    const cards = container.querySelector(".default-hub-types");
    expect(cards?.textContent).toMatch(/Self-Repaying Loan/);
    expect(cards?.textContent).toMatch(/Fixed Return/);
    expect(container.querySelector("[data-type=loan]")).toHaveAttribute("href", "/borrow/");
    expect(container.querySelector("[data-type=fixed]")).toHaveAttribute("href", "/supply/");
    expect(cards?.textContent ?? "").not.toMatch(FORBIDDEN);
  });
});
