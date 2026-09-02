# 02 — Token, reserve, and vault constructor chain

**What to build:** One `new OVRFLO` creates `OVRFLOReserve`; the reserve creates the two-minter `OVRFLOToken` with ERC20Permit. Deposit takes the fee from the minted ovrfloToken. Wrap, unwrap, and excess-underlying sweep live on the reserve. The vault keeps `underlying` as column identity and keeps `sweepExcessPt`. FREI-PI asserts run at the end of wrap, unwrap, and deposit. Token, reserve, and vault are one compile unit.

**Blocked by:** 01

**Status:** resolved
**Labels:** ready-for-human

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md

Scope: CS1 U2 only (= this ticket). Stop when this ticket's acceptance criteria are met.
Ticket: .scratch/denomination-border-column/issues/02-token-reserve-vault.md
Spec/harness: .scratch/denomination-border-column/spec.md — follow its per-session rules.
Do not edit the plan. Do not start other units. Do not switch lending escrow. Do not
add registerOvrflo binding checks (04). Do not flip web call sites (07) except the
compile-coupled bits named in U2.
Before any code, read Required reading below and the plan sections: Goal Capsule,
KD2, KD3, KD4, KD5, KD8, storage-golden regeneration bullet, Sweep rules 1–3 and 7–8,
Verification Contract item 7 successors *Fee-from-mint*, *Zero-fee skip-mint*,
*Reserve round trip*, *Nested constructors*, *Permit*, and ### CS1 U2.
Record intent before the first code write. Append OVRFLOReserve to CONTRACTS, then
regenerate goldens only via check-storage-layout.sh --write. Do not run or gate on
the web build; that is ticket 07's gate. Token suite uses a pranked stand-in reserve; vault
construction bindings live in later factory/vault tests — do not duplicate both
directions in every file.
ce-work overrides (they win over the skill's defaults): skip ce-code-review.
Branch: work on ticket/02 in this worktree. Do not create another branch or
ask about branches. Commits: plumbing bypass per
.cursor/rules/no-commit-attribution.mdc; never run git commit. Review: dispatch
one read-only reviewer subagent with the slug from spec § Model routing;
reviewers report, this chat decides. No PR, no ce-commit-push-pr, no branding:
push the ticket branch and stop.
After local verification, mark ticket checkboxes done and set Status: resolved.
```

**Required reading:**

- `BASE_SECURITY.md`
- `VAULT_SECURITY.md`
- `docs/solutions/patterns/solidity-implementation-discipline.md`
- `docs/solutions/patterns/ovrflo-coding-standard.md`
- `docs/solutions/patterns/ovrflo-style-guide.md`
- https://ethskills.com/SKILL.md
- `docs/solutions/patterns/ovrflo-critical-patterns.md`
- this ticket's acceptance criteria

## Acceptance criteria

- [x] After `new OVRFLO(...)`, `token.vault()` equals the vault, `token.reserve()` equals `vault.reserve()`, and `reserve.ovrfloToken()` equals `vault.ovrfloToken()`
- [x] A third address cannot mint or burn; error is `NotMinter()`
- [x] Token constructor takes named `vault` plus `reserve = msg.sender`; both authorities get mint and burn; no setter exists
- [x] ERC20Permit domain uses the same `name_` string as ERC20
- [x] Deposit mints net to the depositor and fee to treasury; depositor approves only PT; no party's underlying balance changes during deposit; `FeeTaken.token` is ovrfloToken; `Deposited.toUser` and `minToUser` are the net
- [x] Zero-fee deposit does not mint to treasury and does not revert
- [x] Wrap and unwrap live on `OVRFLOReserve` with the vault's current wrap/unwrap posture (no reentrancy guard; reentrant-unwrap test ports); FREI-PI reserve assert holds at function end
- [x] Deposit FREI-PI assert is `marketTotalDeposited[market] <= pt balance`
- [x] Vault holds no wrap reserve and no `sweepExcessUnderlying`; `sweepExcessPt` stays on the vault
- [x] Wrap 10 then unwrap 7 leaves `wrappedUnderlying` 3; vault underlying balance is zero throughout; unwrap beyond the counter reverts `InsufficientReserve`
- [x] Storage goldens for the changed artifacts are generated via `check-storage-layout.sh --write`; `OVRFLOReserve` is in `CONTRACTS`; a reserve golden test exists
- [x] Generated web ABI includes `OVRFLOReserve`; error union and `generatedErrorNames` include the reserve ABI; cache invalidation keys include the reserve address
- [x] `forge build` then `forge test` green; `forge fmt --check` clean. The web build is not a gate here; the vault ABI loses `wrap`/`unwrap`/`wrappedUnderlying` and the web call sites flip in 07

## Plan unit

CS1 U2 in `docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md`

## Deviation log (ticket/02, 2026-09-02)

Base for the diff: `main`. Commits: `87eedd6` (contracts, tests, goldens, tooling), `eaa5056` (web compile-coupled bits).

1. **Compile-coupled files outside the U2 file list.** Removing `wrap`/`unwrap`/`wrappedUnderlying`/`sweepExcessUnderlying` from the vault and `owner()` from the token broke compilation in: `src/OVRFLOFactory.sol` (forwarder now reads `OVRFLO.reserve()`), `test/mocks/MockOvrfloAdmin.sol`, `test/OVRFLOFactory.t.sol` (asserts `vault()`/`reserve()` instead of `owner()`), `test/OVRFLOFuzz.t.sol`, `test/OVRFLOInvariant.t.sol`, `test/StorageLayout.t.sol` (new reserve golden test). Each received the minimum retarget. `forge build` compiles every file under `test/`, so these could not wait for a later unit.
2. **Fizz harness retarget (minimum, not a re-derivation).** `test/fizz/Base.sol`, `test/fizz/handlers/OVRFLOHandler.sol`, `test/fizz/Properties.sol` compile under `forge test` (`FoundryTester`). Changes: `reserve` field and approval in Base; wrap/unwrap calls target the reserve; GL-07 solvency reads reserve underlying + vault PT; GL-09 reads the reserve; GL-30 asserts the two minters; SP-04 measures the fee as the treasury ovrfloToken delta; SP-10 compares `previewStream` gross `toUser` to `deposit` net `toUser + fee`. Property re-derivation stays in CS1 U6 as planned. Owner said "dont worry about the fuzzing"; no `FOUNDRY_PROFILE=invariant` or Echidna/Medusa run was made.
3. **`web/lib/types.ts` gained `reserve: Address` on `VaultInfo`.** Not named in U2. `web/lib/invalidate.ts` (named in U2) reads `market.reserve`, so the field must exist on the type. One field; call sites that build `VaultInfo` flip in U7.
4. **Fork suites named in the plan but not changed:** `test/fork/OVRFLOFactoryMainnetFork.t.sol` and `test/fork/OVRFLOStreamDifferential.t.sol` have no fee approval or wrap seam; they compile unchanged. `test/fork/OVRFLOMainnetFork.t.sol`, `test/fork/OVRFLOWrapUnwrapFork.t.sol`, `test/fork/OVRFLOLendingMainnetFork.t.sol` were ported. All five self-skip without `MAINNET_RPC_URL`; they were not run against mainnet in this session.
5. **`test/helpers/VaultMockHelpers.sol`:** `_computeFee` removed (fee is now taken from the mint, so the vault test asserts against `previewDeposit`), not only the line range the plan cites.
6. **Error names for the FREI-PI asserts:** `OVRFLOReserve.ReserveExceedsBalance()` and `OVRFLO.DepositedExceedsBalance()` (one custom error per assert, so the web catalog can carry copy). No generic `InvariantViolated` was used.

7. **Review residual (GPT-5.6 Sol, Low):** `test/DeploySize.t.sol` `_artifacts()` does not list `OVRFLOReserve`. The plan assigns that addition to U5 (line 835), so it stays there. U2's stop condition (e) holds: `DeploySize` passes with the vault initcode embedding reserve and token creation code, and the reserve initcode is a subset of the vault initcode. No other finding from the primary reviewer.

8. **Second-pass review (Grok 4.6 xhigh):** no protocol bug; sizes fit (OVRFLO runtime 6,291 B, initcode 17,329 B; reserve 2,539 / 9,999); goldens match `forge inspect`. Applied in commit 3: a wrap 10 / unwrap 7 test that asserts the counter is 3, the vault underlying is zero throughout, and over-unwrap reverts `InsufficientReserve`; underlying snapshots for user, treasury, vault, and reserve around the fee-bearing deposit; stale NatSpec in `OVRFLOFactory.registerOvrflo` and the `Deposited.toUser` event param. Left for U6 by owner instruction ("invariants and fuzzing were skipped on purpose"): fuzz R10 runs at `feeBps = 0`; `OVRFLOInvariant` runs at `feeBps = 0` with a setup wrap that starves `unwrapBeyondReserve`; `invariant_UnwrapsNeverExceedSuccessfulWraps` is true by handler construction; fizz GL-06 holder set does not list the reserve, so an Echidna/Medusa campaign fails GL-06 on the first wrap until U6 adds `address(reserve)`. `DeploySize` artifact list is U5 (item 7).

Verification: `forge build` clean; `forge fmt --check src test` clean; `forge test` (default profile) 364 passed, 0 failed, 5 skipped (fork suites). Goldens regenerated only via `bash tools/scripts/check-storage-layout.sh --write`; `OVRFLOReserve` is in `CONTRACTS`.

