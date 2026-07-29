import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CopyValue } from "@/components/CopyValue";

// R27/L-13: truncated values were unrecoverable from the UI — no copy
// affordance and no title exposing the full value.
describe("CopyValue (R27)", () => {
  const FULL = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
  const SHORT = "0x7099…79C8";

  it("takes its accessible name from the visible value", () => {
    // An aria-label here would override the name, so a control reading
    // "0x7099…79C8" on screen would announce something else — and every
    // existing locator matching on the address would silently stop matching.
    render(<CopyValue value={FULL} display={SHORT} label="Copy wallet address" />);
    expect(screen.getByRole("button", { name: SHORT })).toBeInTheDocument();
  });

  it("exposes the untruncated value through title, not only the clipboard", () => {
    // Clipboard access can be denied or unavailable outside a secure context;
    // the title is the path that always works.
    render(<CopyValue value={FULL} display={SHORT} label="Copy wallet address" />);
    expect(screen.getByRole("button", { name: SHORT })).toHaveAttribute(
      "title",
      `Copy wallet address: ${FULL}`,
    );
  });

  it("writes the full value, not the truncated one", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<CopyValue value={FULL} display={SHORT} />);
    fireEvent.click(screen.getByRole("button", { name: SHORT }));

    expect(writeText).toHaveBeenCalledWith(FULL);
  });

  it("survives a denied clipboard without throwing", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.assign(navigator, { clipboard: { writeText } });

    render(<CopyValue value={FULL} display={SHORT} />);
    fireEvent.click(screen.getByRole("button", { name: SHORT }));

    // Still rendered, still readable via title.
    expect(await screen.findByRole("button", { name: SHORT })).toBeInTheDocument();
  });
});
