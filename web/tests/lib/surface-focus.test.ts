import { describe, expect, it } from "vitest";
import { openerFocusKey, restoreOpenerOrHeading } from "@/lib/surface-focus";

describe("surface focus", () => {
  it("restores a remounted opener by data-focus-key", () => {
    document.body.innerHTML = `
      <button type="button" data-focus-key="LOAN #012">LOAN #012</button>
      <h2 tabindex="-1" data-surface-heading>Self-Repaying Loan</h2>
    `;
    const heading = document.querySelector<HTMLElement>("[data-surface-heading]");
    const detached = document.createElement("button");
    detached.setAttribute("data-focus-key", "LOAN #012");
    restoreOpenerOrHeading(detached, heading, openerFocusKey(detached));
    expect(document.activeElement).toHaveTextContent("LOAN #012");
  });

  it("falls back to the heading when no opener remains", () => {
    document.body.innerHTML = `<h2 tabindex="-1" data-surface-heading>Outcome</h2>`;
    const heading = document.querySelector<HTMLElement>("[data-surface-heading]");
    heading?.focus();
    restoreOpenerOrHeading(null, heading, "missing");
    expect(document.activeElement).toBe(heading);
  });
});
