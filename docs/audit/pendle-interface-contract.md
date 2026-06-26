# Pendle Interface Contract for OVRFLO

> Dependency assumptions OVRFLO relies on from Pendle, scoped to the calls OVRFLO actually makes. This is a contract to falsify, not a Pendle tutorial. Each row states the assumed property, where OVRFLO enforces it (or does not), and what breaks if the assumption fails. Pinned to the addresses in `scope-snapshot.md`.

OVRFLO touches only the PT/SY/oracle surface of Pendle. It never trades YT or interacts with the Pendle AMM. Anything below not listed is out of scope by design.

## Assumption rows

### A1. `IPendleOracle.getPtToSyRate()` returns a fresh TWAP of stated cardinality

- **Assumed property:** The rate reflects a time-weighted average over the observation cardinality established at market onboarding, and is not stale or single-block manipulable.
- **Enforced?** **Onboarding only.** Cardinality/TWAP duration are validated when the multisig calls `OVRFLOFactory.addMarket()` / `OVRFLO.prepareOracle()`. The deposit path does **not** revalidate freshness per call. This is invariant **X-1 (On-chain: No)** — see `x-ray/invariants.md#x-1`.
- **If violated:** A manipulated or stale TWAP skews the `toUser` / `toStream` mint split in `OVRFLO.deposit()`. Fee is charged only on `toUser`, so a depressed rate also shrinks protocol fee. This is the open Medium finding **M-4** in `x-ray/multi-agent-audit-report.md`.
- **OVRFLO call site:** `OVRFLO.deposit()`.

### A2. `IStandardizedYield(sy).yieldToken()` identifies the vault underlying

- **Assumed property:** For an onboarded Pendle market, the SY's `yieldToken()` equals the OVRFLO vault's underlying asset.
- **Enforced?** **Yes, at onboarding.** `OVRFLOFactory.addMarket()` checks `IStandardizedYield(sy).yieldToken() == info.underlying` at onboarding (invariant **I-9** — series config is immutable once set). Stored once into immutable per-series routing.
- **If violated:** Mismatched markets could route fees/principal across incompatible assets. Prevented by the onboarding check; the residual risk is multisig onboarding error (bounded-external/admin trust).
- **OVRFLO call site:** `OVRFLOFactory.addMarket()`.

### A3. Pendle PT is always 18 decimals

- **Assumed property:** Every onboarded PT has 18 decimals, so fixed-point stream/value math is consistent.
- **Enforced?** **Yes, indirectly.** `MIN_PT_AMOUNT` and the deposit/claim math assume 18 decimals; non-18-decimal PTs are outside the stated Pendle-only scope. The multisig validates canonical Pendle markets at `addMarket()`.
- **If violated:** Stream durations, `toStream` amounts, and `obligation` math would be miscalibrated. This is the trust boundary behind audit-report **I-1 (ex-M-1)** — see the trust-assumption ledger.
- **OVRFLO call site:** `OVRFLO.deposit()`, `OVRFLO.claim()`.

### A4. PT converges 1:1 to its underlying at `expiryCached`

- **Assumed property:** A PT redeems 1:1 for its underlying at maturity, so post-maturity `claim()` (burn `ovrfloToken` → receive PT) is economically a 1:1 exit.
- **Enforced?** **Yes, structurally.** `OVRFLO.deposit()` blocks after expiry (guard **G-5**); `OVRFLO.claim()` requires maturity (guard **G-9**). Maturity is the series pin; `setSeriesApproved` is one-shot (invariant **I-9**).
- **If violated:** The claim path's 1:1 economic value breaks. Pendle maturity convergence is a protocol guarantee outside OVRFLO's control.
- **OVRFLO call site:** `OVRFLO.deposit()` (pre-maturity gate), `OVRFLO.claim()` (post-maturity gate).

### A5. ERC20 PT/underlying tokens behave with standard exact-transfer semantics

- **Assumed property:** `transferFrom`/`transfer` move exactly the requested amount under normal conditions; fee-on-transfer or rebasing tokens are not onboarded.
- **Enforced?** **Partially.** `OVRFLO.wrap()` verifies balance-delta exactness (guard **G-11**); `OVRFLOBook._pullExact()` uses the same balance-delta pattern. The `deposit()` PT pull and the underlying fee pull do **not** balance-delta check (audit-report **I-1/I-2 (ex-M-1/M-2)**) — they trust user-supplied `ptAmount` and canonical Pendle PT behavior.
- **If violated:** Non-standard PT/underlying could make `marketTotalDeposited` diverge from received balances. Outside the Pendle-only, canonical-asset scope; documented as a trust boundary, not hardened on-chain.
- **OVRFLO call site:** `OVRFLO.deposit()` (PT + fee pulls), `OVRFLO.wrap()`/`unwrap()` (underlying, exact-checked).

## Dynamic context — when the oracle split is computed

Inside `OVRFLO.deposit()`, the split is computed **after** the PT pull and **before** the `ovrfloToken` mint and Sablier stream creation: `getPtToSyRate()` → derive `toUser`/`toStream` → mint `toUser` to the depositor and `toStream` to the vault → `Sablier.createWithDurations(...)`. `toStream` is clamped so `toUser <= ptAmount`; if `toStream == 0` (rate ≥ 1e18, i.e. no discount) the deposit reverts (guard **G-7**) — correct product behavior, not a bug.

## Scope exclusions

Pendle YT, the Pendle AMM, and any Pendle governance action that changes market/oracle addresses post-onboarding are **not** part of OVRFLO's call surface. Pendle governance mutability is an external trust assumption captured in the trust-assumption ledger, not a code path OVRFLO defends.
