# 02 — Wrong-network write safety

**Category:** bug (release blocker)

**Covers:** R5, R6 (Tranche 2 — Release blockers). Findings: H-2.

**What to build:** A wallet connected to a chain other than the configured one cannot reach a live protocol write through the UI, and even if the UI gate were bypassed, the write itself would be refused rather than broadcast against the wrong chain.

**Details:**
- Detect when the connected wallet's chain differs from the app's configured chain.
- When mismatched, every primary action control (DEPOSIT, BORROW, SUPPLY, ADJUST RATE, REPAY, CLAIM, WRAP/UNWRAP, approvals — the full write surface) is replaced by a switch-network control, not just flagged or disabled. This is explicitly stronger than SE2's header-dropdown-only pattern, which the ETHSKILLS `/qa` checklist calls insufficient for this exact reason.
- Independently of the UI gate, every write call names its expected chain explicitly (e.g. passing `chainId` through the write call rather than relying on ambient wallet state), so a wrong-chain broadcast is refused at the write layer even if a user reaches a write button through some path that skips the primary gate (stale tab, race between chain switch and click, etc).

**Acceptance criteria:**
- [x] Connected wallet on a non-configured chain → every primary action control across every form reads as a switch-network control
- [x] No protocol write can be broadcast while the wallet is on the wrong chain, verified even with the UI gate bypassed (e.g. calling the write hook directly with a mismatched chain in a test)
- [x] A test covers AE1: "Given a connected wallet on a non-configured chain, when the market table loads, then every primary action control reads as a switch-network control and no protocol write can be broadcast"
- [x] `npm --prefix web run test` green

**Out of scope:**
- Any change to which chains are configured/supported
- RainbowKit/Reown AppKit connector changes (out of scope per the SE2 comparison plan)

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

**Plan:** `docs/plans/2026-07-28-002-fix-audit-2026-07-28-remediation-plan.md` (Tranche 2, gate: `npm --prefix web run test` green + manual exercise of wrong-network and post-confirm paths).

## Comments

**2026-07-28 (to-tickets):** Generated via `/to-tickets`. Pairs naturally with 03 and 04 (same tranche, same "release blocker" urgency) but has no code dependency on either — all three can run in parallel.

**2026-07-29 (implemented):** Landed as U2 on branch `fix/audit-2026-07-28-tranche-1`.

Both halves live at a single seam each, rather than being repeated per call site.

*The gate* is in `FormBody` (`web/components/ActionModal.tsx`), which is the one switch every one of the six forms routes through — so a wrong chain replaces the entire form with `WrongNetworkNotice` and no primary action control survives to be clicked. A per-form gate would have needed to be applied correctly six times, and again for the seventh form someone adds. The notice names the connected chain and the expected one, since "wrong network" alone does not tell a user what to change from. New hook: `web/hooks/useChainGuard.ts`.

*The refusal* is in `useWriteFlow`, which injects `chainId` into every write rather than editing ~19 call sites. That makes it structurally impossible for a call site added later to forget it. `useTxQueue` uses `useWriteContract` directly rather than `useWriteFlow`, so its two calls carry the field explicitly.

Two incidental changes fell out. `parseChainId` in `web/lib/config.ts` now returns the literal `1` instead of `number` — wagmi types `chainId` as the union of configured chain ids, and a widened `number` will not assign. And the wrapper in `useWriteFlow` carries a narrow cast: `writeContract` is generic over the ABI and TypeScript will not distribute a spread across its parameter union, while typing the wrapper erases the generics that give call sites their argument checking. Casting the wrapper back preserves call-site inference exactly; only the injection is untyped.

`useChainGuard` deliberately reports `wrongChain: false` while disconnected — `chainId` is undefined then, and a switch-network prompt would displace the CONNECT WALLET path.

Test-mock fallout worth noting: the wagmi mocks across seven component test files did not supply `chainId`, so every connected test wallet read as wrong-chain and 43 tests failed. The mocks now reflect reality. `useWriteFlow`'s "forwards writeContract unchanged" test was rewritten — its premise is now deliberately false.

Coverage: 18 new cases — all 12 action types gated, the connected-chain caption, the switch request, no-write-reachable, the right-chain passthrough, the disconnected case, and two on the write-layer injection. Full suite 350 passed; lint and `tsc --noEmit` clean.
