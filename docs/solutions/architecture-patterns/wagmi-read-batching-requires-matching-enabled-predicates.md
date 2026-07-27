---
title: "wagmi useReadContracts batching is only safe when every merged call shares the same query.enabled predicate"
date: 2026-07-27
category: architecture-patterns
module: web/components
problem_type: architecture_pattern
component: frontend_stimulus
severity: medium
applies_when:
  - "Consolidating multiple useReadContract calls into a single useReadContracts multicall batch for fewer round trips"
  - "A code-simplification or efficiency-review pass proposes merging data-fetching reads that currently have separate enabled gates"
  - "Reads pulled into the same component/form have per-read enabled predicates based on different conditions (wallet connection, selected mode, derived booleans, selected item id, etc.)"
  - "A component mixes always-fetch reads (no enabled gate) with wallet-gated or mode-gated reads"
  - "Migrating consumers from useReadContract's flat data/isLoading/error shape to useReadContracts' per-call {status, result, error} array shape"
tags: [wagmi, usereadcontracts, usereadcontract, multicall, react, next-js, data-fetching, refactor-safety]
---

# wagmi useReadContracts batching is only safe when every merged call shares the same query.enabled predicate

## Context

A code-simplification review pass proposed the same mechanical suggestion in two different components of `web/`: "these N `useReadContract` calls look similar, merge them into one `useReadContracts` batch to cut network round trips." The suggestion landed differently in each case:

- In `web/components/MarketRowDetail.tsx`, three `useReadContract` calls (ovrfloToken balance, underlying-token balance, PT-token balance) were consolidated into a single `useReadContracts` multicall (`web/components/MarketRowDetail.tsx:45-52`), and this was safe.
- In `web/components/ActionModal.tsx`'s forms (`SupplyForm`, `ConvertForm`, `BorrowForm`, `AdjustRateForm`, `RepayForm`), several `useReadContract` calls sit right next to each other, look similar (same component, same general form, all reads gated by *some* `query.enabled` predicate), and yet batching was correctly **not** applied to them.

The naive version of the rule — "fewer round trips is always a win" — doesn't distinguish these two cases. It only looks at the read calls' shape (same ABI family, same general "wallet-scoped read" pattern) and ignores the one property that actually determines whether batching is safe: whether every call's `query.enabled` gate evaluates identically. Two reads that look interchangeable in isolation can still have gates that diverge at runtime, and a review pass optimizing for round-trip count has no way to catch that unless it explicitly checks the gates rather than the visual/structural similarity of the calls.

## Guidance

**Rule:** Before merging multiple `useReadContract` calls into a single `useReadContracts` batch, verify that every call's `query.enabled` predicate is **identical** — not "usually true together," not "similar," but the same boolean expression. If any predicate differs even slightly:

- (a) skip the batch for the calls whose predicates diverge, or
- (b) unify the enabled logic first, as its own explicitly reviewed change, separate from the batching change — don't fold a behavior change and a performance change into one diff.

**Safe example — `MarketRowDetail.tsx:45-52`:** all three reads share the exact literal `Boolean(user)` predicate, so batching them changes nothing about when any individual read fires:

```45:52:web/components/MarketRowDetail.tsx
  const balanceReads = useReadContracts({
    contracts: [
      { address: market.ovrfloToken, abi: erc20Abi, functionName: "balanceOf" as const, args: user ? [user] : undefined },
      { address: market.underlying, abi: erc20Abi, functionName: "balanceOf" as const, args: user ? [user] : undefined },
      { address: market.ptToken, abi: erc20Abi, functionName: "balanceOf" as const, args: user ? [user] : undefined },
    ],
    query: { enabled: Boolean(user) },
  });
```

**Correctly-skipped example — `ActionModal.tsx` (`SupplyForm`), lines 276-289:** `allowance` and `balanceOf` sit right next to each other in the same form, but their predicates differ — `allowance` additionally requires `market.lending`:

