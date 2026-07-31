import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Address } from "viem";
import type { ActionType, ActiveAction, Loan, LoanPool, MarketInfo } from "@/lib/types";
import { SABLIER_LOCKUP_ADDRESS } from "@/lib/config";

// Consolidates the step-indicator/accent/field/button-label assertions that
// were previously scattered incidentally across supply-form.test.tsx,
// borrow-form.test.tsx, and deposit-cap.test.tsx (which only exercised 3 of
// the 12 action types as a side effect of testing something else) into one
// systematic table covering all 12.

function testAddress(id: number): Address {
  return `0x${id.toString(16).padStart(40, "0")}` as Address;
}

const WAD = 10n ** 18n;
const walletState = { address: testAddress(0xa11) as Address | undefined, chainId: 1 as number | undefined };
const switchChainMock = vi.fn();

// Per-functionName defaults that keep every one of the 12 forms in a
// renderable, non-error, non-"LOADING" state without per-row setup. Every
// row in `table` below renders at amount 0n, at which point
// convertApprovalNeeds's `amount > 0n` guard means `allowance`,
// `balanceOf`, `marketDepositLimits`, `marketTotalDeposited`, and
// `wrappedUnderlying` gate nothing the table asserts (they're set to
// permissive values purely so a future amount-typing row doesn't trip a
// stale zero). `liquidityPositions` IS load-bearing at amount 0n: it's the
// one real adjustable position AdjustRateForm needs to render without an
// error/loading state. The one place `allowance` actually matters is the
// standalone 3-step-approval test below, which types a nonzero amount and
// sets allowance to 0n on purpose.
const readState: Record<string, unknown> = {
  allowance: 1_000_000n * WAD,
  balanceOf: 1_000_000n * WAD,
  marketDepositLimits: 0n,
  marketTotalDeposited: 0n,
  wrappedUnderlying: 1_000_000n * WAD,
  liquidityPositions: [testAddress(0xa11), testAddress(6), 1000, 50n * WAD],
};

vi.mock("@/hooks/useIndexerSync", () => ({
  useIndexerSync: () => ({ syncedBlock: 100n, headBlock: 100n, lagBlocks: 0n, lagging: false }),
}));
vi.mock("wagmi", () => ({
  useConnection: () => ({
    status: walletState.address ? "connected" : "disconnected",
    addresses: walletState.address ? [walletState.address] : [],
    chainId: walletState.chainId,
  }),
  useSwitchChain: () => ({ switchChain: switchChainMock, isPending: false, error: null }),
  useReadContract: (config?: { functionName?: string }) => {
    const key = config?.functionName ?? "";
    return { data: key in readState ? readState[key] : undefined, error: null };
  },
  useReadContracts: () => ({ data: [], isLoading: false, error: null }),
}));

type WriteFlowState = {
  writeContract: ReturnType<typeof vi.fn>;
  reset: ReturnType<typeof vi.fn>;
  retryRefresh: ReturnType<typeof vi.fn>;
  hash: `0x${string}` | undefined;
  receipt?: undefined;
  isSigning: boolean;
  isConfirming: boolean;
  isRefreshing: boolean;
  isInFlight: boolean;
  isConfirmed: boolean;
  isReverted: boolean;
  refreshFailed: boolean;
  hasFailed: boolean;
  error: Error | null;
};

function flow(): WriteFlowState {
  return {
    writeContract: vi.fn(),
    reset: vi.fn(),
    retryRefresh: vi.fn(),
    hash: undefined,
    receipt: undefined,
    isSigning: false,
    isConfirming: false,
    isRefreshing: false,
    isInFlight: false,
    isConfirmed: false,
    isReverted: false,
    refreshFailed: false,
    hasFailed: false,
    error: null,
  };
}

// Every form calls useWriteFlow either once directly (SimpleActionForm) or
// twice via useApprovalWriteFlows (approveTx, then actionTx) — alternating
// by call count covers both without knowing which form is under test.
const writeFlows = { calls: 0, first: flow(), second: flow() };
vi.mock("@/hooks/useWriteFlow", () => ({
  useWriteFlow: () => (writeFlows.calls++ % 2 === 0 ? writeFlows.first : writeFlows.second),
}));

