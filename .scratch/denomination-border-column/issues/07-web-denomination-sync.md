# 07 — Web denomination sync

**What to build:** Markets supply, borrow, wrap, unwrap, and deposit review match the switched column. Escrow asset branding on the supply path becomes ovrfloToken. Deposit review drops the underlying fee approval. Wrap and unwrap call the reserve. Bootstrap discovers `reserve` from `factory.ovrfloToReserve` next to lending. `borrow` calldata includes `onBehalfOf`. E2E fixtures and seeded-wallet funding update. Permit may stay approve-plus-pull. This ticket does not add `Default` / `Advanced` product work.

**Blocked by:** 05

**Status:** resolved
**Labels:** ready-for-human

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md

Scope: CS1 U7 only (= this ticket). Stop when this ticket's acceptance criteria are met.
Ticket: .scratch/denomination-border-column/issues/07-web-denomination-sync.md
Spec/harness: .scratch/denomination-border-column/spec.md — follow its per-session rules.
Do not edit the plan. Do not start other units. Do not add Default / Advanced
navigation, hosted conversion, composite recovery, viem-dlc, or tooling migration.
Do not add NEXT_PUBLIC_OVRFLO_RESERVE.
Do not rewrite destination paths or query keys; that contract is KD16 and CS4.
Before any code, write the scratch intent capsule per docs/maps/SCHEMAS.md §4.
Read Required reading below and the plan sections: KD5 provenance, KD12, Sweep
rules 2 and 9, Verification Contract item 6 CS1 U7 bullet, and ### CS1 U7.
Bootstrap gains a third multicall leg; result pairing becomes ×3; VaultInfo gains
reserve and retiredLendings (KD7 web wind-down pin; enumerate lendings(i)). Maps: assets.md and chain-reads.md wrap-reserve retarget with this ticket.
ce-work overrides (they win over the skill's defaults): skip ce-code-review.
Branch: work on ticket/07 in this worktree. Do not create another branch or
ask about branches. Commits: plumbing bypass per
.cursor/rules/no-commit-attribution.mdc; never run git commit. Review: dispatch
one read-only reviewer subagent with the slug from spec § Model routing;
reviewers report, this chat decides. No PR, no ce-commit-push-pr, no branding:
push the ticket branch and stop.
After local verification, mark ticket checkboxes done and set Status: resolved.
```

**Required reading:**

- `docs/maps/SCHEMAS.md` §4
- `docs/solutions/patterns/ovrflo-web-standard.md`
- https://ethskills.com/SKILL.md (frontend-ux / frontend-playbook)
- `docs/agents/testing.md` (before E2E)
- this ticket's acceptance criteria

## Acceptance criteria

- [x] Scratch intent capsule exists before the first web state-touching edit
- [x] Bootstrap reads `factory.ovrfloToReserve(vault)` into `VaultInfo.reserve`; no client env reserve variable
- [x] Bootstrap enumerates `lendings(i)` for `i < lendingCount`, maps each through `lendingToOvrflo`, and fills `VaultInfo.retiredLendings` with markets where `ovrfloToLending[vault] != market` (KD7 web wind-down pin); with no replacement the list is empty and existing behavior is unchanged
- [x] Supply path branded money is ovrfloToken, not underlying
- [x] Deposit review requires one PT approval and no underlying fee approval
- [x] Wrap and unwrap target the discovered reserve; wrap-reserve reads target the reserve
- [x] `borrow` calldata includes `onBehalfOf`; a self-borrow may pass the user address
- [x] Maps `docs/maps/ui/assets.md` and `docs/maps/state/keys/chain-reads.md` retarget wrap-reserve to the reserve
- [x] `npm --prefix web run test` green; production build green; existing E2E suite green against a seeded fork (or environment gate recorded)

## Plan unit

CS1 U7 in `docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md`

## Session log

Intent capsule: `.scratch/decisions/2026-09-02-web-denomination-sync.yaml` (written before the first web state-touching edit).

`NEXT_PUBLIC_OVRFLO_RESERVE` is on the obsolete env list. The client does not read a reserve env var.

Verification (2026-09-02):
- `npm --prefix web run typecheck` green
- `npm --prefix web run test` green: 116 files, 870 tests
- Maps: `check-maps-presence.sh` clean; state-index `--check` current
- Next production compile: `npm exec -- next build` in `web/` against the local profile compiled and exported
- Immutable `npm --prefix web run build` (`OVRFLO_DEPLOYABLE_BUILD`) was not run. That script needs a verified production artifact and `DEPLOYMENT_RPC_URL`
- E2E was not run. Owner deferred the seeded-fork suite to a later session. Fixture and feature text in this unit still retarget wrap, drop fee approve, and pass `onBehalfOf`

Typegen compile coupling: factory ABI now emits `ReserveMismatch` and `TokenMinterMismatch`. `web/lib/errors.ts` gained catalog rows so `Record<ContractErrorName, ErrorSpec>` typechecks. This is the U7 web compile gate, not extra product work.

`StreamCreate` still has an `approve-fee` presentational stage for inventory. Live `StreamCreateFlow` never enters that stage.

`retiredLendings` is filled at bootstrap. Ticket 15 hydrates those markets on the portfolio. This unit does not render them.

Review: GPT-5.6 Sol reported one plan-deviation — adjust-rate still authorized underlying for a nested supply of ovrfloToken. This chat applied the fix in `web/lib/actions/positions.ts` and the matching live snapshot read. Claim invalidation that still named underlying now names ovrfloToken.
