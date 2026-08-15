import { ZERO_ADDRESS } from "./config";
import type { LiquidityPosition, Loan } from "./types";
import { MAX_UINT128, mulDiv as mulDivAmount, type OvrfloWei, wei, type Wei } from "./units";

export const WAD = 10n ** 18n;
export const BPS = 10_000n;
export const YEAR_SECONDS = 31_536_000n;
export const APR_STEP_BPS = 100;
/// How many ids one enumeration page fetches. Hydration costs four reads per id and viem chunks
/// multicall calldata at 1,024 bytes, so 25 ids paint the first page in roughly four requests
/// against seventy-two at 500. Lazy by design: later pages are fetched only when the reader asks
/// for them.
export const STREAM_PAGE_SIZE = 25n;

/// Fail-closed refusal threshold, NOT a page size. It exists only because `useStreams` fetches every
/// id and hydrates all of them in one shot, so refusing is the only alternative to a truncated list.
///
/// Slated for deletion, not adjustment. The pager
/// (docs/plans/2026-08-15-001-feat-watch-enumeration-load-more-plan.md) bounds the display path, and
/// the lens (docs/plans/2026-08-15-005-feat-stream-lens-plan.md) serves the consumers that need the
/// complete set. After both, nothing reads unboundedly and this has no job.
///
/// Do not lower it before then: it gates `overBudget` in all three books, so a smaller value blanks
/// the wall for any wallet holding more than that many streams.
export const MAX_ENUMERATION_IDS = 500n;
export { MAX_UINT128 };

export const UNIT = 10n ** 12n;
export const MIN_LIQUIDITY_AMOUNT = 10n ** 15n;
export const MIN_STREAM_AMOUNT = 10n ** 6n;

export type StreamBuckets = {
  remaining: Wei;
  claimable: Wei;
  locked: Wei;
};

export function mulDiv(a: bigint, b: bigint, den: bigint): bigint {
  if (den <= 0n) throw new Error("mulDiv denominator must be positive");
  return (a * b) / den;
}

export function mulDivUp(a: bigint, b: bigint, den: bigint): bigint {
  if (den <= 0n) throw new Error("mulDivUp denominator must be positive");
  const prod = a * b;
  const floor = prod / den;
  return prod % den === 0n ? floor : floor + 1n;
}

/** `f = WAD + ttm * apr * WAD / (YEAR * BPS)`, mirrors StreamPricing.factor. */
export function factor(aprBps: number, ttmSeconds: bigint): bigint {
  return WAD + mulDiv(ttmSeconds, BigInt(aprBps) * WAD, YEAR_SECONDS * BPS);
}

export function factorWad(aprBps: number, ttmSeconds: bigint): bigint {
  return factor(aprBps, ttmSeconds);
}

/** Floor: discounted present value of `remaining`. Mirrors StreamPricing.grossPrice. */
export function grossPrice(remaining: bigint, aprBps: number, ttmSeconds: bigint): bigint {
  return mulDiv(remaining, WAD, factor(aprBps, ttmSeconds));
}

/**
 * Ceil: future value of `borrowAmount`. Mirrors StreamPricing.obligation.
 * Throws when the result exceeds uint128 (SafeCast analogue).
 */
export function obligation(borrowAmount: bigint, aprBps: number, ttmSeconds: bigint): bigint {
  const value = mulDivUp(borrowAmount, factor(aprBps, ttmSeconds), WAD);
  if (value > MAX_UINT128) {
    throw new Error("obligation overflows uint128");
  }
  return value;
}

export function obligationForFill(
  borrowAmount: bigint,
  grossPrice_: bigint,
  remaining: bigint,
  aprBps: number,
  ttmSeconds: bigint,
): bigint {
  if (borrowAmount === grossPrice_) return remaining;
  return obligation(borrowAmount, aprBps, ttmSeconds);
}

/** Floor: `amount * feeBps / BPS`. Mirrors StreamPricing.fee. */
export function fee(borrowAmount: bigint, feeBps: number): bigint {
  if (feeBps === 0) return 0n;
  return mulDiv(borrowAmount, BigInt(feeBps), BPS);
}