vi.mock("@/hooks/useLendingLiquidity", () => ({
  useLendingLiquidity: () => ({ liquidity: [], tooLarge: false, isLoading: false, error: null }),
}));
vi.mock("@/hooks/useLending", () => ({
  useLending: () => ({
    params: { aprMinBps: 1000, aprMaxBps: 1200, feeBps: 40, nextLiquidityId: 1n, nextLoanId: 1n, nextSaleListingId: 1n },
    isLoading: false,
    error: null,
  }),
}));
vi.mock("@/hooks/useHeldStreams", () => ({
  useHeldStreams: () => ({ streams: [], isLoading: false, error: null }),
}));
vi.mock("@/hooks/useBorrowDemand", () => ({
  useBorrowDemand: () => ({ status: "ok" as const, demand: [], peak: 0n }),
}));

const REPAY_LOAN_ID = 1n;
const borrowerLoansState: { loans: Array<{ loan: Loan; pool: LoanPool; withdrawable: bigint }> } = {
  loans: [
    {
      loan: {
        id: REPAY_LOAN_ID,
        borrower: testAddress(0xa11),
        streamId: 9n,
        obligation: 100n * WAD,
        drawn: 20n * WAD,
        repaid: 0n,
        closed: false,
      },
      pool: { id: REPAY_LOAN_ID, borrower: testAddress(0xa11), aprBps: 1000, market: testAddress(6), totalContributed: 100n * WAD },
      withdrawable: 0n,
    },
  ],
};
vi.mock("@/hooks/useBorrowerLoans", () => ({
  useBorrowerLoans: () => ({ loans: borrowerLoansState.loans, tooLarge: false, isLoading: false, error: null }),
}));

vi.mock("@/lib/invalidate", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/invalidate")>()),
  invalidateAllOnChainReads: vi.fn(),
  scheduleHeldStreamsRetry: () => () => {},
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({}),
}));

import { ACTION_META, FormBody } from "@/components/ActionModal";
import { BorrowOutcomeNotice, type BorrowOutcome } from "@/components/action-flow/BorrowFlow";

const FUTURE = 99_999_999_999n;

function makeMarket(): MarketInfo {
  return {
    vault: testAddress(1),
    treasury: testAddress(2),
    underlying: testAddress(3),
    ovrfloToken: testAddress(4),
    lending: testAddress(5),
    market: testAddress(6),
    twapDurationFixed: 900,
    feeBps: 25,
    expiryCached: FUTURE,
    ptToken: testAddress(7),
    oracle: testAddress(8),
  };
}

const market = makeMarket();
const symbols = {
  [market.underlying.toLowerCase()]: "TESTA",
  [market.ovrfloToken.toLowerCase()]: "TESTO",
};

function renderAction(action: ActiveAction) {
  const accent = ACTION_META[action.type].accent;
  return render(
    <FormBody action={action} market={market} user={walletState.address} symbols={symbols} accent={accent} onClose={vi.fn()} />,
  );
}

function stepIndicatorText(container: HTMLElement) {
  return container.querySelector(".modal-step-list")?.textContent ?? "";
}

function stepIndicatorAccent(container: HTMLElement) {
  return container.querySelector(".modal-step-list")?.getAttribute("data-accent");
}

beforeEach(() => {
  walletState.address = testAddress(0xa11);
  walletState.chainId = 1;
  switchChainMock.mockClear();
  writeFlows.calls = 0;
  writeFlows.first = flow();
  writeFlows.second = flow();
  readState.allowance = 1_000_000n * WAD;
  readState.balanceOf = 1_000_000n * WAD;
  readState.marketDepositLimits = 0n;
  readState.marketTotalDeposited = 0n;
  readState.wrappedUnderlying = 1_000_000n * WAD;
  readState.liquidityPositions = [testAddress(0xa11), testAddress(6), 1000, 50n * WAD];
  delete readState.previewDeposit;
});

type Row = {
  type: ActionType;
  action: ActiveAction;
  expectedAccent: "gold" | "cyan" | "neutral";
  steps: string[];
  buttonName: string | RegExp;
  hasAmountInput: boolean;
  extraFieldCheck?: () => void;
};

