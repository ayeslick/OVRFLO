# 07 — Fuzz, attack scenarios, fork custody, and the gas-flatness snapshot

**What to build:** Port `test/OVRFLOFuzz.t.sol` and `test/OVRFLOAttackScenarios.t.sol` to the new API (drop sale-path scenarios; vault-side scenarios untouched). Port the lending fork suite's Sablier custody assertions (stranger-cannot-withdraw; NFT-owner transitions across escrow and return) to the new API in `test/fork/` rather than rewriting them. Add a new `OVRFLOLendingGas` test contract housing: the flatness pair (a borrow whose interval spans 1 position vs 50 — delta bounded by constant loan-record cost) and the Multicall-batched supply+withdraw cycle measurement that pins tape-spam cost as gas-bounded; lock both into `.gas-snapshot`.

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
- [ ] ~~Fork custody assertions ported to the new API~~ **Deferred by user directive 2026-08-08: no fork-test work in this buildout.** The custody properties (stranger cannot withdraw an escrowed stream; NFT owner transitions user → lending → borrower) must still be asserted against the local Sablier mock in the attack-scenario suite; the mainnet-fork port happens in a later pass
- [ ] `OVRFLOLendingGas` (name matches the snapshot gate's `--match-contract OVRFLOLending` filter): 1-position vs 50-position borrow gas delta ≤ constant loan-record cost — the measurable blind-fill guarantee
- [ ] `OVRFLOLendingGas` also pins the Multicall supply+withdraw cycle cost (risk #4's gas-bounded griefing evidence)
- [ ] `forge snapshot --match-contract OVRFLOLending` produces the pair in `.gas-snapshot`; `forge build` then `forge test` green; `forge fmt --check` clean

## Plan unit

U7 in `docs/plans/2026-08-05-001-feat-lending-v1-lite-plan.md`
