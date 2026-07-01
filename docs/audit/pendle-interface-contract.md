# Pendle Interface Contract for OVRFLO

> Dependency assumptions OVRFLO relies on from Pendle, scoped to the calls OVRFLO actually makes. This is a contract to falsify, not a Pendle tutorial. Each row states the assumed property, where OVRFLO enforces it (or does not), and what breaks if the assumption fails. Pinned to the addresses in `scope-snapshot.md`.

OVRFLO touches only the PT/SY/oracle surface of Pendle. It never trades YT or interacts with the Pendle AMM. Anything below not listed is out of scope by design.

## Assumption rows

### A1. `IPendleOracle.getPtToSyRate()` returns a fresh TWAP of stated cardinality

- **Assumed property:** The rate reflects a time-weighted average over the observation cardinality established at market onboarding, and is not stale or single-block manipulable.
- **Enforced?** **Onboarding only.** Cardinality/TWAP duration are validated when the multisig calls `OVRFLOFactory.addMarket()` / `OVRFLO.prepareOracle()`. The deposit path does **not** revalidate freshness per call. This is invariant **X-1 (On-chain: No)** — see `x-ray/invariants.md#x-1`. Low practical risk: Pendle is a live protocol with external traders and LPs whose activity writes oracle observations continuously. OVRFLO is not the sole AMM user. Worst case, if external activity drops, a keeper bot can touch the market via `OVRFLOFactory.prepareOracle()` to maintain freshness.
- **If violated:** A manipulated or stale TWAP skews the `toUser` / `toStream` mint split in `OVRFLO.deposit()`. Fee is charged only on `toUser`, so a depressed rate also shrinks protocol fee. This is the open Medium finding **M-4** in `x-ray/multi-agent-audit-report.md`.
- **OVRFLO call site:** `OVRFLO.deposit()`.

### A2. `IStandardizedYield(sy).yieldToken()` identifies the vault underlying

- **Assumed property:** For an onboarded Pendle market, the SY's `yieldToken()` equals the OVRFLO vault's underlying asset.
- **Enforced?** **Yes, at onboarding.** `OVRFLOFactory.addMarket()` checks `IStandardizedYield(sy).yieldToken() == info.underlying` at onboarding (invariant **I-9** — series config is immutable once set). Stored once into immutable per-series routing.
- **If violated:** Mismatched markets could route fees/principal across incompatible assets. Prevented by the onboarding check; the residual risk is multisig onboarding error (bounded-external/admin trust).
- **OVRFLO call site:** `OVRFLOFactory.addMarket()`.

### A3. Token standard assumptions (decimals, fee-on-transfer) — OUT OF SCOPE

- **Assumed property:** All tokens used (PT, underlying, ovrfloToken) are standard ERC-20 with 18 decimals and exact-transfer semantics (no fee-on-transfer, no rebasing).
- **Enforced?** **By scope, not by code.** The multisig validates canonical Pendle PTs at `addMarket()`. Non-standard tokens are outside the protocol's threat model. Do not raise findings about fee-on-transfer, rebasing, or non-18-decimal tokens — these are explicitly excluded.
- **OVRFLO call site:** N/A — accepted by design.

### A4. PT converges 1:1 to its underlying at `expiryCached`

- **Assumed property:** A PT redeems 1:1 for its underlying at maturity, so post-maturity `claim()` (burn `ovrfloToken` → receive PT) is economically a 1:1 exit.
- **Enforced?** **Yes, structurally.** `OVRFLO.deposit()` blocks after expiry (guard **G-6**); `OVRFLO.claim()` requires maturity (guard **G-10**). Maturity is the series pin; `setSeriesApproved` is one-shot (invariant **I-9**).
- **If violated:** The claim path's 1:1 economic value breaks. Pendle maturity convergence is a protocol guarantee outside OVRFLO's control.
- **OVRFLO call site:** `OVRFLO.deposit()` (pre-maturity gate), `OVRFLO.claim()` (post-maturity gate).

## Dynamic context — when the oracle split is computed

Inside `OVRFLO.deposit()`, the split is computed **after** the PT pull and **before** the `ovrfloToken` mint and Sablier stream creation: `getPtToSyRate()` → derive `toUser`/`toStream` → mint `toUser` to the depositor and `toStream` to the vault → `Sablier.createWithDurations(...)`. `toStream` is clamped so `toUser <= ptAmount`; if `toStream == 0` (rate ≥ 1e18, i.e. no discount) the deposit reverts (guard **G-8**) — correct product behavior, not a bug.

## Scope exclusions

Pendle YT, the Pendle AMM, and any Pendle governance action that changes market/oracle addresses post-onboarding are **not** part of OVRFLO's call surface. Pendle governance mutability is an external trust assumption captured in the trust-assumption ledger, not a code path OVRFLO defends.
