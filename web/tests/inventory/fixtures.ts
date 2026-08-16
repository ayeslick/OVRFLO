import { vi } from "vitest";
import type { Address } from "viem";
import type { BorrowerLoanRow } from "@/hooks/useBorrowerBook";
import type { LenderPositionRow } from "@/hooks/useLenderBook";
import type { HydratedStream } from "@/hooks/useStreams";
import { loadingOutcome, readFailure, readyOutcome, unavailableOutcome } from "@/lib/read-outcome";
import type { MarketInfo } from "@/lib/types";

/** Flow-spec render inventory: docs/plans/2026-08-11-markets-frontend-flow-spec.md */
export const FLOW_SPEC_ITEMS = [
  "1. ENTRY.DISCONNECTED",
  "2. ENTRY.READY",
  "3. BORROW.SELECT_STREAM",
  "4. BORROW.ENTER_AMOUNT + SELECT_RATE",
  "5. BORROW.REVIEW",
  "6. BORROW.APPROVE_STREAM",
  "7. BORROW.SIGN",
  "8. BORROW.CONFIRMED",
  "9. SUPPLY.SELECT_MARKET",
  "10. SUPPLY.ENTER_AMOUNT + SELECT_RATE",
  "11. SUPPLY.REVIEW",
  "12. SUPPLY.APPROVE",
  "13. SUPPLY.SIGN",
  "14. SUPPLY.CONFIRMED",
  "15. POSITIONS.INDEX + SUPPLY_DETAIL",
  "16. POSITIONS.INDEX + LOAN_DETAIL",
  "17. POSITIONS.INDEX + STREAM_DETAIL",
  "18. LOADING / EMPTY / STALE / PENDING / ERROR per topology",
  "19. POSITIONS.CLAIM_CONFIRMED unwrap-enabled",
  "20. POSITIONS.CLAIM_CONFIRMED reserve-insufficient",
  "21. POSITIONS.UNWRAP_REVIEW + UNWRAP_CONFIRMED",
  "22. STREAM.REVIEW + APPROVE_PT + APPROVE_FEE",
  "23. ASSETS.WRAP_AMOUNT + WRAP_APPROVE + WRAP_CONFIRMED",
  "24. POSITIONS.REPAY_AMOUNT + REPAY_PREPARE + REPAY_APPROVE + REPAY_CONFIRMED",
] as const;

export const PLAN_ADDITIONS = [
  "A. three lens renders (SUPPLIED / BORROWED / STREAMS)",
  "B. ribbon state set (recorded / edge / future / inert / degraded)",
  "C. degraded status (UI-SHELL-STATUS)",
  "D. first-run",
  "E. risk",
  "F. acknowledgment step",
  "G. both claim-confirmed variants",
  "H. narrow-viewport watch navigation",
] as const;

export const TRANSACTING_WIDTHS = [1280, 360] as const;

export const ACCOUNT = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;
export const MARKET = "0x1111111111111111111111111111111111111111" as Address;
export const TOKEN = "0x3333333333333333333333333333333333333333" as Address;
export const VAULT = "0x2222222222222222222222222222222222222222" as Address;
export const LENDING = "0x4444444444444444444444444444444444444444" as Address;
export const NOW = 1_800_000_000n;
export const SCALE = 10n ** 18n;
export const NOW_MS = Number(NOW) * 1000;
export const EXPIRY = NOW + 150n * 86_400n;
export const SYMBOL = "ovrfloTEST";
export const UNDERLYING = "wstETH";

export const market: MarketInfo = {
  vault: VAULT,
  treasury: VAULT,
  underlying: TOKEN,
  ovrfloToken: TOKEN,
  lending: LENDING,
  market: MARKET,
  twapDurationFixed: 900,
  feeBps: 50,
  expiryCached: EXPIRY,
  ptToken: TOKEN,
  oracle: TOKEN,
};

export function stubViewport(width: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  window.matchMedia = (query: string) => {
    const max = /max-width:\s*(\d+)px/.exec(query);
    const matches = max ? width <= Number(max[1]) : false;
    return {
      matches,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => true,
    };
  };
}

export function mockCanvas() {
  const fillRect = vi.fn();
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    fillRect,
    strokeRect: vi.fn(),
    clearRect: vi.fn(),
    setTransform: vi.fn(),
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
}

export function filledPosition(id = 26n): LenderPositionRow {
  return {
    id,
    lending: LENDING,
    lender: ACCOUNT,
    market: MARKET,
    aprBps: 500,
    availableLiquidity: 19n * 10n ** 17n,
    intervalStart: 0n,
    intervalEnd: 31n * 10n ** 17n,
    pairs: [{ loanId: 1n, contribution: 31n * 10n ** 17n, claimable: 12n * 10n ** 16n }],
    pairsTruncated: false,
  };
}

export function restingPosition(id = 41n): LenderPositionRow {
  return {
    id,
    lending: LENDING,
    lender: ACCOUNT,
    market: MARKET,
    aprBps: 500,
    availableLiquidity: 5n * SCALE,
    intervalStart: 0n,
    intervalEnd: 0n,
    pairs: [],
    pairsTruncated: false,
  };
}

export function activeLoan(id = 12n): BorrowerLoanRow {
  return {
    id,
    lending: LENDING,
    market: MARKET,
    borrower: ACCOUNT,
    streamId: 440n,
    obligation: 2n * SCALE,
    drawn: SCALE,
    repaid: 0n,
    closed: false,
    outstanding: SCALE,
  };
}

export function eligibleStream(id = 441n): HydratedStream {
  return {
    streamId: id,
    owner: ACCOUNT,
    sender: VAULT,
    asset: TOKEN,
    schedule: {
      start: NOW - 10n * 86_400n,
      end: NOW + 80n * 86_400n,
      deposited: SCALE,
      withdrawn: 0n,
      refunded: 0n,
      cliffTime: NOW - 10n * 86_400n,
      isCancelable: false,
    },
    withdrawable: SCALE / 10n,
    remaining: SCALE,
    status: 1,
    renderEligible: true,
    borrowRouteEligible: true,
    vault: VAULT,
    market: MARKET,
  };
}

export function loanStreamTruth(streamId = 440n) {
  return {
    streamId,
    withdrawable: SCALE / 10n,
    schedule: {
      start: NOW - 10n * 86_400n,
      end: NOW + 80n * 86_400n,
      deposited: 2n * SCALE,
      withdrawn: 0n,
      refunded: 0n,
    },
  };
}

export const noop = () => undefined;

export const idlePager = {
  hasNextPage: false,
  isFetchingNextPage: false,
  fetchNextPage: () => undefined,
  advancePin: async () => undefined,
};

export function mockBookOutcome<T extends object>(
  status: "ready" | "loading" | "unavailable",
  rows: T & { positions?: unknown[]; loans?: unknown[]; streams?: unknown[] },
  meta: { dataUpdatedAt?: number } = {},
  failureMessage = "down",
) {
  const list = rows.positions ?? rows.loans ?? rows.streams ?? [];
  const renderCount = Array.isArray(list) ? list.length : 0;
  const data = {
    ...rows,
    sourceCount: BigInt(renderCount),
    renderCount,
    complete: status === "ready",
    confirmedEmpty: status === "ready" && renderCount === 0,
  };
  if (status === "loading") return { ...loadingOutcome(data, meta), ...idlePager };
  if (status === "unavailable") {
    return {
      ...unavailableOutcome(
        [readFailure("book", "transport", failureMessage)],
        meta,
        data,
      ),
      ...idlePager,
    };
  }
  return { ...readyOutcome(data, meta), ...idlePager };
}