const table: Row[] = [
  {
    type: "supply",
    action: { type: "supply" },
    expectedAccent: "gold",
    steps: ["APPROVE", "SIGN", "CONFIRMED"],
    // Exact label: ticks default to aprChoices(1000, 1200) = [1000, 1100,
    // 1200], and with no radio selected yet the button defaults to ticks[0].
    buttonName: "SUPPLY @ 10.00%",
    hasAmountInput: true,
    extraFieldCheck: () => expect(screen.getAllByRole("radio")).toHaveLength(3),
  },
  {
    type: "withdraw",
    action: { type: "withdraw", positionId: 1n },
    expectedAccent: "gold",
    steps: ["SIGN", "CONFIRMED"],
    buttonName: "WITHDRAW",
    hasAmountInput: false,
  },
  {
    type: "claim_share",
    action: { type: "claim_share", positionId: 1n },
    expectedAccent: "gold",
    steps: ["SIGN", "CONFIRMED"],
    buttonName: "CLAIM SHARE",
    hasAmountInput: false,
  },
  {
    type: "deposit",
    action: { type: "deposit" },
    expectedAccent: "gold",
    steps: ["SIGN", "CONFIRMED"],
    buttonName: "DEPOSIT",
    hasAmountInput: true,
  },
  {
    type: "claim_matured",
    action: { type: "claim_matured" },
    expectedAccent: "gold",
    steps: ["SIGN", "CONFIRMED"],
    buttonName: "CLAIM",
    hasAmountInput: true,
  },
  {
    type: "wrap",
    action: { type: "wrap" },
    expectedAccent: "neutral",
    steps: ["SIGN", "CONFIRMED"],
    buttonName: "WRAP",
    hasAmountInput: true,
  },
  {
    type: "unwrap",
    action: { type: "unwrap" },
    expectedAccent: "neutral",
    steps: ["SIGN", "CONFIRMED"],
    buttonName: "UNWRAP",
    hasAmountInput: true,
  },
  {
    type: "borrow",
    action: { type: "borrow" },
    expectedAccent: "cyan",
    steps: ["APPROVE STREAM", "SIGN", "CONFIRMED"],
    buttonName: "BORROW",
    hasAmountInput: true,
    extraFieldCheck: () => {
      expect(screen.getByRole("combobox")).toBeInTheDocument(); // stream selector
      expect(screen.getByLabelText("SLIPPAGE %")).toBeInTheDocument();
    },
  },
  {
    type: "claim_stream",
    action: { type: "claim_stream", streamId: 1n },
    expectedAccent: "gold",
    steps: ["SIGN", "CONFIRMED"],
    buttonName: "CLAIM STREAM",
    hasAmountInput: false,
  },
  {
    type: "adjust_rate",
    action: { type: "adjust_rate", positionId: 1n },
    expectedAccent: "gold",
    steps: ["APPROVE", "SIGN", "CONFIRMED"],
    buttonName: "ADJUST RATE",
    hasAmountInput: false,
    // Same ladder as supply: aprChoices(1000, 1200) = [1000, 1100, 1200].
    extraFieldCheck: () => expect(screen.getAllByRole("radio")).toHaveLength(3),
  },
  {
    type: "repay",
    action: { type: "repay", loanId: REPAY_LOAN_ID },
    expectedAccent: "cyan",
    steps: ["APPROVE", "SIGN", "CONFIRMED"],
    // No amount typed -> repayAmount is 0n -> exact formatted label.
    buttonName: "REPAY 0.00 TESTO",
    hasAmountInput: true,
    extraFieldCheck: () => expect(screen.getByRole("button", { name: "MAX" })).toBeInTheDocument(),
  },
  {
    type: "close",
    action: { type: "close", loanId: 1n },
    expectedAccent: "cyan",
    steps: ["SIGN", "CONFIRMED"],
    buttonName: "CLOSE LOAN",
    hasAmountInput: false,
  },
];

