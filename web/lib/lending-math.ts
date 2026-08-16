import { ZERO_ADDRESS } from "./config";
import type { LiquidityPosition, Loan } from "./types";
import { MAX_UINT128, mulDiv as mulDivAmount, type OvrfloWei, wei, type Wei } from "./units";

export const WAD = 10n ** 18n;
export const BPS = 10_000n;
export const YEAR_SECONDS = 31_536_000n;
export const APR_STEP_BPS = 100;
/// How many ids one enumeration page fetches. The lens hydrates one window per
/// call. Later pages load when the reader asks, or when an all-ineligible
/// window auto-advances.
export const STREAM_PAGE_SIZE = 25n;

/// Historical complete-set helper default. The wall pager no longer refuses at
/// this bound. Do not restore it as a Watch overBudget gate.
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

export function upfrontBps(aprBps: number, ttmSeconds: bigint, feeBps: number): bigint {
  const factor = WAD + mulDiv(ttmSeconds, BigInt(aprBps) * WAD, YEAR_SECONDS * BPS);
  const grossBps = (WAD * BPS) / factor;
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
