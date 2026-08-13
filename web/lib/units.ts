/**
 * Branded amounts + arithmetic (KTD8 / M1–M4).
 *
 * UNIT-SAFETY OPERATOR GATE
 * Branded amounts remain operator-compatible with `bigint` after erasure.
 * Outside this file, amount arithmetic MUST go through the helpers below.
 * Bare `as WstethWei` / `as OvrfloWei` / `as Usd8` / `as Bps` / `as TickBps`
 * / `as Wei` casts are allowed only here and in `parse.ts` (constructors).
 *
 * Grep (Verification Contract, KTD8):
 *   rg -n 'as (Wei|WstethWei|OvrfloWei|Usd8|Bps|TickBps)\b' \
 *     web/lib web/hooks web/components web/app \
 *     --glob '!units.ts' --glob '!parse.ts' --glob '!generated.ts'
 * must be empty. Enforced by `web/tests/lib/unit-safety-gate.test.ts`.
 */

declare const amountBrand: unique symbol;
declare const tickBrand: unique symbol;

export type Amount<B extends string> = bigint & { readonly [amountBrand]: B };
export type Wei = Amount<"wei">;
export type WstethWei = Amount<"wsteth-wei">;
export type OvrfloWei = Amount<"ovrflo-wei">;
export type Usd8 = Amount<"usd-8">;
export type Bps = Amount<"bps">;
export type TickBps = number & { readonly [tickBrand]: "tick-bps" };

export const MAX_UINT128 = (1n << 128n) - 1n;
export const MAX_UINT256 = (1n << 256n) - 1n;
export const WAD = 10n ** 18n;
export const BPS_DENOMINATOR = 10_000n;

function mint<B extends string>(value: bigint, _brand: B): Amount<B> {
  if (value < 0n) {
    throw new Error("amount constructors reject negative values");
  }
  return value as Amount<B>;
}

export function wei(value: bigint): Wei {
  return mint(value, "wei");
}

export function wstethWei(value: bigint): WstethWei {
  return mint(value, "wsteth-wei");
}

export function ovrfloWei(value: bigint): OvrfloWei {
  return mint(value, "ovrflo-wei");
}

export function usd8(value: bigint): Usd8 {
  return mint(value, "usd-8");
}

export function bps(value: bigint): Bps {
  return mint(value, "bps");
}

export function tickBps(value: number): TickBps {
  if (!Number.isInteger(value) || value < 0 || value > 65_535) {
    throw new Error("tick constructors require an integer in [0, 65535]");
  }
  return value as TickBps;
}

/** `NoInfer` on `b` stops TS inferring a brand union that would allow mixing. */
export function add<B extends string>(a: Amount<B>, b: NoInfer<Amount<B>>): Amount<B> {
  return (a + b) as Amount<B>;
}

export function sub<B extends string>(a: Amount<B>, b: NoInfer<Amount<B>>): Amount<B> {
  if (b > a) {
    throw new Error("sub would underflow");
  }
  return (a - b) as Amount<B>;
}

export function min<B extends string>(a: Amount<B>, b: NoInfer<Amount<B>>): Amount<B> {
  return (a < b ? a : b) as Amount<B>;
}

export function max<B extends string>(a: Amount<B>, b: NoInfer<Amount<B>>): Amount<B> {
  return (a > b ? a : b) as Amount<B>;
}

/** Floor `(a * num) / den`. Denominator must be positive. */
export function mulDiv<B extends string>(a: Amount<B>, num: bigint, den: bigint): Amount<B> {
  if (den <= 0n) {
    throw new Error("mulDiv denominator must be positive");
  }
  if (num < 0n) {
    throw new Error("mulDiv numerator must be non-negative");
  }
  return ((a * num) / den) as Amount<B>;
}

/** Ceil `(a * num) / den`. Denominator must be positive. */
export function mulDivUp<B extends string>(a: Amount<B>, num: bigint, den: bigint): Amount<B> {
  if (den <= 0n) {
    throw new Error("mulDivUp denominator must be positive");
  }
  if (num < 0n) {
    throw new Error("mulDivUp numerator must be non-negative");
  }
  const prod = a * num;
  const floor = prod / den;
  return (prod % den === 0n ? floor : floor + 1n) as Amount<B>;
}

/**
 * Scale a branded amount down to a display integer (truncating toward zero)
 * before any `number` conversion. Callers must pass a scale that leaves a
 * magnitude inside `Number.MAX_SAFE_INTEGER` — raw wei never goes through
 * `Number`.
 */
export function toDisplayMagnitude<B extends string>(amount: Amount<B>, scale: bigint): bigint {
  if (scale <= 0n) {
    throw new Error("display scale must be positive");
  }
  return amount / scale;
}

export function formatUnits<B extends string>(amount: Amount<B>, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 77) {
    throw new Error("decimals must be an integer in [0, 77]");
  }
  const scale = 10n ** BigInt(decimals);
  const whole = amount / scale;
  const fraction = amount % scale;
  if (decimals === 0) return whole.toString();
  return `${whole.toString()}.${fraction.toString().padStart(decimals, "0")}`;
}

export function parseUnits(value: string, decimals: number): Wei {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 77) {
    throw new Error("decimals must be an integer in [0, 77]");
  }
  if (!/^(0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value)) {
    throw new Error("parseUnits expects a non-negative decimal string");
  }
  const [wholeRaw, fracRaw = ""] = value.split(".");
  const whole = wholeRaw ?? "0";
  if (fracRaw.length > decimals) {
    throw new Error("parseUnits fraction exceeds decimals");
  }
  const frac = fracRaw.padEnd(decimals, "0");
  return wei(BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac || "0"));
}
