# 06 — Invariant and fuzz re-derivation

**What to build:** Solvency and wrap-reserve invariants span vault plus `OVRFLOReserve`. Lending escrow and money-recipient invariants use ovrfloToken. The wrap/unwrap invariant suite ports to `OVRFLOReserve`. Vault underlying-reserve invariants leave the vault suite. Fizz properties flip asset, holder set, span, retarget, and minter shape after a fizz-sync against the live harness. Raw-slot constants are recomputed from the regenerated lending golden.

**Blocked by:** 04, and owner start-OK (deferred 2026-09-02)

**Status:** ready-for-human
**Labels:** ready-for-human

**Owner note (2026-09-02):** fuzz and invariant re-derivation runs after the feature tickets. Do not claim this ticket until the owner records start-OK here. Until then, every other ticket makes only the minimum edit that keeps `forge test` green in the fuzz and invariant files it breaks, and never runs `FOUNDRY_PROFILE=invariant` or the fizz harness (Echidna/Medusa). Ticket 08 no longer waits on this ticket.

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md

Scope: CS1 U6 only (= this ticket). Stop when this ticket's acceptance criteria are met.
Ticket: .scratch/denomination-border-column/issues/06-invariant-fuzz-rederive.md
Spec/harness: .scratch/denomination-border-column/spec.md — follow its per-session rules.
Do not edit the plan. Do not start other units. 05 runs in parallel — do not rewrite
seed or DeploySize here. Do not flip web call sites (07).
Before any code, read Required reading below and the plan sections: KD13, Sweep
rule 4, Verification Contract items 2 and 7 (column solvency, wrap reserve,
lending escrow), and ### CS1 U6.
Run the fizz-sync path. Verify each cited GL-nn id against test/fizz/Properties.sol
during the sync rather than trusting the plan citation. Recompute TICKS_SLOT and
packed epoch-slot decode from the regenerated lending golden; keep exposed_epochState
cross-checks green. Never edit a slot constant to make a vacuous pass.
ce-work overrides (they win over the skill's defaults): skip ce-code-review.
Branch: work on ticket/06 in this worktree. Do not create another branch or
ask about branches. Commits: plumbing bypass per
.cursor/rules/no-commit-attribution.mdc; never run git commit. Review: dispatch
one read-only reviewer subagent with the slug from spec § Model routing;
reviewers report, this chat decides. No PR, no ce-commit-push-pr, no branding:
push the ticket branch and stop.
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

- [ ] Column solvency: `ovrfloToken.totalSupply() <= Σ_pt.balanceOf(vault) + underlying.balanceOf(reserve)` across every approved series
- [ ] Per-origin equality: `totalSupply == Σ marketTotalDeposited + reserve.wrappedUnderlying`
- [ ] Wrap reserve: `wrappedUnderlying <= underlying.balanceOf(reserve)`; unwrap never spends PT
- [ ] Vault suite no longer asserts underlying-reserve on the vault; `invariant_PtBalanceGteDeposited` survives
- [ ] Lending `invariant_EscrowSolvency` and `invariant_MoneyRecipients` use ovrfloToken
- [ ] Fizz GL-02/03/04/06/07/09/30 successors are verified against the live harness and updated
- [ ] Raw-slot constants match the regenerated lending golden; `exposed_epochState` cross-checks stay green
- [ ] `FOUNDRY_PROFILE=invariant forge test --match-contract OVRFLOLendingInvariant -vvv` green at 500 runs / depth 40
- [ ] Reserve wrap invariant suite green under the same invariant profile
- [ ] `forge build` then `forge test` green; `forge fmt --check` clean

## Plan unit

CS1 U6 in `docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md`
