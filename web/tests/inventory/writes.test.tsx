import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Converter } from "@/components/assets/Converter";
import { StreamCreate } from "@/components/assets/StreamCreate";
import { streamTrace, unwrapTrace, wrapTrace } from "@/components/assets/trace";
import { WatchWrite } from "@/components/watch/WatchWrite";
import type { WatchBalances } from "@/hooks/useWatchBalances";
import type { ComponentProps } from "react";
import { claimedLog } from "../lib/claimed-log";
import {
  LENDING,
  MARKET,
  NOW,
  SCALE,
  SYMBOL,
  TOKEN,
  UNDERLYING,
  VAULT,
  EXPIRY,
  filledPosition,
  activeLoan,
  loanStreamTruth,
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
  receipt: undefined as { logs: { data: `0x${string}`; topics: readonly `0x${string}`[] }[] } | undefined,
  acknowledged: true,
  writeContract: vi.fn(),
  reset: vi.fn(),
}));

vi.mock("wagmi", () => ({
  useConnection: () => ({
    status: "connected",
    addresses: ["0x70997970C51812dc3A010C7d01b50e0d17dc79C8"],
    chainId: 1,
  }),
  useReadContracts: () => ({ data: undefined, isLoading: false }),
}));

vi.mock("@/hooks/useWriteFlow", () => ({
  useWriteFlow: () => ({
    writeContract: writeFx.writeContract,
    reset: writeFx.reset,
    isSigning: writeFx.isSigning,
    isConfirming: writeFx.isConfirming,
    isConfirmed: writeFx.isConfirmed,
    isReverted: writeFx.isReverted,
    isInFlight: writeFx.isInFlight,
    error: writeFx.error,
    hash: writeFx.hash,
    receipt: writeFx.receipt,
  }),
}));

