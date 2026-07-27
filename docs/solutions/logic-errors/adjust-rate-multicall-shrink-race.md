---
title: Adjust-rate multicall shrink race silently topped up from the lender wallet
date: 2026-07-27
category: logic-errors
module: web
problem_type: logic_error
component: frontend_stimulus
symptoms:
  - "Receipt comparison against the submitted amount never fired — movedDiffers was dead code"
  - "A liquidity position that shrank between the fresh read and execution drafted the difference from the lender's wallet with no warning"
  - "ERC20 balance-shortfall reverts in the adjust-rate flow surfaced as generic dead-end errors instead of the re-quote recovery path"
root_cause: logic_error
resolution_type: code_fix
severity: high
tags: [adjust-rate, multicall, liquidity-race, receipt-parsing, stale-recovery, ovrflo-lending, wagmi]
related_components: [OVRFLOLending, "web/lib/positions.ts", "web/components/ActionModal.tsx"]
---

# Adjust-rate multicall shrink race silently topped up from the lender wallet

## Problem

The adjust-rate flow (ticket 08) moves a lender's idle liquidity to a new tick in one
transaction: `multicall(withdrawLiquidity(id), supplyLiquidity(market, newApr, freshIdle))`.
The first implementation parsed `LiquiditySupplied` from the receipt and compared the
supplied amount against the submitted amount to flag divergence. That comparison can
never fire — and the actual divergence it was meant to catch moves money silently.

## Symptoms

- The "moved differs from requested" receipt flag was provably dead code.
- When the position shrank between the fresh pre-submit read and on-chain execution
  (a borrow consumed part of it), `withdrawLiquidity` refunded less than `freshIdle`,
  and `supplyLiquidity` pulled the full `freshIdle` via `transferFrom` — quietly
  topping up the difference from the lender's wallet balance (the approval covered it).
- If the wallet could not cover the difference, the revert was a plain ERC20 balance
  error, which the ticket-06 error classifier labeled "retryable" — a dead-end generic
  error for what is actually a liquidity race.

## What Didn't Work

- **Comparing `LiquiditySupplied.availableLiquidity` to the submitted amount.**
  `supplyLiquidity` supplies exactly its argument; the event echoes the argument back.
  Any receipt check built on that comparison validates nothing.

## Solution

Two changes, both in the pure lib layer so they are unit-testable:

1. **The withdraw leg is the honest receipt comparison.** `adjustReceiptSummary` parses
   both events from the lending contract's logs and pairs them:

   ```ts
   // refunded < moved  ⇒  the difference was drawn from the lender's wallet
   const [supplied] = parseEventLogs({ abi, eventName: "LiquiditySupplied", logs: lendingLogs });
   const [withdrawn] = parseEventLogs({ abi, eventName: "LiquidityWithdrawn", logs: lendingLogs });
   return { moved: supplied.args.availableLiquidity, refunded: withdrawn?.args.refunded ?? ... };
   ```

   The UI surfaces `refunded < moved` explicitly: "POSITION REFUNDED X, Y DRAWN FROM
   WALLET" — never silent.

2. **ERC20 shortfalls in this flow are liquidity races.** `classifyAdjustError` extends
   the stale set with `transfer amount exceeds balance` / `ERC20InsufficientBalance` /
   `TransferFromFailed` before deferring to the ticket-06 classifier, so a shortfall
   routes through invalidate-and-re-confirm instead of a generic error.

## Why This Works

The contract's supply function is argument-echoing, so receipt truth about "what
actually happened" lives in the *withdraw* event — the only leg whose amount is decided
by live on-chain state. And an ERC20 shortfall in a withdraw-then-supply multicall can
only mean the withdraw refunded less than expected, which is by definition the position
shrinking mid-flight — the same failure mode the stale-recovery path exists for.

## Prevention

- **Before building a receipt comparison, ask which side of the event is decided by
  live state.** An event field that echoes a transaction argument can never diverge
  from it; comparisons against it are dead on arrival. Compare against the leg the
  contract computes.
- **When composing multicalls that withdraw-then-spend, trace where a shortfall lands.**
  If a later leg pulls from the wallet, a shrunken earlier leg becomes a silent wallet
  draft, not a revert. Either cap the later leg by the earlier leg's output (needs
  contract support) or surface the difference from the receipt.
- **Classify errors per flow, not globally.** The same revert string means different
  things in different flows: an ERC20 shortfall is terminal in a plain supply but a
  liquidity race in adjust-rate. The reusable pattern (three uses now: borrow,
  adjust-rate, and the claim-all queue's held-streams retry): classify each failure as
  *stale* (auto-invalidate all on-chain reads, show a banner, offer one explicit
  re-confirm), *terminal* (disable the action with the reason — never a misleading
  retry), or *retryable* (keep the button live). Tests pin each class.