describe("ActionModal / FormBody — all 12 action types", () => {
  it("covers every ActionType exactly once (guards against a silently-dropped row)", () => {
    // Derived from ACTION_META (Record<ActionType, ...>, exhaustive by
    // compile-time construction) rather than a hardcoded literal, so a 13th
    // ActionType added to lib/types.ts + ACTION_META is caught here even
    // though this file's table stays at 12 until someone adds a row for it.
    const types = table.map((row) => row.type).sort();
    expect(types).toEqual(Object.keys(ACTION_META).sort());
  });

  it("preserves a confirmed receipt while refresh failed and retries refresh only", () => {
    writeFlows.first.refreshFailed = true;
    writeFlows.first.hasFailed = true;
    writeFlows.first.hash = `0x${"12".repeat(32)}`;

    renderAction({ type: "withdraw", positionId: 1n });

    expect(screen.getByText(/TRANSACTION CONFIRMED — REFRESH FAILED/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "WITHDRAW" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "RETRY REFRESH" }));
    expect(writeFlows.first.retryRefresh).toHaveBeenCalledTimes(1);
    expect(writeFlows.first.writeContract).not.toHaveBeenCalled();
  });

  it.each(table)(
    "$type: correct accent, step indicator, form fields, and button label",
    ({ type, action, expectedAccent, steps, buttonName, hasAmountInput, extraFieldCheck }) => {
      expect(ACTION_META[type].accent).toBe(expectedAccent);

      const { container } = renderAction(action);

      expect(stepIndicatorAccent(container)).toBe(expectedAccent);
      const stepText = stepIndicatorText(container);
      steps.forEach((step, index) => expect(stepText).toContain(`[${index + 1}] ${step}`));
      // No extra/missing steps: the indicator's own step count matches exactly.
      expect(container.querySelectorAll(".modal-step-list span")).toHaveLength(steps.length);

      expect(screen.getByRole("button", { name: buttonName })).toBeInTheDocument();

      if (hasAmountInput) {
        expect(screen.getByPlaceholderText("0.00")).toBeInTheDocument();
      } else {
        expect(screen.queryByPlaceholderText("0.00")).not.toBeInTheDocument();
      }

      extraFieldCheck?.();
    },
  );

  it("deposit: shows the 3-step approval variant when the PT allowance is below the typed amount", () => {
    // Every row above renders at amount 0n, where convertApprovalNeeds always
    // returns false (mode === "deposit" && amount > 0n is the first guard) —
    // so the table alone never exercises ConvertForm's conditional
    // 2-step-vs-3-step branch (ActionModal.tsx: `needsApproval ? [...] : [...]`).
    // This test types a nonzero amount with a zero allowance to force it.
    readState.allowance = 0n;
    const { container } = renderAction({ type: "deposit" });

    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "10" } });

    expect(stepIndicatorText(container)).toContain("[1] APPROVE");
    expect(stepIndicatorText(container)).toContain("[2] SIGN");
    expect(stepIndicatorText(container)).toContain("[3] CONFIRMED");
    expect(container.querySelectorAll(".modal-step-list span")).toHaveLength(3);
    expect(screen.getByRole("button", { name: "APPROVE PT" })).toBeInTheDocument();
  });

  it("deposit: approves the fee with a 2% buffer, never the exact fee and never unlimited", () => {
    // Both allowance reads share one mock key, so pick an allowance that covers
    // the typed PT amount (no PT approve step) but not the fee (underlying
    // approve step armed).
    const fee = 20n * WAD;
    readState.allowance = 10n * WAD;
    readState.previewDeposit = [10n * WAD, 10n * WAD, fee, 0n];
    renderAction({ type: "deposit" });

    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "APPROVE TESTA" }));

    const [call] = writeFlows.first.writeContract.mock.calls;
    expect(call[0].functionName).toBe("approve");
    expect(call[0].args[1]).toBe((fee * 102n) / 100n);
    expect(call[0].args[1]).not.toBe(fee);
    expect(call[0].args[1]).not.toBe((1n << 256n) - 1n);
  });
});

