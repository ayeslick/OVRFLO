---
title: Live Pendle market discovery for local seed; pinned fixtures for fork tests
date: 2026-07-28
category: architecture-patterns
module: script/seed-local.sh, web/tests/e2e/fixtures/chain.ts, test/fork
problem_type: architecture_pattern
component: development_workflow
severity: high
tags:
  - pendle
  - local-dev
  - anvil-fork
  - bootstrap-local
  - e2e
  - fork-fixtures
  - market-discovery
  - playwright-bdd
applies_when:
  - "Seeding a local Anvil mainnet fork at live chain head (no --fork-block-number pin) where Pendle PT market addresses and expiries would otherwise be hardcoded"
  - "Playwright E2E or other local consumers need deployment addresses written by bootstrap rather than duplicated module-level constants"
  - "Mainnet fork tests pin a fixed historical block via OVRFLOTestFixtures.sol and need an occasional scripted repin when fixture markets expire relative to the pinned timestamp"
  - "Choosing live Pendle wstETH markets by liquidity with a configurable expiry buffer (default 14 days) instead of hand-picking PRIMARY/SECONDARY market constants"
related_components:
  - script/lib/discover-pendle-market.sh
  - script/repin-fork-fixtures.sh
  - script/lib/OVRFLOTestFixtures.sol
  - deployments/local.json
---

# Live Pendle market discovery for local seed; pinned fixtures for fork tests

## Context

OVRFLO's local bootstrap and E2E suite depend on two live Pendle wstETH PT markets (primary and secondary). For a long time those markets were hardcoded in three places: `script/seed-local.sh` (`PRIMARY_MARKET`, `PRIMARY_PT`, `PRIMARY_EXPIRY`, and the secondary equivalents), `web/tests/e2e/fixtures/chain.ts` (module-scope constants mirroring the shell script), and `script/lib/OVRFLOTestFixtures.sol` (Solidity constants consumed by `test/fork/*.t.sol`).

Pendle markets have real expiry dates. When wall-clock time passed the hardcoded `PRIMARY_EXPIRY`, `seed-local.sh` still tried to seed against a market whose PT series was no longer valid relative to the fork's live chain head. Bootstrap aborted, the generated `deployments/local.json` artifact (gitignored; written by seed-local on each run) was never produced, and the Playwright/Gherkin E2E suite became unrunnable on a clean checkout — a failure mode that looked like "tests are broken" but was really stale fixture data.

The fix splits responsibilities by *how* each consumer uses chain state:

- **Local seeding** (`script/seed-local.sh`) forks the **live** mainnet head (no `--fork-block-number`). Markets must be discovered on every run.
- **Mainnet fork tests** (`test/fork/*.t.sol`) stay pinned to a fixed historical block via `MAINNET_FORK_BLOCK` in `script/lib/OVRFLOTestFixtures.sol` for determinism. Only the *process* of choosing what to pin is automated; the pin itself is refreshed occasionally via `script/repin-fork-fixtures.sh`.
- **E2E tests** read whatever markets seeding actually deployed from `deployments/local.json`, not from duplicated TypeScript constants.

Shared discovery logic lives in `script/lib/discover-pendle-market.sh`.

Large payloads stay on disk / stdin — never `jq --argjson` or bash argv —
because Pendle's full markets dump exceeds ARG_MAX on typical macOS/Linux
(`/usr/bin/jq: Argument list too long` during page concatenation).

## Guidance

### 1. Centralize market discovery in one shell library

`script/lib/discover-pendle-market.sh` exposes two functions:

