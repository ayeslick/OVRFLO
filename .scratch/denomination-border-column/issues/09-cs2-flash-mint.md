# 09 — CS2: ERC-3156 flash mint in OVRFLOReserve

**What to build:** `OVRFLOReserve` offers ERC-3156 flash mint of ovrfloToken. Fee launches at zero. `FLASH_FEE_MAX_BPS = 9`. `flashMintMax` launches at 0. Ceiling is one million whole ovrfloToken. Per-call bound is `amount <= flashMintMax`. Overflow guard is `type(uint256).max - totalSupply()`. Flash-only lock. Wrap and unwrap stay callable in the callback. `totalSupply` after equals `totalSupply` before.

**Blocked by:** 08

**Status:** ready-for-agent
**Labels:** ready-for-agent

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md

Scope: CS2-U1 (= this ticket). Stop when this ticket's acceptance
criteria are met.
Ticket: .scratch/denomination-border-column/issues/09-cs2-flash-mint.md
Spec/harness: .scratch/denomination-border-column/spec.md — follow its per-session rules.
Do not edit the plan. Do not start CS1 or CS3. Do not add a vault-wide lock.
Before any writes, write the Solidity intent record (Sequence 6).
Read Required reading below and the plan sections: KD8 flash-mint FREI-PI,
KD14 CS2 constants, CS2-U1, sweep rules 3 and 10, Verification Contract
successors *Flash mint conservation* and *Flash surface gone*.
Use OZ IERC3156 under lib/openzeppelin-contracts/contracts/interfaces/.
Launch flashMintMax = 0. Ceiling 1_000_000 * 10**18. FLASH_FEE_MAX_BPS = 9.
Factory forwarders: setReserveFlashMintMax and setReserveFlashFeeBps.
ce-work overrides (they win over the skill's defaults): skip ce-code-review.
Branch: work on ticket/09 in this worktree. Do not create another branch or
ask about branches. Commits: plumbing bypass per
.cursor/rules/no-commit-attribution.mdc; never run git commit. Review: dispatch
one read-only reviewer subagent with the slug from spec § Model routing;
reviewers report, this chat decides. No PR, no ce-commit-push-pr, no branding:
push the ticket branch and stop.
After local verification, mark ticket checkboxes done and set Status: resolved.
```

**Required reading:**

- Plan KD8 flash-mint FREI-PI bullet and KD14 CS2 paragraph
- CS2-U1
- `docs/solutions/patterns/solidity-implementation-discipline.md`
- https://ethskills.com/SKILL.md
- this ticket's acceptance criteria

## Acceptance criteria

- [ ] Scratch/Solidity intent record exists before the first code write
- [ ] `OVRFLOReserve` implements ERC-3156 `maxFlashLoan` / `flashFee` / `flashLoan` of ovrfloToken
- [ ] `flashMintMax` launches at 0; ceiling is one million whole tokens; fee launches at 0 under a 9 bps hard cap
- [ ] `maxFlashLoan` is 0 for the wrong token, while entered, and when max is 0; otherwise `min(flashMintMax, type(uint256).max - totalSupply())`
- [ ] Cap check, repay-and-burn (and fee-to-treasury when fee > 0), flash-only lock, and `totalSupply` after equals `totalSupply` before all hold
- [ ] Wrap and unwrap from the callback succeed
- [ ] Nested flash reverts
- [ ] No vault-wide flash lock is added
- [ ] Factory `setReserveFlashMintMax` / `setReserveFlashFeeBps` enforce the ceilings
- [ ] Reserve storage golden is regenerated via `check-storage-layout.sh --write`

## Plan unit

CS2-U1 in `docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md`