describe("Borrow outcome notices", () => {
  it.each([
    ["preparing", /PREPARING/],
    ["partial", /PARTIAL LIQUIDITY/],
    ["unavailable", /UNAVAILABLE/],
    ["stale-route", /ROUTE CHANGED/],
    ["fragmented", /FRAGMENTED/],
    ["insufficient", /INSUFFICIENT/],
    ["true-zero", /NO EXECUTABLE/],
  ] as Array<[BorrowOutcome, RegExp]>)("explains %s without range-level copy", (outcome, copy) => {
    const { rerender } = render(<BorrowOutcomeNotice outcome={outcome} />);
    const notice = screen.getByRole("status");
    expect(notice).toHaveAttribute("aria-live", "polite");
    expect(notice).toHaveAttribute("data-borrow-outcome", outcome);
    expect(notice).toHaveTextContent(copy);

    rerender(<BorrowOutcomeNotice outcome={outcome} />);
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });
});

describe("ActionModal action routing writes", () => {
  it.each([
    ["withdraw", { type: "withdraw", positionId: 1n }, "WITHDRAW", "withdrawLiquidity", market.lending, [1n]],
    [
      "claim share",
      { type: "claim_share", positionId: 1n },
      "CLAIM SHARE",
      "claimLoanPoolShare",
      market.lending,
      [1n, (1n << 128n) - 1n],
    ],
    ["claim stream", { type: "claim_stream", streamId: 1n }, "CLAIM STREAM", "withdrawMax", SABLIER_LOCKUP_ADDRESS, [1n, walletState.address]],
    ["close", { type: "close", loanId: 1n }, "CLOSE LOAN", "closeLoan", market.lending, [1n]],
  ] as const)("preserves the %s write contract", (_name, action, buttonName, functionName, address, args) => {
    renderAction(action as ActiveAction);
    fireEvent.click(screen.getByRole("button", { name: buttonName }));

    expect(writeFlows.first.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({ address, functionName, args }),
    );
  });

  it.each([
    ["wrap", { type: "wrap" }, "WRAP", "wrap", [5n * WAD]],
    ["unwrap", { type: "unwrap" }, "UNWRAP", "unwrap", [5n * WAD]],
    ["repay", { type: "repay", loanId: REPAY_LOAN_ID }, "REPAY 5.00 TESTO", "repayLoan", [REPAY_LOAN_ID, 5n * WAD]],
  ] as const)("preserves the %s action-flow write", (_name, action, buttonName, functionName, args) => {
    renderAction(action as ActiveAction);
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: buttonName }));

    expect(writeFlows.second.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName, args }),
    );
  });
});

// R5/R6 — wrong-network write safety (finding H-2). The gate lives at FormBody
// so all six forms are covered at one seam; the write layer carries its own
// refusal so bypassing the gate is not enough to broadcast.
describe("wrong-network gate (R5/R6)", () => {
  const ALL_ACTIONS: ActionType[] = [
    "supply",
    "withdraw",
    "claim_share",
    "deposit",
    "claim_matured",
    "wrap",
    "unwrap",
    "borrow",
    "claim_stream",
    "adjust_rate",
    "repay",
    "close",
  ];

  it.each(ALL_ACTIONS)("'%s': a wrong chain replaces the form with a switch-network control", (type) => {
    walletState.chainId = 137;
    renderAction({ type } as ActiveAction);

    expect(screen.getByRole("button", { name: /SWITCH TO NETWORK 1/ })).toBeInTheDocument();
    expect(screen.getByText(/WRONG NETWORK/)).toBeInTheDocument();
    // No form control survives to reach a write.
    expect(screen.queryByPlaceholderText("0.00")).not.toBeInTheDocument();
  });

  it("names the connected chain so the user knows what to change from", () => {
    walletState.chainId = 137;
    renderAction({ type: "deposit" });
    expect(screen.getByText(/CONNECTED TO 137, EXPECTED 1/)).toBeInTheDocument();
  });

  it("activating the control requests a switch to the configured chain", () => {
    walletState.chainId = 137;
    renderAction({ type: "deposit" });
    fireEvent.click(screen.getByRole("button", { name: /SWITCH TO NETWORK 1/ }));
    expect(switchChainMock).toHaveBeenCalledWith({ chainId: 1 });
  });

  it("no write is reachable while on the wrong chain", () => {
    walletState.chainId = 137;
    renderAction({ type: "deposit" });
    expect(writeFlows.first.writeContract).not.toHaveBeenCalled();
    expect(writeFlows.second.writeContract).not.toHaveBeenCalled();
  });

  it("the right chain renders the form normally", () => {
    walletState.chainId = 1;
    renderAction({ type: "deposit" });
    expect(screen.queryByText(/WRONG NETWORK/)).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("0.00")).toBeInTheDocument();
  });

  it("a disconnected wallet is not treated as wrong-network", () => {
    // chainId is undefined while disconnected; showing a switch prompt there
    // would displace the CONNECT WALLET path.
    walletState.address = undefined;
    walletState.chainId = undefined;
    renderAction({ type: "deposit" });
    expect(screen.queryByText(/WRONG NETWORK/)).not.toBeInTheDocument();
  });
});