```276:289:web/components/ActionModal.tsx
  const allowance = useReadContract({
    address: market.underlying,
    abi: erc20Abi,
    functionName: "allowance",
    args: connectedAddress && market.lending ? [connectedAddress, market.lending] : undefined,
    query: { enabled: Boolean(connectedAddress && market.lending) },
  });
  const balanceOf = useReadContract({
    address: market.underlying,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: connectedAddress ? [connectedAddress] : undefined,
    query: { enabled: Boolean(connectedAddress) },
  });
```

`balanceOf` should be able to fire as soon as a wallet connects; `allowance` additionally needs a deployed lending market. Naively batching these would force `balanceOf` to wait on `market.lending` too (see "Why This Matters" below).

**Secondary gotcha — result shape changes for every consumer, not just the read call.** `useReadContracts` returns an array of per-item `{status, result, error}` objects (multicall-style), not the flat `.data`/`.isLoading`/`.error` shape that `useReadContract` returns. Every line that consumes the read must be rewritten when you batch, not just the hook call itself. Contrast the two consumption styles in the same file:

```64:67:web/components/MarketRowDetail.tsx
  const ovrfloBal = ovrfloBalance?.status === "success" ? ovrfloBalance.result : 0n;
  const underlyingBal = underlyingBalance?.status === "success" ? underlyingBalance.result : 0n;
  const ptBal = ptBalance?.status === "success" ? ptBalance.result : 0n;
  const wrapCapacity = wrappedUnderlying.data ?? 0n;
```

`ovrfloBal`/`underlyingBal`/`ptBal` (from the batched `useReadContracts` call) all switch on `.status === "success"` and read `.result`; `wrapCapacity` (from the un-batched `useReadContract` call directly below the batch, which intentionally has no `query.enabled` at all because it should always fetch) reads the flat `.data ?? 0n`. Missing this shape change when converting a read to a batch member is a distinct bug from the enabled-predicate problem — it produces a type error or a silently-always-zero value (`.data` is `undefined` on a `useReadContracts` result item) rather than a timing bug, but it's the same review moment, so check both at once.

## Why This Matters

`useReadContracts` accepts exactly one `query.enabled` for the whole batch — there is no per-item gate. Whoever writes the batch has to collapse N separate predicates into one boolean themselves, and both of the ways that tends to go wrong are silent:

1. **Logical AND of all predicates:** the least-restrictive read now waits on the most-restrictive one. In the `SupplyForm` example above, if `allowance` and `balanceOf` were batched under `Boolean(connectedAddress && market.lending)`, `balanceOf` — which should be able to render the user's balance the instant they connect a wallet, regardless of whether a lending market exists — would sit unfetched (and the UI would show a stale/zero balance) until `market.lending` is also true. That's a user-visible regression disguised as a "fewer round trips" cleanup.
2. **One branch's condition picked accidentally:** the same collapse can instead pick the *least* restrictive predicate, which does the opposite — it fires a read before its own real precondition holds, requesting data with an `args` array that references values that aren't valid yet (e.g. querying `BorrowForm`'s `quote` read before `selectedStreamId`/`selectedApr` are chosen — `web/components/ActionModal.tsx:826-835` gates `fullQuote` on the derived `quoteEnabled = Boolean(market.lending && selectedStreamId && selectedApr !== null && !matured)`, distinct from `fillQuote`'s `fillEnabled = quoteEnabled && fill > 0n` at `web/components/ActionModal.tsx:843-850` — collapsing these would make one quote request fire prematurely with a phantom `fill` amount).

Either way, this is a performance refactor that's secretly also a behavior change: the network-request count goes down, but *when* each piece of data becomes available changes too. That's exactly the kind of regression a behavior-preservation-focused simplification pass exists to prevent, which is why "do the `enabled` predicates match, character for character" needs to be a mechanical check applied before every batching change, not a vibe judgment based on how similar the calls look.

## When to Apply

