# 03 — Hook unit tests

**What to build:** Test the remaining untested `web/hooks/` using the established `vi.mock("wagmi", ...)` pattern (no `msw`). Verify (don't rewrite) the hooks that already have coverage.

**Blocked by:** None — can start immediately.

**Status:** done

- [x] New `useFocusTrap.test.ts`: focus-cycling behavior
- [x] New `useLending.test.ts`, `useLendingLiquidity.test.ts`, `useHeldStreams.test.ts`, `useOvrflos.test.ts`, `useAllMarkets.test.ts`: data transformation (filtering, sorting, derived-value computation), loading/error propagation, using the `useLoanBook.test.tsx` pattern as reference
- [x] Confirm `useLoanBook.test.tsx`, `useApprovalWriteFlows.test.tsx`, `useStaleRecovery.test.tsx`, `useWriteFlow.test.tsx`, and `useTxQueue.test.tsx` still pass as-is — these already have coverage; only extend if a real gap is found (writeContract call forwarding, receipt-waiting state, query invalidation, error propagation, `useTxQueue`'s sequential-queue advancement)
- [x] `npm --prefix web run test` passes

**Explicitly deferred (do not add in this ticket):** hook tests for `useBorrowerLoans`, `useMarketSymbols`, `useEscapeKey`, `useBorrowDemand`, `useWalletChangeReset`, `useNowSeconds` — thin/derived hooks with lower risk than the ones above. Add a follow-up ticket if one of them grows real branching logic.

See plan Unit U3 (R6, R7, R8) in `docs/plans/2026-07-23-002-test-web-frontend-test-suite-plan.md`.

## Comments

Spec review ([Spec compliance review of ticket 03](c932dbac-a87d-410c-9883-3e4c4ba7c81d)): initial FAIL — must-fix was that the new `useWriteFlow` "forwards writeContract" test only checked the mock was called once, not that the exact config reached it (would pass even with altered/dropped args). Fixed: now asserts `toHaveBeenCalledExactlyOnceWith(config)` against a config object with real args.

Two nits also fixed: `useAllMarkets.test.ts` had two test addresses with a stray non-hex `m` character (`...0ma1`/`...0ma2`, masked by `as Address`) — replaced with valid hex. The `useApprovalWriteFlows` "busy" test's name overclaimed independent "either flow" coverage the shared mock can't actually provide (both `approveTx`/`actionTx` read the same mocked `useWriteContract`) — renamed and reworded the comment to describe only what's actually tested.

The "should-fix" scope-creep note (17 changed `web/tests/lib/` files alongside this ticket's hook files) is Ticket 02's work, reviewed and landed separately in the same session — not a real cross-ticket leak, just both tickets' diffs being visible together at review time.

Full suite after fixes: 37 files / 293 tests passed. `npx tsc --noEmit` and `npx eslint` clean.

Standards review ([Standards review of ticket 03 hook tests](5fcec2a3-9b18-4b20-aa77-cf16c08d4427)): initial FAIL, two must-fixes plus a large should-fix list across 7 files. Must-fixes:

- **`useFocusTrap.test.ts`** (renamed from the stray `.tsx` — no JSX in the file): the "ref not yet attached" test asserted `document.activeElement !== null`, which can never fail in jsdom (it falls back to `document.body`). Fixed to assert focus stays on a known prior element instead. Also switched `pressTab`'s hand-rolled `new KeyboardEvent + dispatchEvent` to `fireEvent.keyDown` (already a devDependency, act()-wrapped), and every wrap/no-op test now asserts `defaultPrevented` in addition to the focus target — jsdom never moves focus on a real Tab keydown itself, so `defaultPrevented` is the only observable that actually distinguishes "the trap intercepted this keydown" from "it didn't." Added a keydown-on-empty-container case (the hook's one previously-uncovered line).
- **`useHeldStreams.test.tsx`**: the "is loading while either ... is in flight" test asserted `isLoading` immediately on mount, when `discovery.isLoading` is synchronously true regardless of the sablier mock — it would pass even if `sablierReads.isLoading` were dropped from the hook's OR entirely. Fixed by waiting for discovery to resolve first, then asserting `isLoading` stays true because of the sablier mock specifically; added a sibling "not loading once both have settled" test for symmetry. Also strengthened the fallback test's fixture from an implicit 0n `withdrawable` (indistinguishable from a hardcoded `0n` in the hook) to an explicit distinctive `42n`, and added a `useReadContracts` config-capture assertion confirming the discovered stream ids actually reach the sablier read (`contracts: [...withdrawableAmountOf, args: [id]]`).

Should-fixes applied: `useLending.test.ts` now captures the `useReadContracts` config to assert the 6 reads are requested in declared order (not just returned in order) and that the null-address case sets `query: { enabled: false }`; `useLendingLiquidity.test.ts`'s one "either loading/error" test (only ever exercising one side of each OR) was split into 4 independent tests, one per operand; `useOvrflos.test.ts`'s "propagates an error from any of the three chained reads" test (which only actually tested one of the three) was split into 3 tests, one per read, plus 2 added `isLoading` cases for the vault-addresses and per-vault-info reads; `useAllMarkets.test.ts` gained a 2-vault, uneven-market-count test that pins the flat `readIndex` cursor used across vault boundaries in both `marketSeriesContracts` and the `markets` builder — a single-vault fixture can't distinguish a correct flat cursor from one that (incorrectly) resets per vault; `useWriteFlow.test.tsx`'s mock gained `reset` and `receipt.data`, with new tests confirming both are forwarded (previously always `undefined`/unasserted); `useApprovalWriteFlows.test.tsx`'s shared `useWriteContract` mock became call-order-aware (approveTx's call vs actionTx's call), splitting the one "busy" test that could only prove the OR fires at all into two tests that independently pin each operand.

Full suite after this round: 37 files / 306 tests passed. `tsc --noEmit` and `eslint` clean (via `./node_modules/.bin/`).
