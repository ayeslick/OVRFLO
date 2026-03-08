import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const useOvrfloCountMock = vi.fn();
const useOvrfloAddressesMock = vi.fn();
const useOvrfloInfosMock = vi.fn();
const useAllMarketsMock = vi.fn();

vi.mock("@/hooks/useOvrflos", () => ({
  useOvrfloCount: () => useOvrfloCountMock(),
  useOvrfloAddresses: () => useOvrfloAddressesMock(),
  useOvrfloInfos: () => useOvrfloInfosMock(),
}));

vi.mock("@/hooks/useAllMarkets", () => ({
  useAllMarkets: () => useAllMarketsMock(),
}));

vi.mock("@/components/WrongNetworkBanner", () => ({
  WrongNetworkBanner: () => <div>wrong-network-banner</div>,
}));

vi.mock("@/components/StreamList", () => ({
  StreamList: () => <div>stream-list</div>,
}));

vi.mock("@/components/NewOvrfloModal", () => ({
  NewOvrfloModal: () => null,
}));

vi.mock("@/components/ClaimModal", () => ({
  ClaimModal: () => null,
}));

const { Dashboard } = await import("@/components/Dashboard");

beforeEach(() => {
  useOvrfloCountMock.mockReturnValue({
    data: [{ status: "success", result: 0n }],
    error: undefined,
  });
  useOvrfloAddressesMock.mockReturnValue({ data: [], error: undefined });
  useOvrfloInfosMock.mockReturnValue({ data: [], error: undefined });
  useAllMarketsMock.mockReturnValue({
    markets: [],
    isLoading: false,
    error: undefined,
  });
});

describe("Dashboard", () => {
  it("shows an actionable factory-read error and disables actions", () => {
    useOvrfloCountMock.mockReturnValue({
      data: [{ status: "failure", error: new Error("factory unavailable") }],
      error: undefined,
    });

    render(<Dashboard />);

    expect(screen.getByText("Unable to load OVRFLO markets")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New OVRFLO" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Claim" })).toBeDisabled();
  });
});