- Any time a code review or simplification pass proposes consolidating multiple data-fetching hook calls into one batched/combined call — not limited to wagmi's `useReadContract`/`useReadContracts`. The same reasoning applies to any hook library exposing a per-call gate (`enabled`, `skip`, a conditional `suspense` call, React Query's `enabled`, Apollo's `skip`, etc.): a single combined call can only accept one gate, so every input call's gate must already agree before combining.
- Specifically watch for the trap: **"same component, looks similar, but check each call's gate individually."** Visual or structural proximity — same component, same form, same general "wallet-scoped ERC20 read" shape — is not evidence that the gates match. `ActionModal.tsx` has multiple forms where reads that look interchangeable (`allowance` vs `balanceOf`, both keyed off `connectedAddress`) actually diverge by one extra clause (`&& market.lending`), and forms where the gates are entirely different concepts (`mode === "deposit"` vs `amount > 0n` vs `selectedStreamId !== null` vs a derived `quoteEnabled`/`fillEnabled`).
- Apply the check per-pair, not per-component: even within a single already-batched call, if a future edit changes one contract's `args`/relevance without revisiting the shared `enabled`, the batch can drift out of sync with its own precondition.

## Examples

**Safe to batch — `MarketRowDetail.tsx:45-59`.** Three balance reads, one shared literal predicate (`Boolean(user)`), batched into one `useReadContracts`; a fourth read (`wrappedUnderlying`) directly below is deliberately left un-batched because it has no `enabled` gate at all (always fetches) and is a different predicate class entirely — batching it in would incorrectly gate an unconditional read behind `Boolean(user)`:

```45:59:web/components/MarketRowDetail.tsx
  const balanceReads = useReadContracts({
    contracts: [
      { address: market.ovrfloToken, abi: erc20Abi, functionName: "balanceOf" as const, args: user ? [user] : undefined },
      { address: market.underlying, abi: erc20Abi, functionName: "balanceOf" as const, args: user ? [user] : undefined },
      { address: market.ptToken, abi: erc20Abi, functionName: "balanceOf" as const, args: user ? [user] : undefined },
    ],
    query: { enabled: Boolean(user) },
  });
  const [ovrfloBalance, underlyingBalance, ptBalance] = balanceReads.data ?? [];
  // Also read by ConvertForm for capacity display — wagmi dedupes by query key.
  const wrappedUnderlying = useReadContract({
    address: market.vault,
    abi: ovrfloAbi,
    functionName: "wrappedUnderlying",
  });
```

**Correctly not batched — `ActionModal.tsx`'s `ConvertForm`, lines 541-588.** Seven reads in one form, at least four distinct `enabled` predicates in play (`mode === "deposit"` alone, `mode === "deposit" && amount > 0n`, no gate at all, and `Boolean(connectedAddress)` three times over — but on three *different* tokens/spenders, so even the identical-looking `Boolean(connectedAddress)` reads aren't necessarily safe to fold together without checking their `args`/addresses too):

```541:588:web/components/ActionModal.tsx
  const depositLimit = useReadContract({
    address: market.vault,
    abi: ovrfloAbi,
    functionName: "marketDepositLimits",
    args: [market.market],
    query: { enabled: mode === "deposit" },
  });
  const totalDeposited = useReadContract({
    address: market.vault,
    abi: ovrfloAbi,
    functionName: "marketTotalDeposited",
    args: [market.market],
    query: { enabled: mode === "deposit" },
  });
  const preview = useReadContract({
    address: market.vault,
    abi: ovrfloAbi,
    functionName: "previewDeposit",
    args: amount > 0n ? [market.market, amount] : undefined,
    query: { enabled: mode === "deposit" && amount > 0n },
  });
  const wrappedUnderlying = useReadContract({
    address: market.vault,
    abi: ovrfloAbi,
    functionName: "wrappedUnderlying",
  });
  const ptAllowance = useReadContract({
    address: market.ptToken,
    abi: erc20Abi,
    functionName: "allowance",
    args: connectedAddress ? [connectedAddress, market.vault] : undefined,
    query: { enabled: Boolean(connectedAddress) },
  });
  const underlyingAllowance = useReadContract({
    address: market.underlying,
    abi: erc20Abi,
    functionName: "allowance",
    args: connectedAddress ? [connectedAddress, market.vault] : undefined,
    query: { enabled: Boolean(connectedAddress) },
  });
  const spendToken = mode === "deposit" ? market.ptToken : mode === "wrap" ? market.underlying : market.ovrfloToken;
  const balanceRead = useReadContract({
    address: spendToken,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: connectedAddress ? [connectedAddress] : undefined,
    query: { enabled: Boolean(connectedAddress) },
  });
```