- `pendle_fetch_all_markets` — paginates `GET https://api-v2.pendle.finance/core/v2/markets/all` (override base URL via `PENDLE_API_BASE`), writes each page to a temp file, and emits the combined `results` array on stdout via `jq -s` over those paths (never `jq --argjson` — Pendle's full dump exceeds ARG_MAX).
- `pendle_discover_top2_markets <underlying> <cutoff_unix>` — reads the markets JSON array from **stdin**, filters to chain-1 markets whose `underlyingAsset` matches `1-<underlying>` (case-insensitive), keeps only markets with expiry strictly after `cutoff_unix`, sorts by `details.liquidity` descending, and returns the top two as TSV: `market<TAB>pt<TAB>expiry(unix)`. Call as `pendle_fetch_all_markets | pendle_discover_top2_markets "$WSTETH" "$CUTOFF"`.

The underlying asset (wstETH at `0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0`) remains a deliberate fixed choice per project policy (`AGENTS.md`); only the *markets against it* go stale.

**ISO8601 parsing:** Pendle's `expiry` field includes millisecond suffixes (`"...000Z"`), which jq's strict `fromdateiso8601` rejects. The filter strips everything from the first `.` and re-appends `Z` before parsing — portable across macOS and Linux without shell `date` branches:

```jq
._expiryUnix: (.expiry | split(".")[0] + "Z" | fromdateiso8601)
```

**PT address extraction:** Pendle encodes PT as `"1-<address>"`; the filter takes the segment after the hyphen.

### 2. Discover live on every local bootstrap

`script/seed-local.sh` sources the library, reads the fork's latest block timestamp, computes a cutoff of `block.timestamp + PENDLE_EXPIRY_BUFFER_DAYS * 86400` (default **14 days**), fetches all markets, and calls `pendle_discover_top2_markets`. It **fails loudly** if fewer than two markets qualify:

```bash
if [ "$DISCOVERED_COUNT" -lt 2 ]; then
  echo "seed-local: found only $DISCOVERED_COUNT ... (need 2)" >&2
  exit 1
fi
```

The 14-day buffer replaced an earlier 90-day default that was too strict — at one point only one wstETH market qualified, blocking bootstrap entirely. Override with `PENDLE_EXPIRY_BUFFER_DAYS` when the live pool is thin.

Callers checksum addresses via `cast to-check-sum-address` before writing to Solidity artifacts or JSON. After seeding, step `[7/7]` writes `deployments/local.json` with `primaryMarket`, `primaryPt`, `primaryExpiry`, and the secondary equivalents — the single source of truth for E2E.

### 3. Repin fork fixtures separately, on a schedule

`script/repin-fork-fixtures.sh` uses the same discovery library but targets `script/lib/OVRFLOTestFixtures.sol`. It:

1. Picks `SAFE_BLOCK = head - FORK_BLOCK_SAFETY_MARGIN` (default 50 blocks, ~10 minutes on mainnet) to avoid reorg edge cases.
2. Uses that block's timestamp as the expiry cutoff anchor (same 14-day buffer).
3. Overwrites `PRIMARY_MARKET`, `PRIMARY_PT`, `PRIMARY_EXPIRY`, secondary constants, and `MAINNET_FORK_BLOCK` via `perl -pi`.

Run occasionally (or when fork tests fail against stale pinned markets), review the diff, `forge build`, then `forge test --match-path "test/fork/*" --fork-url $MAINNET_RPC_URL` before committing. Pinning to a historical block is correct and does not go stale with wall-clock time; what goes stale is the *hand-picked market address* inside the pin.

### 4. E2E reads deployments via lazy functions, not module-scope constants

`web/tests/e2e/fixtures/chain.ts` exposes `readPrimaryMarket()`, `readSecondaryMarket()`, `readSecondaryPt()`, `readSecondaryExpiry()`, and maturity label helpers that delegate to `readDeployment()`. This is intentional:

- `readDeployment()` loads and caches `deployments/local.json` (path overridable via `E2E_DEPLOYMENT_JSON`).
- **Do not** use top-level `const x = readDeployment()` — playwright-bdd's `bddgen` `require()`s every fixtures/steps file at codegen time, before `bootstrap:local` has necessarily run. Eager reads would make codegen fail on a clean checkout instead of surfacing a clear error at the first arrange step.

All E2E step files (`borrow.ts`, `repay-close.ts`, `deposit-wrap-unwrap.ts`, etc.) import the `read*` functions rather than hardcoded addresses.

### 5. Time advances in E2E must track discovered expiry

Sablier stream duration at deposit equals `marketExpiry - block.timestamp` (see `src/OVRFLO.sol`). A fixed "advance 180 days" step worked against one hardcoded expiry but breaks when discovery picks markets with different maturities (only guaranteed >14 days out).

`web/tests/e2e/steps/repay-close.ts` computes `secondsRemaining = readSecondaryExpiry() - latest.timestamp` and advances half of that — enough to vest past a small loan obligation while staying before stream end and market maturity, regardless of which real market was seeded.

### 6. Test the pure filter logic offline

`script/lib/discover-pendle-market.test.sh` feeds `script/lib/testdata/pendle-markets-fixture.json` through `pendle_discover_top2_markets` with no network access. The fixture exercises each filter dimension independently: underlying match, expiry cutoff, liquidity sort, and top-2 truncation. Run with:

```bash
bash script/lib/discover-pendle-market.test.sh
```

## Why This Matters

Hardcoded DeFi market addresses are a time bomb. PT markets expire; liquidity migrates; the "best" market today is not the best market next quarter. Duplicating the same constants across shell, TypeScript, and Solidity guarantees drift — one file gets updated, the others silently rot.

The split architecture respects two different correctness models:

| Consumer | Chain anchor | Market selection | Staleness risk |
|---|---|---|---|
| `seed-local.sh` / E2E | Live fork head | Discover every run | None (as long as Pendle API + RPC work) |
| `test/fork/*.t.sol` | Fixed `MAINNET_FORK_BLOCK` | Pinned constants | Low (block pin is stable; markets inside pin need occasional repin) |

Failing loudly when fewer than two markets qualify is preferable to seeding against a single market or silently picking a illiquid one — bootstrap and repin both exit non-zero with actionable messages.

The lazy-read pattern in `chain.ts` is a second-order fix: even with dynamic discovery, E2E tooling must not assume `local.json` exists at import time.

## When to Apply

Use this pattern whenever a project:

- Seeds local or CI environments against **live** mainnet forks where external protocol state (market addresses, expiry, oracle readiness) changes over wall-clock time.
- Also maintains **pinned** fork tests that require deterministic historical state.
- Has multiple language layers (shell deploy scripts, TypeScript tests, Solidity fixtures) that would otherwise duplicate the same external addresses.

Concrete triggers to revisit:

- `bootstrap:local` fails with "found only N wstETH Pendle market(s) ... (need 2)" — check Pendle API connectivity or temporarily lower `PENDLE_EXPIRY_BUFFER_DAYS`.
- `forge test --match-path "test/fork/*"` fails after Pendle rotates markets — run `MAINNET_RPC_URL=... ./script/repin-fork-fixtures.sh`, review, test, commit.
- Adding a new E2E step that references a Pendle market — import `readSecondaryMarket()` / `readSecondaryPt()` / `readSecondaryExpiry()` from `web/tests/e2e/fixtures/chain.ts`, never add new hardcoded addresses.
- Changing the expiry buffer — update the default in both `seed-local.sh` and `repin-fork-fixtures.sh` (they share `PENDLE_EXPIRY_BUFFER_DAYS`).

Do **not** apply live discovery to `test/fork/*.t.sol` directly — those tests should keep `vm.createSelectFork(rpc, MAINNET_FORK_BLOCK)` for reproducibility.

## Examples

### Before: hardcoded markets that expired

`script/seed-local.sh` once contained fixed `PRIMARY_MARKET` / `PRIMARY_EXPIRY` values chosen at one point in time. When real time passed `PRIMARY_EXPIRY`, the script still attempted to prepare oracles and seed PT against an effectively expired series. Bootstrap stopped; E2E had no `deployments/local.json`.

`chain.ts` duplicated the same constants at module scope, so every code change required manually keeping shell and TypeScript in lockstep — and `bddgen` would crash on clean checkouts if those constants tried to read a missing file eagerly.

### After: live discovery in seed-local.sh

```bash
# script/seed-local.sh (conceptual flow)
BLOCK_TIMESTAMP=$(cast block latest --field timestamp --rpc-url "$RPC")
CUTOFF=$((BLOCK_TIMESTAMP + PENDLE_EXPIRY_BUFFER_DAYS * 24 * 60 * 60))
ALL_MARKETS_JSON=$(pendle_fetch_all_markets)
DISCOVERED=$(pendle_discover_top2_markets "$ALL_MARKETS_JSON" "$WSTETH" "$CUTOFF")
# ... fail if count < 2, checksum addresses, seed both markets ...
# ... write deployments/local.json with discovered primary/secondary fields ...
```

Each `npm --prefix web run bootstrap:local` run picks the current top-two liquid wstETH markets with expiry > now + 14 days.

### After: E2E reads from local.json lazily

```typescript
// web/tests/e2e/fixtures/chain.ts
export function readSecondaryMarket(): Address {
  return readDeployment().secondaryMarket;
}
export function readSecondaryExpiry(): bigint {
  return BigInt(readDeployment().secondaryExpiry);
}
```

```typescript
// web/tests/e2e/steps/borrow.ts
const streamId = await depositPtForStream({
  market: readSecondaryMarket(),
  ptToken: readSecondaryPt(),
  // ...
});
```

### After: fork tests repinned via script

`script/repin-fork-fixtures.sh` overwrites constants in `script/lib/OVRFLOTestFixtures.sol`:

```solidity
address internal constant PRIMARY_MARKET = 0xcFD848b9f6fEf552204014ac67901223AD6bf679;
uint256 internal constant PRIMARY_EXPIRY = 1_782_345_600;
uint256 internal constant MAINNET_FORK_BLOCK = 24_609_670;
// ... secondary market constants ...
```

Fork tests continue using `MAINNET_FORK_BLOCK`; only the maintenance workflow changed from "grep Pendle UI and edit three files by hand" to "run repin script, review diff, commit."

### After: expiry-relative time advance in repay-close

```typescript
// web/tests/e2e/steps/repay-close.ts
const latest = await publicClient.getBlock();
const secondsRemaining = readSecondaryExpiry() - latest.timestamp;
await advanceSeconds(Number(secondsRemaining / 2n));
```

**Before:** `advanceSeconds(180 * 24 * 60 * 60)` — safe for one hardcoded ~6-month maturity, fragile after discovery.

**After:** half the remaining time to the seeded market's actual expiry — works for any market discovery returns.

### Offline verification of filter logic

```bash
bash script/lib/discover-pendle-market.test.sh
# PASS: pendle_discover_top2_markets (underlying filter, expiry filter,
#       liquidity sort + top-2 truncation all verified independently)
```

The fixture in `script/lib/testdata/pendle-markets-fixture.json` proves market D (huge liquidity, expiry before cutoff) and market E (wrong underlying) are excluded, while A and B win on liquidity among valid wstETH candidates.

## Related

- [anvil-forge-script-broadcast-out-of-funds-LocalSeeding-20260421.md](../integration-issues/anvil-forge-script-broadcast-out-of-funds-LocalSeeding-20260421.md) — why `seed-local.sh` is the Anvil entrypoint
- [ovrflo-critical-patterns.md](../patterns/ovrflo-critical-patterns.md) — pattern #2 (bash seed-local, not forge script --broadcast)
- [e2e-shared-fork-requires-serial-workers-until-snapshot-isolation.md](e2e-shared-fork-requires-serial-workers-until-snapshot-isolation.md) — E2E against one shared seeded fork
- [playwright-bdd-bddgen-requires-object-destructuring-first-param.md](../integration-issues/playwright-bdd-bddgen-requires-object-destructuring-first-param.md) — same suite; bddgen also motivates lazy deployment reads