vi.mock("@/hooks/useWatchBalances", () => ({
  useWatchBalances: () => ({
    wrapReserve: { status: "ready", value: 10n * 10n ** 18n },
    walletOvrflo: { status: "ready", value: 10n * 10n ** 18n },
    walletUnderlying: { status: "ready", value: 10n * 10n ** 18n },
    ovrfloAllowance: { status: "ready", value: 10n * 10n ** 18n },
    matured: false,
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
  writeFx.receipt = undefined;
  writeFx.acknowledged = true;
  writeFx.writeContract.mockReset();
  writeFx.reset.mockReset();
}

function fundedBalances(overrides: Partial<WatchBalances> = {}): WatchBalances {
  return {
    wrapReserve: ready(10n * WAD),
    walletOvrflo: ready(10n * WAD),
    walletUnderlying: ready(10n * WAD),
    ovrfloAllowance: ready(10n * WAD),
    matured: false,
    ...overrides,
  };
}

function claimedReceipt(positionId: bigint, amount: bigint) {
  return { logs: [claimedLog(positionId, amount)] };
}

const watchMarket = {
  vault: VAULT,
  reserve: TOKEN,
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

  it("19+G CLAIM_CONFIRMED unwrap-enabled — RECEIVED from logs; three non-equivalent exits", () => {
    writeFx.isConfirmed = true;
    const position = filledPosition();
    const payout = 25n * 10n ** 16n;
    writeFx.receipt = claimedReceipt(position.id, payout);
    render(
      <WatchWrite
        kind="claim"
        lending={LENDING}
        market={watchMarket}
        positionId={position.id}
        claimPairs={position.pairs}
        claimable={position.pairs[0]!.claimable}
        symbol={SYMBOL}
        underlyingSymbol={UNDERLYING}
        signingAllowed
        balances={fundedBalances({ wrapReserve: ready(payout) })}
        onClose={noop}
      />,
    );
    const confirmed = document.querySelector("[data-ui='UI-REVIEW-CLAIM-CONFIRMED']");
    expect(confirmed).toHaveAttribute("data-state", "unwrap-enabled");
    expect(screen.getByText("RECEIVED")).toBeInTheDocument();
    expect(screen.getByText(`0.25000 ${SYMBOL}`)).toBeInTheDocument();
    expect(screen.getByText(/RECEIVED 0\.25000 ovrfloTEST/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "UNWRAP TO UNDERLYING" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `KEEP ${SYMBOL}` })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "CLAIM PT" })).toBeDisabled();
    expect(screen.getByText(/different assets/i)).toBeInTheDocument();
    expect(screen.queryByText(/CLAIM ALL/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "DONE" })).toBeInTheDocument();
  });

  it("20+G CLAIM_CONFIRMED reserve-insufficient — unwrap disabled; claim is not a failure", () => {
    writeFx.isConfirmed = true;
    const payout = 12n * 10n ** 16n;
    writeFx.receipt = claimedReceipt(26n, payout);
    render(
      <WatchWrite
        kind="claim"
        lending={LENDING}
        market={watchMarket}
        positionId={26n}
        claimable={payout}
        symbol={SYMBOL}
        underlyingSymbol={UNDERLYING}
        signingAllowed
        balances={fundedBalances({ wrapReserve: ready(payout / 2n) })}
        onClose={noop}
      />,
    );
    const confirmed = document.querySelector("[data-ui='UI-REVIEW-CLAIM-CONFIRMED']");
    expect(confirmed).toHaveAttribute("data-state", "reserve-insufficient");
    expect(screen.getByRole("button", { name: "UNWRAP TO UNDERLYING" })).toBeDisabled();
    expect(screen.getByText(/NOT A FAILED CLAIM/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `KEEP ${SYMBOL}` })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "CLAIM PT" })).toBeDisabled();
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
    const schedule = loanStreamTruth().schedule;
    const amount = render(
      <WatchWrite
        kind="repay"
        lending={LENDING}
        market={watchMarket}
        loanId={loan.id}
        outstanding={loan.outstanding}
        symbol={SYMBOL}
        underlyingSymbol={UNDERLYING}
        signingAllowed
        schedule={schedule}
        nowSeconds={NOW}
        balances={fundedBalances()}
        onClose={noop}
      />,
    );
    expect(screen.getByLabelText("REPAY AMOUNT")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "REPAY" })).toBeInTheDocument();
    expect(screen.getByText("ACTION RECEIPT")).toBeInTheDocument();
    expect(screen.getByText("CURRENT COVER")).toBeInTheDocument();
    expect(screen.getByText("AFTER THIS REPAY")).toBeInTheDocument();
    amount.unmount();

    const prepare = render(
      <WatchWrite
        kind="repay"
        lending={LENDING}
        market={watchMarket}
        loanId={loan.id}
        outstanding={loan.outstanding}
        symbol={SYMBOL}
        underlyingSymbol={UNDERLYING}
        signingAllowed
        balances={fundedBalances({
          walletOvrflo: ready(WAD / 10n),
          walletUnderlying: ready(5n * WAD),
        })}
        onClose={noop}
      />,
    );
    const shortfall = document.querySelector("[data-ui='UI-REVIEW-REPAY-PREPARE']");
    expect(shortfall).toHaveAttribute("data-state", "shortfall");
    expect(screen.getByRole("link", { name: "WRAP SHORTFALL" })).toHaveAttribute(
      "href",
      `/assets/?return=repay&loan=${loan.id.toString()}`,
    );
    expect(screen.getByRole("button", { name: "REPAY" })).toBeDisabled();
    prepare.unmount();

    const approve = render(
      <WatchWrite
        kind="repay"
        lending={LENDING}
        market={watchMarket}
        loanId={loan.id}
        outstanding={loan.outstanding}
        symbol={SYMBOL}
        underlyingSymbol={UNDERLYING}
        signingAllowed
        balances={fundedBalances({ ovrfloAllowance: ready(0n) })}
        onClose={noop}
      />,
    );
    expect(screen.getByText("PERMISSION RECEIPT")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `APPROVE ${SYMBOL}` })).toBeInTheDocument();
    expect(screen.queryByText("CONFIRMED")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "REPAY" })).not.toBeInTheDocument();
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
        balances={fundedBalances()}
        onClose={noop}
      />,
    );
    expect(screen.getByRole("button", { name: "DONE" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "REPAY" })).not.toBeInTheDocument();
  });

  it("keyboard — Enter on repay amount submits; claim/wrap primaries stay buttons", () => {
    const loan = activeLoan();
    render(
      <WatchWrite
        kind="repay"
        lending={LENDING}
        market={watchMarket}
        loanId={loan.id}
        outstanding={loan.outstanding}
        symbol={SYMBOL}
        signingAllowed
        balances={fundedBalances()}
        onClose={noop}
      />,
    );
    fireEvent.keyDown(screen.getByLabelText("REPAY AMOUNT"), { key: "Enter" });
    expect(writeFx.writeContract).toHaveBeenCalledOnce();
  });

  it("F risk gate is never shown on detail writes", () => {
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
    expect(screen.queryByRole("button", { name: "ACKNOWLEDGE RISK" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "I UNDERSTAND" })).not.toBeInTheDocument();
    expect(document.querySelector("[data-ui='UI-REVIEW-ACKNOWLEDGE-RISK']")).not.toBeInTheDocument();
    expect(screen.queryByText(/liquidation risk/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /CLAIM / })).toBeInTheDocument();
  });
});