// R7 — post-confirm re-arm (finding H-3). Before this, `busy` dropped back to
// false on confirmation while the amount field still held the original
// arguments, so one more click resubmitted the same transaction.
describe("post-confirm re-arm (R7)", () => {
  // Forms with a free-text amount field, i.e. the ones where stale arguments
  // survive a confirmation. AdjustRate and the SimpleAction family have no
  // amount input to strand.
  const AMOUNT_FORMS: ActiveAction[] = [
    { type: "supply" },
    { type: "deposit" },
    { type: "wrap" },
    { type: "unwrap" },
  ];

  function confirmActionTx() {
    // The action flow is the second useWriteFlow call in every approve-then-act
    // form (approveTx first, then actionTx) — see the alternating mock above.
    writeFlows.second.isConfirmed = true;
  }

  it.each(AMOUNT_FORMS)("$type: the primary control is disarmed once confirmed", (action) => {
    const { rerender } = renderAction(action);
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "10" } });

    confirmActionTx();
    writeFlows.calls = 0;
    rerender(
      <FormBody
        action={action}
        market={market}
        user={walletState.address}
        symbols={symbols}
        accent={ACTION_META[action.type].accent}
        onClose={vi.fn()}
      />,
    );

    // No enabled control can submit. CLOSE dismisses and MAX only fills the
    // field — neither signs anything — so the assertion is about submitting
    // controls, not about every button on screen.
    const enabled = screen
      .getAllByRole("button")
      .filter((b) => !(b as HTMLButtonElement).disabled)
      .map((b) => b.textContent ?? "");
    expect(enabled.every((label) => /CLOSE|MAX/i.test(label))).toBe(true);
  });

  it("clears the amount field so spent arguments cannot be resubmitted", () => {
    const action: ActiveAction = { type: "deposit" };
    const { rerender } = renderAction(action);
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "10" } });
    expect(screen.getByPlaceholderText("0.00")).toHaveValue("10");

    confirmActionTx();
    writeFlows.calls = 0;
    rerender(
      <FormBody
        action={action}
        market={market}
        user={walletState.address}
        symbols={symbols}
        accent={ACTION_META.deposit.accent}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByPlaceholderText("0.00")).toHaveValue("");
  });

  it("shows CONFIRMED alongside the cleared field, so empty never reads as untouched", () => {
    const action: ActiveAction = { type: "deposit" };
    const { container, rerender } = renderAction(action);
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "10" } });

    confirmActionTx();
    writeFlows.calls = 0;
    rerender(
      <FormBody
        action={action}
        market={market}
        user={walletState.address}
        symbols={symbols}
        accent={ACTION_META.deposit.accent}
        onClose={vi.fn()}
      />,
    );

    expect(stepIndicatorText(container)).toContain("CONFIRMED");
    expect(screen.getByRole("button", { name: /CLOSE/i })).toBeInTheDocument();
  });

  it("a form that has not confirmed keeps its control armed", () => {
    // `wrap`, not `deposit`: deposit is separately gated on a previewDeposit
    // read that beforeEach clears, which would mask what this asserts.
    renderAction({ type: "wrap" });
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "10" } });
    expect(screen.getByPlaceholderText("0.00")).toHaveValue("10");
    // Regression guard on over-correction: disarming must key on confirmation,
    // not merely on an amount having been entered.
    const enabled = screen.getAllByRole("button").filter((b) => !(b as HTMLButtonElement).disabled);
    expect(enabled.length).toBeGreaterThan(0);
  });
});