export function netToBorrower(borrowAmount: bigint, feeBps: number): bigint {
  return borrowAmount - fee(borrowAmount, feeBps);
}

export function upfrontBps(aprBps: number, ttmSeconds: bigint, feeBps: number): bigint {
  const grossBps = (WAD * BPS) / factor(aprBps, ttmSeconds);
  return (grossBps * (BPS - BigInt(feeBps))) / BPS;
}

export function lenderReturnBps(aprBps: number, ttmSeconds: bigint): bigint {
  return (BigInt(aprBps) * ttmSeconds) / YEAR_SECONDS;
}

export function formatBpsPct(x: bigint): string {
  const whole = x / 100n;
  const tenth = (x % 100n) / 10n;
  return `${whole}.${tenth}%`;
}

/**
 * Sablier three-bucket vocabulary (vesting-data guide):
 * remaining = deposited − withdrawn − refunded
 * claimable = streamed − withdrawn
 * locked = deposited − streamed − refunded
 */
export function streamBuckets(input: {
  deposited: bigint;
  withdrawn: bigint;
  refunded: bigint;
  streamed: bigint;
}): StreamBuckets {
  const remaining = input.deposited - input.withdrawn - input.refunded;
  const claimable = input.streamed - input.withdrawn;
  const locked = input.deposited - input.streamed - input.refunded;
  return {
    remaining: wei(remaining < 0n ? 0n : remaining),
    claimable: wei(claimable < 0n ? 0n : claimable),
    locked: wei(locked < 0n ? 0n : locked),
  };
}

export function loanOutstanding(loan: { obligation: bigint; drawn: bigint; repaid: bigint }) {
  const satisfied = loan.drawn + loan.repaid;
  return satisfied >= loan.obligation ? 0n : loan.obligation - satisfied;
}

export function isLoanOpen(loan: {
  closed: boolean;
  obligation: bigint;
  drawn: bigint;
  repaid: bigint;
}) {
  return !loan.closed && loanOutstanding(loan) > 0n;
}

export function recoveredForClaimable({
  loan,
  withdrawable,
}: {
  loan: { drawn: bigint; repaid: bigint; closed: boolean; obligation: bigint };
  withdrawable: bigint;
}) {
  const outstanding = loanOutstanding(loan);
  const pendingStreamRecovery = loan.closed ? 0n : withdrawable < outstanding ? withdrawable : outstanding;
  return loan.drawn + loan.repaid + pendingStreamRecovery;
}

export function enumerateIds(nextId: bigint, maxIds: bigint = MAX_ENUMERATION_IDS) {
  const max = nextId - 1n;
  const capped = max > maxIds ? maxIds : max;
  if (capped <= 0n) return [];
  return Array.from({ length: Number(capped) }, (_, index) => BigInt(index + 1));
}

export function aprChoices(minBps: number, maxBps: number, stepBps = APR_STEP_BPS) {
  const choices: number[] = [];
  for (let aprBps = minBps; aprBps <= maxBps; aprBps += stepBps) {
    choices.push(aprBps);
  }
  return choices;
}

export function floorToUnit(amount: bigint, unit: bigint = UNIT): bigint {
  if (unit <= 0n) throw new Error("UNIT must be positive");
  return amount - (amount % unit);
}

export function unitsToWei(availableUnits: bigint, unit: bigint = UNIT): bigint {
  return availableUnits * unit;
}

export function weiToUnits(amount: bigint, unit: bigint = UNIT): bigint {
  return amount / unit;
}

/** Ratio in bps, bigint mulDiv — never `Number` on the token amount. */
export function ratioBps(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) return 0n;
  return mulDiv(numerator, BPS, denominator);
}

export function scaleOvrflo(amount: OvrfloWei, num: bigint, den: bigint): OvrfloWei {
  return mulDivAmount(amount, num, den);
}

export function liquidityExists(position: Pick<LiquidityPosition, "lender">) {
  return position.lender !== ZERO_ADDRESS;
}

export function loanExists(loan: Pick<Loan, "borrower">) {
  return loan.borrower !== ZERO_ADDRESS;
}
