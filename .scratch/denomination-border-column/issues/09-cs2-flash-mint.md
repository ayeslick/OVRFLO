# 09 — CS2: ERC-3156 flash mint in OVRFLOReserve

**What to build:** `OVRFLOReserve` offers ERC-3156 flash mint of ovrfloToken. Fee launches at zero. `FLASH_FEE_MAX_BPS = 9`. `flashMintMax` launches at 0. Ceiling is 100 billion whole ovrfloToken. Per-call bound is `amount <= flashMintMax`. Overflow guard is `type(uint256).max - totalSupply()`. Flash-only lock. Wrap and unwrap stay callable in the callback. `totalSupply` after equals `totalSupply` before.

**Blocked by:** 08

**Status:** resolved
**Labels:** ready-for-agent

## Intent (ticket/09, 2026-09-02) — before code

Assumptions: CS1 is live. Wrap, unwrap, and two-minter mint live on `OVRFLOReserve`. Factory already forwards reserve sweep through `ovrfloToReserve`. PT flash is gone and stays gone. No vault-wide lock. Ticket 10 owns the request book. Ticket 06 owns fuzz and invariant re-derivation. OZ `IERC3156FlashLender` / `IERC3156FlashBorrower` under `lib/openzeppelin-contracts/contracts/interfaces/` are the flash ABI. `ERC20FlashMint` stays off `OVRFLOToken` because mint authority is the two named minters.

Owner override 2026-09-02: `FLASH_MINT_MAX_CEILING` is `100_000_000_000 * 10**18` (100 billion whole ovrfloToken). KD14 and signed decision 10 still print one million. The plan is not edited. This ticket records the deviation.

Crown invariant (KD8): after a successful `flashLoan`, `ovrfloToken.totalSupply()` equals the supply recorded before the mint. Fee tokens come from the receiver's already-pulled balance and go to `vault.TREASURY_ADDR()`. A wrap or unwrap in the callback must not share the flash-entered flag. Nested `flashLoan` reverts because `maxFlashLoan` is 0 while entered.

Predicted blast radius: `src/OVRFLOReserve.sol`, `src/OVRFLOFactory.sol`, `test/OVRFLOReserveFlashMint.t.sol`, `test/OVRFLOAttackScenarios.t.sol`, `test/DeploySize.t.sol` (size gate only), `artifacts/tests/storage-layout/` (reserve golden via `check-storage-layout.sh --write`), `web/lib/generated.ts` (typegen), `web/lib/errors.ts`, `CONCEPTS.md`, `docs/agents/onboarding.md`, this ticket. Fuzz and invariant files only if plain `forge test` fails to compile or go green.

Verification that fails if this ticket is wrong: focused Foundry tests in `test/OVRFLOReserveFlashMint.t.sol` for launch-zero, conservation at fee 0 and fee 9, `maxFlashLoan` shape, nested flash, wrap/unwrap in the callback, factory ceiling forwarders; `test/StorageLayout.t.sol` after golden regen; `test/DeploySize.t.sol`; `forge build` then `forge test`; `forge fmt --check`. No `FOUNDRY_PROFILE=invariant`. No fizz harness.

Reuse: OZ IERC3156 interfaces, existing `ZeroAmount` / `TransferMismatch` / `NotAdmin`, factory `_requireKnownOvrflo` plus `ovrfloToReserve`, wrap/unwrap with no `ReentrancyGuard`, `OVRFLOToken.mint` / `burn` from the reserve, `SafeERC20` pull, `Math.mulDiv` for the fee. No new treasury storage on the reserve: read `TREASURY_ADDR` from the vault through a tiny local interface so `OVRFLO.sol` is not imported (circular).

This ticket owns CS2-U1. Ticket 10 owns CS3. Ticket 06 owns property re-derivation. Seam: factory flash setters take the vault address, look up the reserve, and forward; they do not touch lending or the request book.

Rejected: DssFlash `cap - totalSupply()` as the user-facing max (sweep rule 10). `ReentrancyGuard` on wrap/unwrap. Vault-wide flash lock. Inheriting `ERC20FlashMint` on the token.

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
Launch flashMintMax = 0. Ceiling 100_000_000_000 * 10**18. FLASH_FEE_MAX_BPS = 9.
Factory forwarders: setReserveFlashMintMax and setReserveFlashFeeBps.
Fuzz and invariant files: minimum edit to keep plain forge test green, nothing
more. Do not run FOUNDRY_PROFILE=invariant or the fizz harness. 06 owns the
re-derivation later; log each minimum edit on this ticket.
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

- [x] Scratch/Solidity intent record exists before the first code write
- [x] `OVRFLOReserve` implements ERC-3156 `maxFlashLoan` / `flashFee` / `flashLoan` of ovrfloToken
- [x] `flashMintMax` launches at 0; ceiling is 100 billion whole tokens; fee launches at 0 under a 9 bps hard cap
- [x] `maxFlashLoan` is 0 for the wrong token, while entered, and when max is 0; otherwise `min(flashMintMax, type(uint256).max - totalSupply())`
- [x] Cap check, repay-and-burn (and fee-to-treasury when fee > 0), flash-only lock, and `totalSupply` after equals `totalSupply` before all hold
- [x] Wrap and unwrap from the callback succeed
- [x] Nested flash reverts
- [x] No vault-wide flash lock is added
- [x] Factory `setReserveFlashMintMax` / `setReserveFlashFeeBps` enforce the ceilings
- [x] Reserve storage golden is regenerated via `check-storage-layout.sh --write`

## Plan unit

CS2-U1 in `docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md`

## Deviation log

1. **Ceiling 100 billion (owner 2026-09-02).** KD14 and signed decision 10 pin `FLASH_MINT_MAX_CEILING = 1_000_000 * 10**18`. The owner raised the ceiling to `100_000_000_000 * 10**18`. The plan file is not edited. Tests and constants on this ticket use 100 billion.

## Session log

Intent recorded 2026-09-02 before the first Solidity write.

Verification: `forge build`; `forge test` 402 passed, 0 failed, 5 skipped (fork tests without `MAINNET_RPC_URL`); `forge fmt --check` on touched Solidity; `web` `tsc --noEmit`; storage golden via `check-storage-layout.sh --write`; `check-storage-layout.sh` later exit 0. No `FOUNDRY_PROFILE=invariant`. No fizz.

Fuzz and invariant files: no minimum edits. Plain `forge test` compiled and went green without them.

Extra vs predicted blast radius: `test/OVRFLOFactory.t.sol` (two stranger-call rows on the owner-gating census). `test/DeploySize.t.sol`, `wagmi.config.ts`, and `check-storage-layout.sh` needed no edit.

Reuse: OZ IERC3156, factory `_requireKnownOvrflo` plus `ovrfloToReserve`, tiny local `IVaultTreasury` so `OVRFLO.sol` is not imported.
