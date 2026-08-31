# 06 — Invariant and fuzz re-derivation

**What to build:** Solvency and reserve invariants span vault plus border. Lending escrow and money-recipient invariants use ovrfloToken. The wrap/unwrap invariant suite ports to the border. Vault underlying-reserve invariants leave the vault suite. Fizz properties flip asset, holder set, span, retarget, and minter shape after a fizz-sync against the live harness. Raw-slot constants are recomputed from the regenerated lending golden.

**Blocked by:** 04 (parallel with 05)

**Status:** ready-for-agent
**Labels:** ready-for-agent

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md

Scope: CS1 U6 only (= this ticket). Stop when this ticket's acceptance criteria are met.
Ticket: .scratch/denomination-border-column/issues/06-invariant-fuzz-rederive.md
Spec/harness: .scratch/denomination-border-column/spec.md — follow its per-session rules.
Do not edit the plan. Do not start other units. 05 runs in parallel — do not rewrite
seed or DeploySize here. Do not flip web call sites (07).
Before any code, read Required reading below and the plan sections: KD13, Sweep
rule 4, Verification Contract items 2 and 7 (column solvency, border reserve,
lending escrow), and ### CS1 U6.
Run the fizz-sync path. Verify each cited GL-nn id against test/fizz/Properties.sol
during the sync rather than trusting the plan citation. Recompute TICKS_SLOT and
packed epoch-slot decode from the regenerated lending golden; keep exposed_epochState
cross-checks green. Never edit a slot constant to make a vacuous pass.
After local verification, mark ticket checkboxes done and set Status: resolved.
```

**Required reading:**

- `/Users/jay/.agents/skills/fizz/skills/fizz-sync/SKILL.md`
- `BASE_SECURITY.md`
- `docs/solutions/patterns/solidity-implementation-discipline.md`
- https://ethskills.com/SKILL.md
- `docs/solutions/patterns/ovrflo-critical-patterns.md` (rule 6)
- `docs/solutions/best-practices/closing-stateful-fuzz-coverage-gaps.md`
- this ticket's acceptance criteria

## Acceptance criteria

- [ ] Column solvency: `ovrfloToken.totalSupply() <= Σ_pt.balanceOf(vault) + underlying.balanceOf(border)` across every approved series
- [ ] Per-origin equality: `totalSupply == Σ marketTotalDeposited + border.wrappedUnderlying`
- [ ] Border reserve: `wrappedUnderlying <= underlying.balanceOf(border)`; unwrap never spends PT
- [ ] Vault suite no longer asserts underlying-reserve on the vault; `invariant_PtBalanceGteDeposited` survives
- [ ] Lending `invariant_EscrowSolvency` and `invariant_MoneyRecipients` use ovrfloToken
- [ ] Fizz GL-02/03/04/06/07/09/30 successors are verified against the live harness and updated
- [ ] Raw-slot constants match the regenerated lending golden; `exposed_epochState` cross-checks stay green
- [ ] `FOUNDRY_PROFILE=invariant forge test --match-contract OVRFLOLendingInvariant -vvv` green at 500 runs / depth 40
- [ ] Border wrap invariant suite green under the same invariant profile
- [ ] `forge build` then `forge test` green; `forge fmt --check` clean

## Plan unit

CS1 U6 in `docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md`
