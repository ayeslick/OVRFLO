import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { Converter } from "@/components/assets/Converter";
import type { ReceiptLine } from "@/components/kit/Receipt";
import type { TraceStep } from "@/components/kit/SettlementTrace";

const WAD = 10n ** 18n;
const ready = (value: bigint) => ({ status: "ready" as const, value });

const wrapSteps: TraceStep[] = [
  { id: "amount", label: "AMOUNT", state: "active" },
  { id: "approve", label: "APPROVE wstETH", state: "pending" },
  { id: "wrap", label: "WRAP", state: "pending" },
  { id: "settled", label: "SETTLED", state: "pending" },
];

const permission: ReceiptLine[] = [
  { key: "TOKEN", value: "wstETH" },
  { key: "ALLOWANCE", value: "1.00000 wstETH" },
  { key: "MATCH", value: "EXACT" },
];

const action: ReceiptLine[] = [
  { key: "ACTION", value: "WRAP" },
  { key: "AMOUNT", value: "1.00 wstETH" },
  { key: "OUTPUT", value: "1.00 ovrfloWSTETH" },
];

function renderConverter(overrides: Partial<ComponentProps<typeof Converter>> = {}) {
  const props: ComponentProps<typeof Converter> = {
    direction: "wrap",
    onDirection: vi.fn(),
    underlyingSymbol: "wstETH",
    ovrfloSymbol: "ovrfloWSTETH",
    destination: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    walletUnderlying: ready(5n * WAD),
    walletOvrflo: ready(2n * WAD),
    wrapReserve: ready(3n * WAD),
    matured: false,
    amountRaw: "1",
    amountWei: 1n * WAD,
    onAmount: vi.fn(),
    unwrapAvailability: "enabled",
    outputState: "ready",
    outputLabel: "1 ovrfloWSTETH",
    stage: "amount",
    steps: wrapSteps,
    permissionLines: permission,
    permissionState: "ghosted",
    actionLines: action,
    actionState: "ghosted",
    connected: true,
    ...overrides,
  };
  return { ...render(<Converter {...props} />), props };
}

describe("Converter three-bay geometry", () => {
  it("renders reserve, wrap/unwrap center with OUTPUT, and claim-on-PT copy", () => {
    renderConverter();
    expect(screen.getByText("RESERVE")).toBeInTheDocument();
    expect(screen.getByText("WRAP RESERVE")).toBeInTheDocument();
    expect(screen.getByText(/vault accounting figure/i)).toBeInTheDocument();
    expect(screen.getByText("CONVERT 1:1")).toBeInTheDocument();
    expect(screen.getByText("OUTPUT")).toBeInTheDocument();
    expect(screen.getByText("1 ovrfloWSTETH")).toBeInTheDocument();
    expect(screen.getByText("OVRFLO TOKEN")).toBeInTheDocument();
    expect(screen.getByText(/equal claim on eligible PT after maturity/i)).toBeInTheDocument();
    expect(screen.getByText(/not a claim on wstETH/i)).toBeInTheDocument();
    expect(screen.queryByText(/OUTPUT \(EST/i)).not.toBeInTheDocument();
  });

  it("wraps 1:1 with exact allowance copy and no fee", () => {
    const onApprove = vi.fn();
    renderConverter({
      stage: "approve",
      permissionState: "current",
      onApprove,
      approveLabel: "APPROVE wstETH",
    });
    expect(screen.getByText("PERMISSION RECEIPT")).toBeInTheDocument();
    expect(screen.getByText("EXACT")).toBeInTheDocument();
    expect(screen.getByText("NONE")).toBeInTheDocument();
    expect(screen.queryByText("CONFIRMED")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "APPROVE wstETH" }));
    expect(onApprove).toHaveBeenCalledOnce();
  });

  it("unwrap has no approval checkpoint", () => {
    renderConverter({
      direction: "unwrap",
      stage: "sign",
      outputLabel: "1 wstETH",
      permissionState: "skipped",
      submitLabel: "UNWRAP",
      onSubmit: vi.fn(),
      steps: [
        { id: "unwrap", label: "UNWRAP", state: "active" },
        { id: "settled", label: "SETTLED", state: "pending" },
      ],
    });
    expect(screen.queryByText("PERMISSION RECEIPT")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "UNWRAP" }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /APPROVE/ })).not.toBeInTheDocument();
  });

  it("reserve-insufficient unwrap is an unavailable route showing available reserve", () => {
    renderConverter({
      direction: "unwrap",
      unwrapAvailability: "disabled-reserve",
      availableReserveLabel: "0.50 wstETH",
      continueDisabled: true,
      continueReason: "UNWRAP UNAVAILABLE — RESERVE",
    });
    expect(screen.getByText("UNWRAP UNAVAILABLE")).toBeInTheDocument();
    expect(screen.getByText(/Available reserve 0.50 wstETH/)).toBeInTheDocument();
    expect(screen.getByText(/not a failed unwrap and not a failed claim/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "WRAP" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "CONTINUE" })).toBeDisabled();
  });

  it("does not render unwrap as zero or failed when reserve is loading", () => {
    renderConverter({
      wrapReserve: { status: "loading" },
      walletUnderlying: { status: "loading" },
    });
    expect(screen.getAllByText("CHECKING…").length).toBeGreaterThan(0);
    expect(screen.queryByText("0.00000 wstETH")).not.toBeInTheDocument();
  });

  it("replaces unwrap with CLAIM PT after maturity", () => {
    renderConverter({
      matured: true,
      claimVisible: true,
      onClaim: vi.fn(),
    });
    expect(screen.queryByRole("button", { name: "UNWRAP" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "CLAIM PT" })).toBeInTheDocument();
  });

  it("disconnected copy is CONNECT WALLET, not zero", () => {
    renderConverter({ connected: false });
    expect(screen.getAllByText("CONNECT WALLET").length).toBeGreaterThan(0);
  });
});
