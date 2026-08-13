import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Converter } from "@/components/assets/Converter";
import { StreamCreate } from "@/components/assets/StreamCreate";
import { streamTrace, unwrapTrace, wrapTrace } from "@/components/assets/trace";
import { WatchWrite } from "@/components/watch/WatchWrite";
import { Receipt } from "@/components/kit/Receipt";
import { ActionButton } from "@/components/kit/ActionButton";
import type { ComponentProps } from "react";
import {
  LENDING,
  MARKET,
  SCALE,
  SYMBOL,
  TOKEN,
  UNDERLYING,
  VAULT,
  EXPIRY,
  filledPosition,
  activeLoan,
  noop,
  stubViewport,
  TRANSACTING_WIDTHS,
} from "./fixtures";

const WAD = SCALE;
const ready = (value: bigint) => ({ status: "ready" as const, value });

const writeFx = vi.hoisted(() => ({
  isSigning: false,
  isConfirming: false,
  isConfirmed: false,
  isReverted: false,
  isInFlight: false,
  error: null as Error | null,
  hash: undefined as `0x${string}` | undefined,
  acknowledged: true,
}));

vi.mock("wagmi", () => ({
  useConnection: () => ({
    status: "connected",
    addresses: ["0x70997970C51812dc3A010C7d01b50e0d17dc79C8"],
    chainId: 1,
  }),
}));

vi.mock("@/hooks/useWriteFlow", () => ({
  useWriteFlow: () => ({
    writeContract: vi.fn(),
    reset: vi.fn(),
    isSigning: writeFx.isSigning,
    isConfirming: writeFx.isConfirming,
    isConfirmed: writeFx.isConfirmed,
    isReverted: writeFx.isReverted,
    isInFlight: writeFx.isInFlight,
    error: writeFx.error,
    hash: writeFx.hash,
  }),
}));

vi.mock("@/hooks/useAcknowledgment", () => ({
  useAcknowledgment: () => ({
    acknowledged: writeFx.acknowledged,
    ready: true,
    acknowledge: vi.fn(),
  }),
}));

vi.mock("@/hooks/useChainGuard", () => ({
  useChainGuard: () => ({
    wrongChain: false,
    connectedChainId: 1,
    expectedChainId: 1,
    switchChain: vi.fn(),
    isSwitching: false,
    switchError: null,
  }),
}));

function resetWrite() {
  writeFx.isSigning = false;
  writeFx.isConfirming = false;
  writeFx.isConfirmed = false;
  writeFx.isReverted = false;
  writeFx.isInFlight = false;
  writeFx.error = null;
  writeFx.hash = undefined;
  writeFx.acknowledged = true;
}

const watchMarket = {
  vault: VAULT,
  lending: LENDING,
  market: MARKET,
  underlying: TOKEN,
  ovrfloToken: TOKEN,
  ptToken: TOKEN,
  expiryCached: EXPIRY,
};

function converter(overrides: Partial<ComponentProps<typeof Converter>> = {}) {
  const props: ComponentProps<typeof Converter> = {
    direction: "wrap",
    onDirection: vi.fn(),
    underlyingSymbol: UNDERLYING,
    ovrfloSymbol: SYMBOL,
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
    outputLabel: `1 ${SYMBOL}`,
    stage: "amount",
    steps: wrapTrace({
      underlyingSymbol: UNDERLYING,
      needsApprove: true,
      ackRequired: false,
      stage: "amount",
    }),
    permissionLines: [
      { key: "TOKEN", value: UNDERLYING },
      { key: "ALLOWANCE", value: `1.00000 ${UNDERLYING}` },
      { key: "MATCH", value: "EXACT" },
    ],
    permissionState: "ghosted",
    actionLines: [
      { key: "ACTION", value: "WRAP" },
      { key: "AMOUNT", value: `1.00 ${UNDERLYING}` },
    ],
    actionState: "ghosted",
    connected: true,
    ...overrides,
  };
  return render(<Converter {...props} />);
}

