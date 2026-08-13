import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Address } from "viem";
import { FirstRun } from "@/components/first-run/FirstRun";
import { TEACHING_SENTENCES } from "@/components/first-run/cycleCopy";

const ACCOUNT = "0x00000000000000000000000000000000000000a1" as Address;

vi.mock("wagmi", () => ({
  useConnection: () => ({
    addresses: [ACCOUNT],
    chainId: 1,
    status: "connected",
  }),
  useReadContracts: () => ({
    data: undefined,
    isLoading: false,
  }),
}));

vi.mock("@/hooks/useAllMarkets", () => ({
  useAllMarkets: () => ({
    markets: [],
    status: "ready",
    isLoading: false,
    error: null,
  }),
}));

describe("FirstRun container", () => {
  it("renders the guided path for a protocol-empty wallet (AE5)", () => {
    render(<FirstRun />);
    expect(screen.getByText(TEACHING_SENTENCES[0])).toBeInTheDocument();
    expect(screen.getByText("mints the market's ovrflo token")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /I ALREADY HOLD PT/i })).toHaveAttribute("href", "/assets");
    expect(screen.queryByRole("meter")).not.toBeInTheDocument();
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();
    expect(document.querySelector('[data-control="UI-FIRST-RUN-INTENT-BORROW"]')).toHaveAttribute(
      "data-state",
      "degraded",
    );
  });
});
