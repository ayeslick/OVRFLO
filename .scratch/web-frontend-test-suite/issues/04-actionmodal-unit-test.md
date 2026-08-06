# 04 — ActionModal parametrized unit test

**What to build:** One parametrized test (`it.each` over all 12 action types) covering `ActionModal`'s step indicator, accent color, form fields, and action button label. Consolidates the step-indicator/accent assertions currently scattered incidentally across `supply-form.test.tsx`, `borrow-form.test.tsx`, and `deposit-cap.test.tsx` (which only touch 3 of the 12 action types as a side effect of testing something else) into one systematic, complete table.

**Blocked by:** None — can start immediately.

**Status:** done

- [x] New `web/tests/components/ActionModal.test.tsx`
- [x] `it.each` table covers all 12 action types: `supply`, `withdraw`, `claim_share`, `deposit`, `claim_matured`, `wrap`, `unwrap`, `borrow`, `claim_stream`, `adjust_rate`, `repay`, `close`
- [x] Each row asserts: correct step indicator (2-step vs 3-step vs conditional), correct accent color, correct form fields, correct action button label
- [x] Explicitly covers the 9 action types with zero prior coverage: `withdraw`, `claim_share`, `claim_matured`, `wrap`, `unwrap`, `claim_stream`, `repay`, `close`, `adjust_rate`
- [x] `npm --prefix web run test` passes; all 12 action types represented in the `it.each` table

See plan Unit U4 (R9) in `docs/plans/2026-07-23-002-test-web-frontend-test-suite-plan.md`.

## Comments

Implemented as a single `it.each` table over `ACTION_META`'s 12 `ActionType`s, rendering `FormBody` directly (same harness convention as `supply-form.test.tsx`/`borrow-form.test.tsx`/`deposit-cap.test.tsx`: mock `wagmi`, `useWriteFlow` alternating by call count for the approve/action pair, `useLending`, `useLendingLiquidity`, `useHeldStreams`, `useBorrowDemand`, `@/lib/invalidate`, `@tanstack/react-query`). Added one new mock not previously needed: `@/hooks/useBorrowerLoans` (for `repay`, which was entirely uncovered before).

A guard test (`covers every ActionType exactly once`) diffs the table's types against the full `ActionType` union so a silently-dropped or duplicated row fails loudly instead of just under-counting `it.each` iterations.

Each row asserts, independently of the component's own `ACTION_META` lookup: the accent literal (hardcoded expected value, not derived from `ACTION_META`, so an accidental edit to the source table is caught), the exact step-label sequence and count from `.modal-step-list`, the action button's accessible name, and presence/absence of the amount input (`adjust_rate` and the 4 `SimpleActionForm` types — `withdraw`/`claim_share`/`claim_stream`/`close` — take no amount input at all, which is itself a meaningful assertion).

Full suite (`npx vitest run`): 37 files / 288 tests passed. `npx tsc --noEmit` and `npx eslint` clean.

Spec review ([Spec compliance review of ticket 04](780c6234-79a6-4964-aed0-d47a952531bf)): initial FAIL. The "unrelated changes in the worktree" finding was a snapshot artifact — Tickets 02/03's fixes were mid-flight in the same session and landed in their own commits moments later, so by the time this comment is written the worktree is back to a single new file for this ticket. The real must-fix, `ConvertForm`'s 3-step approval variant (`needsApproval ? [...] : [...]`) never being exercised because every convert row rendered at amount 0n, is fixed: added a standalone test that types a nonzero deposit amount with `allowance = 0n` and asserts the 3-step sequence and the `APPROVE PT` button.

Standards review ([Standards review of ticket 04 diff](ed350435-6fbf-4626-9a5f-c73914584653)): PASS, no must-fix. Three should-fix items, all applied: the guard test now derives its expected set from `Object.keys(ACTION_META)` instead of a hardcoded literal (so a 13th `ActionType` is caught even if the table isn't updated); the `supply`/`adjust_rate` radio-count checks were tightened from `toBeGreaterThan(0)` to the deterministic `toHaveLength(3)`; the `supply`/`repay` button-name checks were tightened from prefix regexes to the exact accessible names (`"SUPPLY @ 10.00%"`, `"REPAY 0.00 TESTO"`). Also corrected an inaccurate top-of-file comment that implied `balanceOf`/`marketDepositLimits`/`marketTotalDeposited`/`wrappedUnderlying` gate something in the `it.each` table — at amount 0n none of them do; only `liquidityPositions` (unconditionally read) and `allowance` (only in the new 3-step test) are load-bearing.

Full suite after fixes: 37 files / 306 tests passed (14 in this file). `tsc --noEmit` and `eslint` clean (via `./node_modules/.bin/`, not `npx` — see the reviewer's note that plain `npx tsc`/`npx eslint` resolve to unrelated squatted/mismatched packages in this repo).