// R14/R22/R24 — amount-input accessibility and correctness (findings M-1, M-12, L-11).
describe("amount input accessibility (R14/R24)", () => {
  const WITH_AMOUNT: Array<{ action: ActiveAction; id: string }> = [
    { action: { type: "supply" }, id: "supply-amount" },
    { action: { type: "deposit" }, id: "convert-amount" },
    { action: { type: "wrap" }, id: "convert-amount" },
    { action: { type: "unwrap" }, id: "convert-amount" },
    { action: { type: "borrow", streamId: 9n }, id: "borrow-amount" },
  ];

  it.each(WITH_AMOUNT)("$action.type: the field is labelled and reachable by its label", ({ action, id }) => {
    renderAction(action);
    const field = screen.getByPlaceholderText("0.00");
    expect(field).toHaveAttribute("id", id);
    // A label associated by `for`/`id` is what makes the field announceable;
    // the placeholder is not a label.
    expect(document.querySelector(`label[for="${id}"]`)).toBeTruthy();
  });

  it.each(WITH_AMOUNT)("$action.type: the field requests a decimal keypad", ({ action }) => {
    renderAction(action);
    expect(screen.getByPlaceholderText("0.00")).toHaveAttribute("inputmode", "decimal");
  });

  it("exposes validation state programmatically, not just as a CSS class", () => {
    // Type more than the mocked wallet balance to trip INSUFFICIENT BALANCE.
    readState.balanceOf = 1n;
    renderAction({ type: "wrap" });
    const field = screen.getByPlaceholderText("0.00");

    expect(field).toHaveAttribute("aria-invalid", "false");

    fireEvent.change(field, { target: { value: "500" } });

    expect(field).toHaveAttribute("aria-invalid", "true");
    // The message must be associated with the field, not merely nearby.
    const describedBy = field.getAttribute("aria-describedby") ?? "";
    expect(describedBy).toContain("convert-amount-error");
    expect(document.getElementById("convert-amount-error")?.textContent).toMatch(/INSUFFICIENT BALANCE/);
  });

  it("shows a balance line and a MAX control where the amount is wallet-bounded", () => {
    readState.balanceOf = 42n * WAD;
    renderAction({ type: "wrap" });

    expect(screen.getByText(/BALANCE/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "MAX" }));
    expect(screen.getByPlaceholderText("0.00")).toHaveValue("42");
  });

  it("omits the balance line on borrow, which is bounded by ladder depth not wallet", () => {
    renderAction({ type: "borrow", streamId: 9n });
    expect(screen.queryByRole("button", { name: "MAX" })).not.toBeInTheDocument();
  });

  it("disables MAX at a zero balance rather than filling in 0", () => {
    readState.balanceOf = 0n;
    renderAction({ type: "wrap" });
    expect(screen.getByRole("button", { name: "MAX" })).toBeDisabled();
  });
});

// R26/L-7 — the same action carried different names in different places:
// CLAIM LENDING SHARE / CLAIM SHARE / CLAIM, ADJUST RATE / MOVE LIQUIDITY,
// REPAY LOAN / REPAY EARLY, UNWRAP CAPACITY / WRAP RESERVE EMPTY.
describe("terminology consistency (R26)", () => {
  it("claim_share reads the same in its title and its button", () => {
    const { container } = renderAction({ type: "claim_share", positionId: 1n });
    expect(ACTION_META.claim_share.title).toBe("CLAIM SHARE");
    expect(screen.getByRole("button", { name: "CLAIM SHARE" })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/CLAIM LENDING SHARE/);
  });

  it("adjust_rate's submit uses the same verb as its entry point and title", () => {
    renderAction({ type: "adjust_rate", positionId: 1n });
    expect(ACTION_META.adjust_rate.title).toBe("ADJUST RATE");
    expect(screen.getByRole("button", { name: "ADJUST RATE" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "MOVE LIQUIDITY" })).not.toBeInTheDocument();
  });

  it("names the wrap reserve the same way whether or not it is empty", () => {
    // Was UNWRAP CAPACITY in the modal and WRAP RESERVE EMPTY in the row detail
    // for the same underlying quantity.
    renderAction({ type: "unwrap" });
    expect(screen.getByText(/WRAP RESERVE/)).toBeInTheDocument();
    expect(screen.queryByText(/UNWRAP CAPACITY/)).not.toBeInTheDocument();
  });
});