describe.each(TRANSACTING_WIDTHS)("inventory — claim / unwrap / wrap / repay / stream at %ipx", (width) => {
  beforeEach(() => {
    stubViewport(width);
    resetWrite();
  });

  it("19+G CLAIM_CONFIRMED unwrap-enabled — payout is ovrflo token; unwrap route open", () => {
    writeFx.isConfirmed = true;
    const position = filledPosition();
    render(
      <WatchWrite
        kind="claim"
        lending={LENDING}
        market={watchMarket}
        positionId={position.id}
        claimPairs={position.pairs}
        claimable={position.pairs[0]!.claimable}
        symbol={SYMBOL}
        signingAllowed
        onClose={noop}
      />,
    );
    expect(screen.getByText("ACTION RECEIPT")).toBeInTheDocument();
    expect(screen.getByText("PAYOUT")).toBeInTheDocument();
    expect(screen.getByText(SYMBOL)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "DONE" })).toBeInTheDocument();
    expect(screen.queryByText(/CLAIM ALL/i)).not.toBeInTheDocument();

    converter({
      direction: "unwrap",
      unwrapAvailability: "enabled",
      outputLabel: `1 ${UNDERLYING}`,
      stage: "amount",
      steps: unwrapTrace({ ackRequired: false, stage: "amount" }),
    });
    expect(screen.getByRole("button", { name: "UNWRAP" })).toBeEnabled();
    expect(screen.queryByText("UNWRAP UNAVAILABLE")).not.toBeInTheDocument();
  });

  it("20+G CLAIM_CONFIRMED reserve-insufficient — unwrap disabled; claim is not a failure", () => {
    writeFx.isConfirmed = true;
    render(
      <WatchWrite
        kind="claim"
        lending={LENDING}
        market={watchMarket}
        positionId={26n}
        claimable={12n * 10n ** 16n}
        symbol={SYMBOL}
        signingAllowed
        onClose={noop}
      />,
    );
    expect(screen.getByText("PAYOUT")).toBeInTheDocument();

    converter({
      direction: "unwrap",
      unwrapAvailability: "disabled-reserve",
      availableReserveLabel: `0.50 ${UNDERLYING}`,
      continueDisabled: true,
      continueReason: "UNWRAP UNAVAILABLE — RESERVE",
      outputLabel: "",
      stage: "amount",
      steps: unwrapTrace({ ackRequired: false, stage: "amount" }),
    });
    expect(screen.getByText("UNWRAP UNAVAILABLE")).toBeInTheDocument();
    expect(screen.getByText(/Available reserve 0.50 wstETH/)).toBeInTheDocument();
    expect(screen.getByText(/not a failed unwrap and not a failed claim/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "CONTINUE" })).toBeDisabled();
  });

  it("21 UNWRAP_REVIEW + UNWRAP_CONFIRMED — no approval; 1:1 received", () => {
    converter({
      direction: "unwrap",
      stage: "sign",
      outputLabel: `1 ${UNDERLYING}`,
      permissionState: "skipped",
      submitLabel: "UNWRAP",
      onSubmit: vi.fn(),
      steps: unwrapTrace({ ackRequired: false, stage: "unwrap" }),
      actionLines: [{ key: "ACTION", value: "UNWRAP" }],
      actionState: "frozen-review",
    });
    expect(screen.queryByText("PERMISSION RECEIPT")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "UNWRAP" }).length).toBeGreaterThan(0);

    converter({
      direction: "unwrap",
      stage: "confirmed",
      outputLabel: `1 ${UNDERLYING}`,
      permissionState: "skipped",
      confirmedCopy: `RECEIVED 1.00 ${UNDERLYING}`,
      steps: unwrapTrace({ ackRequired: false, stage: "confirmed" }),
      actionLines: [{ key: "ACTION", value: "UNWRAP" }],
      actionState: "confirmed",
    });
    expect(screen.getByText(`RECEIVED 1.00 ${UNDERLYING}`)).toBeInTheDocument();
  });

  it("22 STREAM.REVIEW + APPROVE_PT + APPROVE_FEE — fee buffer lines; CONFIRMED reserved", () => {
    const streamMarket = MARKET;
    const { rerender } = render(
      <StreamCreate
        stage="review"
        marketStatus="ready"
        markets={[]}
        selectedMarket={streamMarket}
        onSelectMarket={noop}
        underlyingSymbol={UNDERLYING}
        ovrfloSymbol={SYMBOL}
        amountRaw="10"
        onAmount={noop}
        ptBalanceLabel="20.00 PT"
        onContinue={noop}
        steps={streamTrace({ needsPt: true, needsFee: true, ackRequired: false, stage: "review" })}
        ptIn={10n * WAD}
        minted={9n * WAD}
        streamAmount={1n * WAD}
        currentFee={1n * WAD}
        boundedApproval={(102n * WAD) / 100n}
        maturity={EXPIRY}
        permissionLines={[
          { key: "CURRENT FEE", value: `1.00 ${UNDERLYING}` },
          { key: "BOUNDED APPROVAL", value: `1.02 ${UNDERLYING}` },
        ]}
        permissionState="ghosted"
        actionLines={[{ key: "ACTION", value: "DEPOSIT" }]}
        actionState="frozen-review"
      />,
    );
    expect(screen.getByText("PT IN")).toBeInTheDocument();
    expect(screen.getAllByText("CURRENT FEE").length).toBeGreaterThan(0);
    expect(screen.getAllByText("BOUNDED APPROVAL").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "REVIEW DEPOSIT" })).toBeInTheDocument();

    rerender(
      <StreamCreate
        stage="approve-pt"
        marketStatus="ready"
        markets={[]}
        selectedMarket={streamMarket}
        onSelectMarket={noop}
        underlyingSymbol={UNDERLYING}
        ovrfloSymbol={SYMBOL}
        amountRaw="10"
        onAmount={noop}
        ptBalanceLabel="20.00 PT"
        onContinue={noop}
        onApprovePt={noop}
        steps={streamTrace({ needsPt: true, needsFee: true, ackRequired: false, stage: "approve-pt" })}
        ptIn={10n * WAD}
        minted={9n * WAD}
        streamAmount={1n * WAD}
        currentFee={1n * WAD}
        boundedApproval={(102n * WAD) / 100n}
        permissionLines={[{ key: "TOKEN", value: "PT" }, { key: "MATCH", value: "MATCH EXACT" }]}
        permissionState="current"
        actionLines={[{ key: "ACTION", value: "DEPOSIT" }]}
        actionState="ghosted"
      />,
    );
    expect(screen.getByRole("button", { name: "APPROVE PT" })).toBeInTheDocument();
    expect(screen.queryByText("CONFIRMED")).not.toBeInTheDocument();

    rerender(
      <StreamCreate
        stage="approve-fee"
        marketStatus="ready"
        markets={[]}
        selectedMarket={streamMarket}
        onSelectMarket={noop}
        underlyingSymbol={UNDERLYING}
        ovrfloSymbol={SYMBOL}
        amountRaw="10"
        onAmount={noop}
        ptBalanceLabel="20.00 PT"
        onContinue={noop}
        onApproveFee={noop}
        steps={streamTrace({ needsPt: true, needsFee: true, ackRequired: false, stage: "approve-fee" })}
        ptIn={10n * WAD}
        minted={9n * WAD}
        streamAmount={1n * WAD}
        currentFee={1n * WAD}
        boundedApproval={(102n * WAD) / 100n}
        permissionLines={[
          { key: "CURRENT FEE", value: `1.00 ${UNDERLYING}` },
          { key: "BOUNDED APPROVAL", value: `1.02 ${UNDERLYING}` },
        ]}
        permissionState="current"
        actionLines={[{ key: "ACTION", value: "DEPOSIT" }]}
        actionState="ghosted"
      />,
    );
    expect(screen.getByRole("button", { name: "APPROVE FEE" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "DEPOSIT" })).not.toBeInTheDocument();
  });

  it("23 ASSETS.WRAP_AMOUNT + WRAP_APPROVE + WRAP_CONFIRMED", () => {
    converter();
    expect(screen.getByText("CONVERT 1:1")).toBeInTheDocument();
    expect(screen.getByText("OUTPUT")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "CONTINUE" })).toBeInTheDocument();

    converter({
      stage: "approve",
      permissionState: "current",
      onApprove: vi.fn(),
      approveLabel: `APPROVE ${UNDERLYING}`,
      steps: wrapTrace({
        underlyingSymbol: UNDERLYING,
        needsApprove: true,
        ackRequired: false,
        stage: "approve",
      }),
    });
    expect(screen.getByText("PERMISSION RECEIPT")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "APPROVE wstETH" })).toBeInTheDocument();
    expect(screen.queryByText("CONFIRMED")).not.toBeInTheDocument();

    converter({
      stage: "confirmed",
      permissionState: "skipped",
      confirmedCopy: `RECEIVED 1.00 ${SYMBOL}`,
      steps: wrapTrace({
        underlyingSymbol: UNDERLYING,
        needsApprove: true,
        ackRequired: false,
        stage: "confirmed",
      }),
      actionState: "confirmed",
    });
    expect(screen.getByText(`RECEIVED 1.00 ${SYMBOL}`)).toBeInTheDocument();
  });

  it("24 REPAY_AMOUNT + REPAY_PREPARE wrap shortfall + REPAY_APPROVE + REPAY_CONFIRMED", () => {
    const loan = activeLoan();
    const amount = render(
      <WatchWrite
        kind="repay"
        lending={LENDING}
        market={watchMarket}
        loanId={loan.id}
        outstanding={loan.outstanding}
        symbol={SYMBOL}
        signingAllowed
        onClose={noop}
      />,
    );
    expect(screen.getByLabelText("REPAY AMOUNT")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "REPAY" })).toBeInTheDocument();
    expect(screen.getByText("ACTION RECEIPT")).toBeInTheDocument();
    amount.unmount();

    const prepare = converter({
      direction: "wrap",
      amountRaw: "1",
      amountWei: 1n * WAD,
      walletOvrflo: ready(0n),
      walletUnderlying: ready(5n * WAD),
    });
    expect(screen.getByText("WRAP RESERVE")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "WRAP" })).toBeEnabled();
    prepare.unmount();

    const approve = render(
      <>
        <Receipt
          kind="permission"
          state="current"
          lines={[
            { key: "TOKEN", value: SYMBOL },
            { key: "SPENDER", value: "OVRFLO LENDING" },
            { key: "ALLOWANCE", value: `1.00000 ${SYMBOL}` },
            { key: "MATCH", value: "MATCH EXACT" },
          ]}
        />
        <ActionButton variant="primary">APPROVE {SYMBOL}</ActionButton>
      </>,
    );
    expect(screen.getByText("PERMISSION RECEIPT")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `APPROVE ${SYMBOL}` })).toBeInTheDocument();
    expect(screen.queryByText("CONFIRMED")).not.toBeInTheDocument();
    approve.unmount();

    writeFx.isConfirmed = true;
    render(
      <WatchWrite
        kind="repay"
        lending={LENDING}
        market={watchMarket}
        loanId={loan.id}
        outstanding={loan.outstanding}
        symbol={SYMBOL}
        signingAllowed
        onClose={noop}
      />,
    );
    expect(screen.getByRole("button", { name: "DONE" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "REPAY" })).not.toBeInTheDocument();
  });

  it("F acknowledgment step — ACKNOWLEDGE RISK before first write; /risk link; no liquidation copy", () => {
    writeFx.acknowledged = false;
    render(
      <WatchWrite
        kind="claim"
        lending={LENDING}
        market={watchMarket}
        positionId={26n}
        claimable={12n * 10n ** 16n}
        symbol={SYMBOL}
        signingAllowed
        onClose={noop}
      />,
    );
    expect(screen.getByRole("button", { name: "ACKNOWLEDGE RISK" })).toBeInTheDocument();
    expect(document.querySelector("[data-ui='UI-REVIEW-ACKNOWLEDGE-RISK']")).toHaveAttribute(
      "data-state",
      "required",
    );
    expect(screen.getByRole("link", { name: "/risk" })).toHaveAttribute("href", "/risk");
    expect(screen.queryByText(/liquidation risk/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /CLAIM / })).not.toBeInTheDocument();
  });
});

