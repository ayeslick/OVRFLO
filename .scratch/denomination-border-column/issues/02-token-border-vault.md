# 02 — Token, border, and vault constructor chain

**What to build:** One `new OVRFLO` creates `OVRFLOBorder`; the border creates the two-minter `OVRFLOToken` with ERC20Permit. Deposit takes the fee from the minted ovrfloToken. Wrap, unwrap, and excess-underlying sweep live on the border. The vault keeps `underlying` as column identity and keeps `sweepExcessPt`. FREI-PI asserts run at the end of wrap, unwrap, and deposit. Token, border, and vault are one compile unit.

**Blocked by:** 01

**Status:** ready-for-agent
**Labels:** ready-for-agent

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md

Scope: CS1 U2 only (= this ticket). Stop when this ticket's acceptance criteria are met.
Ticket: .scratch/denomination-border-column/issues/02-token-border-vault.md
Spec/harness: .scratch/denomination-border-column/spec.md — follow its per-session rules.
Do not edit the plan. Do not start other units. Do not switch lending escrow. Do not
add registerOvrflo binding checks (04). Do not flip web call sites (07) except the
compile-coupled bits named in U2.
Before any code, read Required reading below and the plan sections: Goal Capsule,
KD2, KD3, KD4, KD5, KD8, storage-golden regeneration bullet, Sweep rules 1–3 and 7–8,
Verification Contract item 7 successors *Fee-from-mint*, *Zero-fee skip-mint*,
*Border round trip*, *Nested constructors*, *Permit*, and ### CS1 U2.
Record intent before the first code write. Append OVRFLOBorder to CONTRACTS, then
regenerate goldens only via check-storage-layout.sh --write. Run npm --prefix web
run build at this boundary. Token suite uses a pranked stand-in border; vault
construction bindings live in later factory/vault tests — do not duplicate both
directions in every file.
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

- [ ] After `new OVRFLO(...)`, `token.vault()` equals the vault, `token.border()` equals `vault.border()`, and `border.ovrfloToken()` equals `vault.ovrfloToken()`
- [ ] A third address cannot mint or burn; error is `NotMinter()`
- [ ] Token constructor takes named `vault` plus `border = msg.sender`; both authorities get mint and burn; no setter exists
- [ ] ERC20Permit domain uses the same `name_` string as ERC20
- [ ] Deposit mints net to the depositor and fee to treasury; depositor approves only PT; no party's underlying balance changes during deposit; `FeeTaken.token` is ovrfloToken; `Deposited.toUser` and `minToUser` are the net
- [ ] Zero-fee deposit does not mint to treasury and does not revert
- [ ] Wrap and unwrap live on the border with the vault's current reserve posture (no reentrancy guard; reentrant-unwrap test ports); FREI-PI reserve assert holds at function end
- [ ] Deposit FREI-PI assert is `marketTotalDeposited[market] <= pt balance`
- [ ] Vault holds no wrap reserve and no `sweepExcessUnderlying`; `sweepExcessPt` stays on the vault
- [ ] Wrap 10 then unwrap 7 leaves reserve 3; vault underlying balance is zero throughout; unwrap beyond reserve reverts `InsufficientReserve`
- [ ] Storage goldens for the changed artifacts are generated via `check-storage-layout.sh --write`; `OVRFLOBorder` is in `CONTRACTS`; a border golden test exists
- [ ] Generated web ABI includes `OVRFLOBorder`; error union and `generatedErrorNames` include the border ABI; cache invalidation keys include the border address
- [ ] `forge build` then `forge test` green; `forge fmt --check` clean; `npm --prefix web run build` green

## Plan unit

CS1 U2 in `docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md`
