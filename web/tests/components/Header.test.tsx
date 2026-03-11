import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const useAccountMock = vi.fn();
const useSwitchChainMock = vi.fn();
const openMock = vi.fn();
const switchChainAsyncMock = vi.fn();

vi.mock("wagmi", () => ({
  useAccount: () => useAccountMock(),
  useSwitchChain: () => useSwitchChainMock(),
}));

vi.mock("@reown/appkit/react", () => ({
  modal: { open: openMock },
}));

const { Header } = await import("@/components/Header");

beforeEach(() => {
  openMock.mockReset();
  switchChainAsyncMock.mockReset();
  useSwitchChainMock.mockReturnValue({ switchChainAsync: switchChainAsyncMock, isPending: false });
  useAccountMock.mockReturnValue({ address: undefined, chainId: undefined });
});

describe("Header", () => {
  it("renders the approved OVERFLOW branding with the landing-page mark", () => {
    render(<Header />);

    expect(screen.getByRole("link", { name: "OVERFLOW" })).toBeInTheDocument();
    expect(screen.getByAltText("Overflow mark")).toHaveAttribute("src", "/brand/overflow-mark.png");
    expect(screen.getByRole("button", { name: "Connect wallet" })).toBeInTheDocument();
    expect(screen.getByRole("banner").className).not.toContain("shadow-[0_4px_0_0_var(--color-border)]");
    expect(screen.getByText("Connect Wallet")).toBeInTheDocument();
  });

  it("opens the Reown connect view when disconnected", () => {
    render(<Header />);

    fireEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
    expect(openMock).toHaveBeenCalledWith({ view: "Connect", namespace: "eip155" });
  });

  it("shows the connected wallet state and opens the account view", () => {
    useAccountMock.mockReturnValue({
      address: "0x1234567890abcdef1234567890abcdef12345678",
      chainId: 1,
    });

    render(<Header />);

    expect(screen.getByText("0x1234…5678")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /open account for wallet/i }));
    expect(openMock).toHaveBeenCalledWith({ view: "Account" });
  });

  it("shows a switch-network action when connected to the wrong chain", () => {
    useAccountMock.mockReturnValue({
      address: "0x1234567890abcdef1234567890abcdef12345678",
      chainId: 42161,
    });

    render(<Header />);

    expect(screen.getByText("Switch Network")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Switch wallet network to Ethereum Mainnet" }));
    expect(switchChainAsyncMock).toHaveBeenCalledWith({ chainId: 1 });
  });
});