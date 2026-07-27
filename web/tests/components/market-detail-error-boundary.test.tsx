import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Address } from "viem";
import { MarketDetail } from "@/components/MarketDetail";
import type { MarketInfo } from "@/lib/types";

// Regression test for pattern #3 (docs/solutions/patterns/ovrflo-critical-patterns.md):
// MarketDetail is the modal actually rendered by MarketsApp (ActionModal's own
// wrapper was dead code — see docs/solutions for the writeup), so the
// ModalErrorBoundary contract must be verified against MarketDetail directly,
// not just against ActionModal or ModalErrorBoundary in isolation.
vi.mock("@/components/ActionModal", async () => {
  const actual = await vi.importActual<typeof import("@/components/ActionModal")>("@/components/ActionModal");
  return {
    ...actual,
    FormBody: () => {
      throw new Error("boom from body");
    },
  };
});

function testAddress(id: number): Address {
  return `0x${id.toString(16).padStart(40, "0")}` as Address;
}

const market: MarketInfo = {
  vault: testAddress(1),
  treasury: testAddress(2),
  underlying: testAddress(3),
  ovrfloToken: testAddress(4),
  lending: testAddress(5),
  market: testAddress(6),
  twapDurationFixed: 900,
  feeBps: 25,
  expiryCached: 1782345600n,
  ptToken: testAddress(7),
  oracle: testAddress(8),
};

describe("MarketDetail error boundary", () => {
  it("swaps a throwing body for the fallback while the header and close button stay mounted", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const onClose = vi.fn();
    render(<MarketDetail market={market} symbols={{}} action={{ type: "supply" }} onClose={onClose} />);

    expect(screen.getByTestId("modal-error-boundary")).toBeInTheDocument();
    // Header title and close button live outside the boundary, so a body-level
    // throw never traps the user without a dismiss path.
    expect(screen.getByText("SUPPLY LIQUIDITY")).toBeInTheDocument();
    const closeButton = screen.getByRole("button", { name: "Close" });
    fireEvent.click(closeButton);
    expect(onClose).toHaveBeenCalledTimes(1);

    errorSpy.mockRestore();
  });
});
