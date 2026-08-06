---
kind: required_reading
scope: ovrflo-solidity
last_updated: 2026-08-06
audience: [ai-agents]
---

# Solidity implementation discipline

Read this before writing or modifying any Solidity in this repo. It governs the
*micro*-decisions of implementation — storage layout, helpers, call surfaces,
verification — for work whose macro-decisions a plan has already settled.

Adapted 2026-08-06 from ponytail-fullstack-web3's `ponytail-solidity` skill. The
persistence modes, ETHSkills routing table, and router integration of the
original are intentionally dropped: AGENTS.md already mandates ethskills, and
this repo's routing systems are `x-ray/` and `docs/maps/`.

## Precedence

When sources conflict, the higher one wins:

1. **The active plan** (`docs/plans/`). Plans are read-only specs (AGENTS.md).
   A session-settled Key Decision is never re-litigated by a minimality
   argument — if the ladder disagrees with the plan, the plan already climbed
   the ladder and chose.
2. **`docs/solutions/patterns/ovrflo-critical-patterns.md`** and the settled
   architecture it encodes.
3. **This document.**

Two standing repo decisions this ladder must not fight:

- Admin flows are multisig → factory → contract (pattern #8). Do not propose
  capability-scoped roles on individual contracts; the factory *is* the
  authorization design.
- Code stays Pendle-specific and Sablier-V2-specific. "Follow the standard"
  (rung 6) means ERC-20/ERC-721 behavior and the like — not generalizing OVRFLO
  interfaces for hypothetical other protocols.

## Sequence

Do not climb the ladder before understanding the system.

1. Read the affected contracts, tests, interfaces, scripts, and dependency
   versions.
2. Trace every reachable entry point and caller: inheritance, callbacks
   (Sablier hooks, EIP-4531 flash-loan callback), multicall, permit flows,
   external integrations.
3. Identify assets, actors, privileges, trust boundaries, and affected
   invariants.
4. Decide whether a runtime FREI-PI check is meaningful and affordable (below).
5. Apply the ladder.
6. For a non-trivial change, record before coding — in the session or the PR
   description — your assumptions, predicted blast radius, and the verification
   that will prove the change. This record is authored *before* the code; never
   reconstruct one afterward and present it as pre-authored intent.
7. Implement the smallest safe change.
8. Run or add the smallest verification that would fail if the change were
   wrong. Repo order: `forge build`, then `forge test`.
9. Review the final diff for both security regressions and removable
   complexity, and compare predicted with actual blast radius — a miss is a
   `docs/solutions` learning candidate.

## The ladder

Stop at the first rung that fully satisfies the requirement and its invariants.
If two rungs work, choose the earlier one.

1. **Offchain?** Keep indexing, aggregation, presentation, and anything the
   timelocked multisig already validates off-chain. Do not duplicate multisig
   checklist items as on-chain requires.
2. **YAGNI?** Remove speculative configurability, roles, factories, adapters,
   and upgrade paths.
3. **Existing flow?** Use the protocol operation already providing the
   behavior.
4. **Existing code?** Reuse this repo's contract, library, interface, modifier,
   error, test helper, or pattern.
5. **Native primitive?** Use safe Solidity/EVM behavior.
6. **Standard?** Follow the relevant ERC/EIP instead of inventing an API
   (subject to the Pendle/Sablier-specific rule above).
7. **Installed audited dependency?** Reuse the pinned version; never silently
   upgrade it.
8. **No storage?** Prefer calldata, memory, events, and deterministic
   derivation over new storage.
9. **No write?** Compute on demand, or combine updates when correctness
   permits.
10. **No interaction?** Remove unnecessary calls, transfers, callbacks,
    approvals, and oracle reads.
11. **No authority?** Prefer immutable configuration over new admin surface;
    any admin surface that must exist goes through the factory.
12. **No proxy?** Immutable deployment. This repo has never deployed a proxy.
13. **No abstraction?** Remove one-use inheritance, interfaces, wrappers, and
    generic frameworks.
14. **One obvious expression?** Use it only when auditability remains clear.
15. **Only then:** write the minimum secure implementation.

## Root-cause fixes

A report names a symptom. Before editing a function:

- find every external/public entry point that reaches it;
- find sibling implementations and duplicated checks;
- inspect all call sites, inheritance overrides, and callbacks;
- identify the invariant that should have prevented the bug.

Fix the shared invariant or choke point once. Do not patch only the
demonstrated exploit path.

## Secure implementation defaults

- Immutable unless upgradeability is an explicit requirement.
- Checks-Effects-Interactions for external calls.
- Reentrancy protection based on the real call graph, not modifier cargo cult —
  and note the vault's flash-loan facility is deliberately *not* `nonReentrant`
  (the borrower must deposit during the callback).
- Pull-based recovery where it reduces forced external execution.
- Explicit units and decimal conversions (PT is always 18 decimals; book
  quantities in the lending rewrite are `UNIT` multiples).
- Custom errors and bounded loops.
- Events for discovery; storage only for consensus-critical current state.
- Fail closed at trust boundaries.
- Never `tx.origin` for authorization.
- Never assembly, `unchecked`, arbitrary calls, or `delegatecall` solely to
  shorten code or save hypothetical gas.

## FREI-PI gate

For value-affecting, accounting-heavy, composable, or batch operations
(`borrow`, `claim`, `close`, `withdraw`, deposit/wrap paths):

1. State the crown invariant in one sentence.
2. List affected entity invariants.
3. Validate function requirements.
4. Apply internal effects.
5. Perform controlled interactions while preserving CEI.
6. Validate the affected final state.
7. Revert atomically if the invariant fails.

Validate only the affected set — never an unbounded protocol-wide scan.
Maintain incremental accounting instead. Do not expose an unsafe intermediate
state to reentrancy.

## Where to enforce an invariant

For each invariant, choose the enforcement location deliberately:

| Location | Use when |
|---|---|
| Function requirement | The property must hold before the operation. |
| Runtime final-state check | The affected property is checkable locally, meaningfully, and with bounded cost. |
| Stateful invariant test | Cross-function sequences or global properties need adversarial exploration. |
| Fork / differential test | Correctness depends on a deployed integration or a reference implementation. |
| Operational control | The property depends on the multisig, monitoring, or an off-chain process. |

Two rules of honesty:

- Do not pretend a test-only property is enforced at runtime.
- Do not pretend a runtime check proves an unobservable off-chain fact.

State every invariant with units, rounding direction, dust policy, and tolerated
error. Equality is often wrong under integer rounding — specify the safe
inequality.

## Verification

Non-trivial changes leave one or more of:

- focused unit/revert tests;
- stateless fuzz tests (`OVRFLOFuzz` conventions, 1000 runs);
- stateful invariant tests (500 runs, depth 25);
- fork tests for real Pendle/Sablier integrations (`test/fork/`);
- differential tests against a reference model for math-heavy structures;
- measured gas/bytecode comparison for any optimization claim.

Never delete a meaningful security test to make a diff smaller. A removed or
weakened test needs its accountability entry, same as the web suite.

## Deliberate ceilings

Mark a safe, bounded simplification — and only that — with:

```solidity
// deliberate-ceiling: <the bound>; revisit when <measurable trigger>
```

The comment must state both the ceiling and a measurable trigger. Never use the
marker for an authorization gap, solvency risk, known exploit, missing replay
protection, or unbounded denial-of-service path.

Ceiling markers are auditable debt. When harvesting them — before an audit or a
release — validate each one: **a comment is not evidence.** Confirm the ceiling
is actually enforced in code, the trigger is measurable, tests cover the
current boundary, and exceeding the ceiling fails safely. Classify what you
find: bounded-safe, scale-trigger, integration-trigger, release-blocker (must
block mainnet until resolved), or not-debt — a marker concealing an exploitable
condition is a security finding, never backlog.

## Reporting

When reporting a completed change, lead with the implementation, then state
only: what was reused or skipped, the invariant protected, the verification
run or added, and any deliberate ceiling with its trigger. State risk
assumptions explicitly; do not bury them in prose.
