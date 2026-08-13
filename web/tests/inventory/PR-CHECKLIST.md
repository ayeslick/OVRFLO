# U14 render inventory — PR checklist

Paste into the PR description. Fixture harness: `web/tests/inventory/`.
Transacting topologies asserted at 1280px and 360px.

## Flow-spec 24

- [x] 1. ENTRY.DISCONNECTED
- [x] 2. ENTRY.READY
- [x] 3. BORROW.SELECT_STREAM
- [x] 4. BORROW.ENTER_AMOUNT + SELECT_RATE
- [x] 5. BORROW.REVIEW
- [x] 6. BORROW.APPROVE_STREAM
- [x] 7. BORROW.SIGN
- [x] 8. BORROW.CONFIRMED
- [x] 9. SUPPLY.SELECT_MARKET
- [x] 10. SUPPLY.ENTER_AMOUNT + SELECT_RATE
- [x] 11. SUPPLY.REVIEW
- [x] 12. SUPPLY.APPROVE
- [x] 13. SUPPLY.SIGN
- [x] 14. SUPPLY.CONFIRMED
- [x] 15. POSITIONS.INDEX + SUPPLY_DETAIL
- [x] 16. POSITIONS.INDEX + LOAN_DETAIL
- [x] 17. POSITIONS.INDEX + STREAM_DETAIL
- [x] 18. LOADING / EMPTY / STALE / PENDING / ERROR per topology
- [x] 19. POSITIONS.CLAIM_CONFIRMED unwrap-enabled
- [x] 20. POSITIONS.CLAIM_CONFIRMED reserve-insufficient
- [x] 21. POSITIONS.UNWRAP_REVIEW + UNWRAP_CONFIRMED
- [x] 22. STREAM.REVIEW + APPROVE_PT + APPROVE_FEE
- [x] 23. ASSETS.WRAP_AMOUNT + WRAP_APPROVE + WRAP_CONFIRMED
- [x] 24. POSITIONS.REPAY_AMOUNT + REPAY_PREPARE + REPAY_APPROVE + REPAY_CONFIRMED

## Plan additions

- [x] A. three lens renders (SUPPLIED / BORROWED / STREAMS)
- [x] B. ribbon state set (recorded / edge / future / inert / degraded)
- [x] C. degraded status (UI-SHELL-STATUS)
- [x] D. first-run
- [x] E. risk
- [x] F. acknowledgment step
- [x] G. both claim-confirmed variants
- [x] H. narrow-viewport watch navigation

## Revert freshness

- [x] Successor to deleted `reorg-freshness.test.ts`: after mocked revert+refetch, zero rolled-back entities render on the watch surface; warm caches do not carry pre-revert entities. (Vitest / mocked query cache — not live Anvil `evm_revert`.)

## Product truth

- [x] No health-factor language in shipped UI (first-run denial allowed)
- [x] No TVL on watch disconnected
- [x] Projection never used as a write gate in `WatchWrite` or `lib/actions`

## Verification Contract (orchestrator)

- [ ] Build — `npm --prefix web run build` (needs production profile)
- [ ] E2E — seeded-fork Playwright (`workers: 1`); U14 worker did not run `bootstrap:e2e` / `test:e2e`
- [x] Unit + component — `cd web && node ./node_modules/vitest/dist/cli.js run tests/inventory` (worker: 9 files, 70 tests, pass)
- [x] Types — `cd web && npx tsc --noEmit` (worker: pass)
- [ ] Maps presence / purge greps / query discipline / unit-safety / supply-chain / see-equals-sign — orchestrator
