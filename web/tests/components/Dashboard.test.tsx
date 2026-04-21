import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const useDashboardDataMock = vi.fn();

vi.mock("@/hooks/useDashboardData", () => ({
  useDashboardData: () => useDashboardDataMock(),
}));

vi.mock("@/hooks/useUsdPrices", () => ({
  useUsdPrices: () => ({ data: undefined, isLoading: false, error: null }),
}));

vi.mock("@/components/WrongNetworkBanner", () => ({
  WrongNetworkBanner: () => <div>wrong-network-banner</div>,
}));

vi.mock("@/components/NetworkGuard", () => ({
  NetworkGuard: ({ children }: { children: React.ReactNode }) => <>{children}</>,
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
  useDashboardDataMock.mockReturnValue({
    ovrflos: [],
    allMarkets: [],
    streams: [],
    actionsDisabled: true,
    launchReadError: undefined,
  });
});

describe("Dashboard", () => {
  it("renders the single-page shell without stats or tabs", () => {
    render(<Dashboard />);

    expect(screen.getByRole("heading", { name: "My OVRFLOs" })).toBeInTheDocument();
    expect(screen.getByText("stream-list")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New OVRFLO" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Claim" })).toBeDisabled();
    expect(screen.queryByText("Portfolio value")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Active/i })).not.toBeInTheDocument();
  });

  it("shows an actionable factory-read error and disables actions", () => {
    useDashboardDataMock.mockReturnValue({
      ovrflos: [],
      allMarkets: [],
      streams: [],
      actionsDisabled: true,
      launchReadError: new Error("factory unavailable"),
    });

    render(<Dashboard />);

    expect(screen.getByText("Launch data unavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New OVRFLO" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Claim" })).toBeDisabled();
  });
});
