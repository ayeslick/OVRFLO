---
title: Enforce cross-cutting write invariants at the write layer, not the call site
date: 2026-07-29
category: architecture-patterns
module: web/hooks/useWriteFlow.ts, web/hooks/useChainGuard.ts
problem_type: architecture_pattern
component: frontend_stimulus
severity: high
applies_when:
  - An invariant must hold for every transaction the app broadcasts
  - A UI gate is the only thing currently preventing a bad write
  - New write call sites are expected to be added over time
tags: [wagmi, chain-id, wrong-network, defense-in-depth, invariants, write-layer]
---

# Enforce cross-cutting write invariants at the write layer, not the call site

## Context

Audit finding H-2 (requirement R5) was a wrong-network write: a wallet pointed
at a chain other than the configured one could reach a broadcast. The obvious
fix is a UI gate — disable the form, show a switch-network notice — and that
gate exists (`FormBody`).

A gate is not enforcement. It can be bypassed by a stale tab, by a chain switch
that races a click, or simply by a call site that renders outside it. Requirement
R6 therefore asked that every write also *name* its expected chain, so wagmi
refuses the broadcast when the connected chain does not match.

The app has **14 `writeContract` call sites** — 12 in `ActionModal.tsx`, 2 in
`useTxQueue.ts`. Adding `chainId` at each of them is 14 opportunities to forget,
plus every call site added later.

## Guidance

**Inject the invariant once, in the wrapper every write already goes through.**

`useWriteFlow` wraps wagmi's `writeContract` and injects `chainId` centrally
(`web/hooks/useWriteFlow.ts:60`):

```ts
const writeContract = useCallback(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ((args: any, options: any) => {
    if (args?.address) touched.current = [args.address as Address];
    return write.writeContract({ chainId: configuredChainId, ...args }, options);
  }) as typeof write.writeContract,
  [write],
);
```

Two properties make this the right shape:

- **A call site cannot opt out by omission.** Forgetting is no longer possible,
  because there is nothing to remember. A call site added next month inherits
  the invariant without its author knowing it exists.
- **It is one place to audit.** "Does every write name its chain?" is answerable
  by reading one function, not by grepping 14 sites and hoping the grep pattern
  covered every spelling.

**On the cast.** Typing the wrapper honestly is not possible here, and the
`as typeof write.writeContract` is a TypeScript limitation rather than a
soundness hole. `writeContract` is generic over the ABI, and its parameter is a
union of per-variant shapes; TypeScript will not distribute a spread across
that union. Writing an explicit signature for the wrapper erases the generics
that give call sites their argument checking — so the safe-looking option is
the one that actually loses type safety, at 14 call sites, permanently. Casting
the wrapper back to the original signature preserves call-site inference
exactly; only the injection itself is untyped, and `chainId` is valid on every
member of the union.

## Why This Matters

The UI gate and the write-layer check are not redundant — they do different
jobs, and conflating them is how the second one gets dropped as "already
covered."

- The **gate** is UX. It tells the user why they cannot proceed and offers the
  switch. It is allowed to be defeated by a race, because being defeated costs
  nothing on its own.
- The **write layer** is enforcement. It has no opinion about presentation and
  refuses the broadcast unconditionally.

A broadcast to the wrong chain is not a cosmetic failure — it is a signed
transaction against whatever contract happens to occupy that address on the
other chain. The invariant needs to hold at the point where the irreversible
thing happens, which is not where the button lives.

The related nuance in `useChainGuard` follows from the same separation:
`wrongChain` is deliberately **false** while disconnected or reconnecting,
because `connection.chainId` is undefined then, and showing a switch-network
prompt to someone with no wallet attached would displace the CONNECT WALLET
path. The gate is tuned for the user's experience; correctness does not depend
on that tuning being perfect, because the write layer is not tuned at all.

## When to Apply

- Any invariant that must hold for *every* write: chain, sender, gas policy,
  simulation, nonce discipline
- When the current defense is a rendered gate and the count of call sites is
  above one
- When you notice yourself writing "remember to pass X" in a code comment or a
  ticket — that sentence is the signal the invariant is in the wrong place

## Examples

**Rejected — per-call-site, 14 chances to forget:**

```ts
writeContract({ chainId, address: lending, abi, functionName: "repayLoan", args: [loanId] });
```

**Adopted — call sites unchanged, invariant unconditional:**

```ts
// no chainId here; useWriteFlow injects it
writeContract({ address: lending, abi, functionName: "repayLoan", args: [loanId] });
```

## Related

- [useWriteFlow: on-chain revert treated as confirmed](../logic-errors/usewriteflow-on-chain-revert-treated-as-confirmed.md) — the other invariant that belongs in this wrapper rather than at call sites
- [Shared hook safety depends on render-tree position](./shared-hook-safety-depends-on-render-tree-position.md) — the constraint on where such a wrapper can live
- [patterns/ovrflo-critical-patterns.md](../patterns/ovrflo-critical-patterns.md) — pattern #8, the same single-entry-point principle applied to contract admin
