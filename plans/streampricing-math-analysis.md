# StreamPricing Math Analysis

**Date:** 2026-06-24
**Scope:** `src/StreamPricing.sol` — all pure pricing functions
**Verdict:** Math is correct. No code fixes needed. Stress test suite added at `test/StreamPricing.math.t.sol`.

---

## Functions

### `factor(aprBps, timeToMaturity)`

```
f = WAD + mulDiv(ttm, aprBps * WAD, YEAR * BPS)
  = 1e18 + (ttm * aprBps * 1e18) / (31536000 * 10000)
```

Linear discount/accrual factor: `f = 1 + apr * ttm / year` in WAD.

**Properties:**
- `f >= WAD` always (all inputs non-negative).
- `f` grows monotonically with `ttm` and `aprBps`.

**Overflow:**
- `aprBps * WAD` = max `65535 * 1e18 = 6.55e22` — fits uint256.
- `mulDiv` uses FullMath (512-bit intermediate), so `ttm * (aprBps * WAD)` cannot overflow.
- Even at `aprBps = type(uint16).max` (655.35%) and 100-year maturity: `f ~ 6.55e6 * WAD = 6.55e24` — fits uint256.

**No issues.**

---

### `grossPrice(remaining, aprBps, ttm)`

```
price = mulDiv(remaining, WAD, f)   // floored
      = remaining * 1e18 / f
```

Present value of `remaining` face value discounted at `aprBps` over `ttm`.

**Properties:**
- `price <= remaining` since `f >= WAD`.
- Floors (truncates) via `mulDiv` — buyer/lender pays the lower value.

**Edge case — price floors to 0:**
When `f > remaining * WAD`, `price = 0`. Example: `grossPrice(1, 65535, 10 * 365 days) = 0`.
Call sites guard with `require(grossPrice > 0, "OVRFLOBook: price zero")`.
Only triggerable with dust remaining + extreme APR/maturity — not realistic for OVRFLO.

**No issues.**

---

### `obligation(borrowAmount, aprBps, ttm)`

```
f = factor(aprBps, ttm)
value = mulDiv(borrowAmount, f, WAD)     // floored
if (mulmod(borrowAmount, f, WAD) != 0)   // ceil correction
    value += 1
require(value <= type(uint128).max)
return uint128(value)
```

Future value of `borrowAmount` at maturity under `aprBps`.

**Properties:**
- `obligation >= borrowAmount` since `f >= WAD`.
- Ceils (rounds up) so lender is owed at least the true accrual.

**Ceiling correctness:** `mulmod(borrowAmount, f, WAD) != 0` detects non-zero remainders
from the `mulDiv` division and adds 1. This is a proper ceiling.

**Overflow guard:** `require(value <= type(uint128).max)` reverts on extreme inputs.
At realistic values (ether-scale, < 100% APR, < 2yr maturity), `obligation` is well within uint128.

**No issues.**

---

### `obligationForFill(borrowAmount, grossPrice_, remaining, aprBps, ttm)`

```
if (borrowAmount == grossPrice_) return remaining;    // full-borrow fast path
return obligation(borrowAmount, aprBps, ttm);          // partial-borrow
```

**Full-borrow fast path:** When the borrower takes the entire discounted value,
the obligation is the full `remaining` face value. This sidesteps the
floor/ceil gap: `obligation(grossPrice, apr, ttm)` returns `remaining - gap`
where `gap = floor(frac(R*W/F) * F/W)` which can be more than 1 wei when `F/W`
is large. The fast path returns `remaining` exactly.

**Partial-borrow invariant — `obligation <= remaining`:**

This is the critical safety property ensuring the pledged stream always covers the debt.

**Proof:**

1. Call site enforces `borrowAmount <= grossPrice`.
2. `grossPrice = floor(remaining * WAD / f)`, so `grossPrice * f <= remaining * WAD`.
3. Therefore `borrowAmount * f <= remaining * WAD`.
4. `borrowAmount * f / WAD <= remaining`.
5. `ceil(borrowAmount * f / WAD) <= remaining` (since `remaining` is an integer and the
   unrounded value is `<= remaining`, the ceiling cannot exceed it).

This holds for **all** valid inputs, not just realistic ones.

**Round-trip gap note:** The gap `remaining - obligation(grossPrice, apr, ttm)` is
`floor(frac(R * W / F) * F / W)`, which can exceed 1 wei when `F/W` is large (high APR,
long maturity). At 10% APR / 1yr / clean numbers the gap is exactly 1 wei (tested),
but in general it is `>= 0` and `<= F/W - 1`. The fast path in `obligationForFill`
eliminates this gap for the full-borrow case.

**No issues.**

---

### `fee(borrowAmount, feeBps)`

```
fee = mulDiv(borrowAmount, feeBps, BPS)   // floored
```

Standard bps fee. No issues.

---

## Where It "Breaks" (Reverts, Never Corrupts)

| Scenario | Trigger | Realistic? | Handling |
|---|---|---|---|
| `grossPrice == 0` | 1 wei remaining + 655% APR + 10yr | No | Call site reverts "price zero" |
| `obligation` overflow | `type(uint128).max` amount + extreme factor | No | Reverts "obligation overflow" |

Both are impossible under OVRFLO's operating envelope:
- Stream amounts: 1-10,000 ether (1e18 to 1e22 wei)
- APR: bounded by `APR_MAX_CEILING` (owner-governed, launch at 10%)
- Maturity: 3-24 months (Pendle PT maturities)
- `remaining`: `deposited - withdrawn` from Sablier, bounded by `deposited` which is `toStream` from `deposit()`, which is `<= ptAmount`

---

## Test Coverage Gaps Addressed

The existing `test/StreamPricing.t.sol` covers known-value round trips, zero APR, dust-to-zero,
and the obligationForFill boundary. The new `test/StreamPricing.math.t.sol` adds:

1. **Fuzz `obligationForFill`** across full input space — verifies `obligation <= remaining`
   for both the fast path and partial-borrow path.
2. **Boundary: `grossPrice - 1` vs `grossPrice`** — explicit test that 1 wei below the
   full-borrow threshold still satisfies the invariant and doesn't hit the fast path.
3. **`grossPrice == 0`** — verifies the function returns 0 (call sites are responsible
   for reverting).
4. **`obligation` overflow revert** — verifies graceful revert at extreme inputs.
5. **Realistic-range fuzz** — constrains inputs to OVRFLO's operating envelope
   (1 ether to 10,000 ether, 0 to 5000 bps APR, 0 to 2 year maturity) to confirm
   no surprises in the actual operating range.
6. **Round-trip consistency** — for any `borrowAmount <= grossPrice`,
   `obligation(borrowAmount) <= remaining` and `grossPrice(remaining) >= obligation(borrowAmount)`
   when `borrowAmount == grossPrice`.
