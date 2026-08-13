# Test accountability — U13 watch-surface Gherkin rewrite

Agent review of retired suites. Behavior is now covered by the rewritten
flow-level journeys, not by keeping the old modal/market-row topology.

## Deleted

### `web/tests/e2e/claim-all.feature` + `web/tests/e2e/steps/claim-all.ts`

- **Reason:** Global CLAIM ALL queue and LENDING/BORROWING/STREAMS market-row
  groups are retired. v1-lite claim is per supplied position, in place, via
  `claim` / `multicall` over that position's `loansOf` pairs.
- **Covered now:** `watch.feature` in-place withdraw/claim write on supplied
  detail; `repay-close.feature` for borrowed-detail writes. Empty category
  absence is `watch.feature` "zero-count supplied lens is hidden" (lenses,
  not position groups). Externally-claimed skip is no longer a queue row;
  a mined-but-reverted claim is a reverted action receipt (`WatchWrite`).

### `web/tests/e2e/adjust-rate.feature` + `web/tests/e2e/steps/adjust-rate.ts`

- **Reason:** ADJUST RATE on an open liquidity-position card was old topology.
  v1-lite supply does not move idle liquidity between ticks in the watch UI.
- **Covered now:** Rate selection lives in `/supply` (`supply.feature` amount →
  rate → review). A filled position is watched, not re-ticked, on the wall.

## Weakened / rewritten in place

### `supply.feature`, `borrow.feature`, `repay-close.feature`, `deposit-wrap-unwrap.feature`

- **Reason:** Entry was "expand the active market row and open a modal". Home
  is the watch surface; Borrow/Supply/Assets are routes.
- **Covered now:** Same checklist classes (identity, approval, outcomes,
  interruption, clamps, degraded reads) against the shipped flows. Steps read
  `deployments/local.json` lazily; no hardcoded market addresses.

## Added

- `watch.feature` — home wall, lens, detail, in-place writes
- `first-run.feature` — protocol-empty guided path
