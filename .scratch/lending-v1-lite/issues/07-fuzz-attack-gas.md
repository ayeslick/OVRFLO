# 07 — Fuzz, attack scenarios, fork custody, and the gas-flatness snapshot

**What to build:** Two layers (user directive, 2026-08-08). Layer 1 — the fizz skill at `/Users/jay/.agents/skills/fizz/SKILL.md` regenerates the stateful fuzz harness for the new API: `test/fizz/` + `fizz_data/` + `PROPERTIES.md` (automatic mode; it consumes ticket 06's fresh `x-ray/` output as protocol understanding; Medusa campaign run, violations triaged by Guarantee tag). The fizz pipeline spawns its own subagents — if this session cannot spawn subagents, complete Layer 2 and report; the coordinator runs the fizz pipeline at the main-session level. Layer 2 — port `test/OVRFLOFuzz.t.sol` and `test/OVRFLOAttackScenarios.t.sol` to the new API (drop sale-path scenarios; vault-side scenarios untouched). Port the lending fork suite's Sablier custody assertions (stranger-cannot-withdraw; NFT-owner transitions across escrow and return) to the new API in `test/fork/` rather than rewriting them. Add a new `OVRFLOLendingGas` test contract housing: the flatness pair (a borrow whose interval spans 1 position vs 50 — delta bounded by constant loan-record cost) and the Multicall-batched supply+withdraw cycle measurement that pins tape-spam cost as gas-bounded; lock both into `.gas-snapshot`.

**Blocked by:** 05 (parallel with 06)

**Status:** open
**Labels:** ready-for-agent

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-08-05-001-feat-lending-v1-lite-plan.md

Scope: U7 only (= this ticket). Stop when this ticket's acceptance criteria are met.
Ticket: .scratch/lending-v1-lite/issues/07-fuzz-attack-gas.md
Spec/harness: .scratch/lending-v1-lite/spec.md — follow its per-session rules.
Do not edit the plan. Do not start other units. 06 runs in parallel — do not touch
test/OVRFLOLendingInvariant.t.sol.
Before any code, read Required reading below and the plan sections: Goal Capsule,
Success Criteria (gas flatness), Planning Contract (Risks #4, #6, #8, #9; Pinned
Conventions), and ### U7. Fork tests self-skip without MAINNET_RPC_URL — if it is
unavailable, report the environment gate; never fake fork evidence.
After local verification, mark ticket checkboxes done and set Status: resolved.
```

**Required reading:**

- `/Users/jay/.agents/skills/fizz/SKILL.md` (Layer 1 executes this pipeline)
- `BASE_SECURITY.md`
- `docs/solutions/patterns/solidity-implementation-discipline.md`
- https://ethskills.com/SKILL.md
- `docs/solutions/patterns/ovrflo-critical-patterns.md` (rules 6, 18, 19)
- `docs/audit/sablier-interface-contract.md` (the v1.1 ACL table the fork assertions encode)
- `docs/agents/testing.md`
- this ticket's acceptance criteria

## Acceptance criteria

- [ ] Fuzz suite ported: randomized UNIT-granular supply/withdraw/borrow interleavings; withdraw-front-running-borrow is benign (borrower bounded by `minAcceptable`); sale-path fuzz deleted; vault-side fuzz untouched
- [ ] Attack scenarios ported: tape-spam economics bounded by `MIN_LIQUIDITY_AMOUNT`; reentrancy attempts via `ReentrantLendingUnderlying` on borrow-pay and claim-harvest paths; self-fill griefing yields nothing beyond fee loss
- [ ] Fork custody assertions ported to the new API, not rewritten: stranger cannot withdraw an escrowed stream; NFT owner transitions user → lending (borrow) → borrower (close/full repay); suite self-skips cleanly without `MAINNET_RPC_URL`
- [ ] `OVRFLOLendingGas` (name matches the snapshot gate's `--match-contract OVRFLOLending` filter): 1-position vs 50-position borrow gas delta ≤ constant loan-record cost — the measurable blind-fill guarantee — including a pair measured across a tree-height growth (U3 review, 2026-08-08: same-height pairs don't pin flatness through growth)
- [ ] `OVRFLOLendingGas` also pins the Multicall supply+withdraw cycle cost (risk #4's gas-bounded griefing evidence)
- [ ] Fizz harness regenerated for the new API via the fizz skill: `test/fizz/` + `fizz_data/` + `PROPERTIES.md` (Spec IDs re-established, including a GL-70 successor for close-time stream-withdrawn); Medusa campaign completes with violations triaged by Guarantee tag (SHOULD-HOLD violation = confirmed bug; EXPLORATORY = human-review lead)
- [ ] `forge snapshot --match-contract OVRFLOLending` produces the pair in `.gas-snapshot`; `forge build` then `forge test` green; `forge fmt --check` clean

## Plan unit

U7 in `docs/plans/2026-08-05-001-feat-lending-v1-lite-plan.md`