Note `depositLimit` and `totalDeposited` *do* share an identical predicate (`mode === "deposit"`) and, by this rule, would be a legitimate batching candidate on their own — but `preview` (same `mode === "deposit"` plus `amount > 0n`), `wrappedUnderlying` (no gate), and the three `Boolean(connectedAddress)` reads (`ptAllowance`, `underlyingAllowance`, `balanceRead` — same predicate string, but three different token/spender pairs, and `balanceRead`'s `spendToken` is itself mode-dependent) are not interchangeable with them or each other, which is why the form as a whole was left as individual reads rather than one large batch.

A second cluster in `ActionModal.tsx`'s `BorrowForm` shows the same pattern with derived booleans instead of literals — `recipient`/`approved` gated on `selectedStreamId !== null` (`web/components/ActionModal.tsx:818-824`, `:863-869`), `fullQuote` gated on the derived `quoteEnabled` (`web/components/ActionModal.tsx:826-835`), `fillQuote` gated on the stricter derived `fillEnabled = quoteEnabled && fill > 0n` (`web/components/ActionModal.tsx:843-850`), and `gather` gated on `Boolean(fillEnabled && connectedAddress)` (`web/components/ActionModal.tsx:852-861`) — each predicate is a strict superset of the previous one, so collapsing any two into a shared batch would force the less-restrictive read to wait on the more-restrictive one's extra condition.

## Related

- `docs/solutions/architecture-patterns/shared-hook-safety-depends-on-render-tree-position.md` — the same meta-lesson in a different domain: "before consolidating N call sites into one shared primitive, classify each call site's precondition individually — visual/structural similarity is not evidence they match." That doc's precondition axis is hydration/render-tree timing; this doc's axis is `query.enabled` equality. Both came out of the same 2026-07-27 review pass and touch `MarketRowDetail.tsx`.
- `docs/solutions/architecture-patterns/wagmi-query-key-dedup-makes-cross-component-hook-duplication-free.md` — the opposite-direction case: *across* components calling the same read with matching args (not `enabled`), where dedup already makes the "duplication" free and no merge is needed at all. Read together, these two docs bound the same axis from both sides.
- `docs/solutions/best-practices/prefer-battle-tested-libraries-over-hand-rolled-code.md` (pattern #20 in `docs/solutions/patterns/ovrflo-critical-patterns.md`) — the general "consolidate duplicated logic" rule that this doc adds a caveat to specifically for merging on-chain reads: consolidation is good, but only once every call site's gate has been checked to match.
- `docs/solutions/architecture-patterns/web-markets-outcome-first-planners-and-tx-queue.md` — documents an existing `useReadContracts` precedent in this codebase (symbol batching at the app root) without discussing enabled-predicate safety; a candidate for a forward cross-reference once this doc exists.
- Skimmed `docs/solutions/patterns/ovrflo-critical-patterns.md` for overlap: its `useReadContract`/`useReadContracts` mentions are about a different concern (which components are allowed to perform data fetches at all), and pattern #10 ("strictly-increasing IDs in batch functions") is Solidity-side batch-array validation — neither currently covers this specific read-batching/enabled-predicate-safety condition.
