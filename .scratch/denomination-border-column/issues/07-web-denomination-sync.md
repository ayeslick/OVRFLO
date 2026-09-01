# 07 — Web denomination sync

**What to build:** Markets supply, borrow, wrap, unwrap, and deposit review match the switched column. Escrow asset branding on the supply path becomes ovrfloToken. Deposit review drops the underlying fee approval. Wrap and unwrap call the reserve. Bootstrap discovers `reserve` from `factory.ovrfloToReserve` next to lending. `borrow` calldata includes `onBehalfOf`. E2E fixtures and seeded-wallet funding update. Permit may stay approve-plus-pull. This ticket does not add `Default` / `Advanced` product work.

**Blocked by:** 05

**Status:** ready-for-agent
**Labels:** ready-for-agent

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
After local verification, mark ticket checkboxes done and set Status: resolved.
```

**Required reading:**

- `docs/maps/SCHEMAS.md` §4
- `docs/solutions/patterns/ovrflo-web-standard.md`
- https://ethskills.com/SKILL.md (frontend-ux / frontend-playbook)
- `docs/agents/testing.md` (before E2E)
- this ticket's acceptance criteria

## Acceptance criteria

- [ ] Scratch intent capsule exists before the first web state-touching edit
- [ ] Bootstrap reads `factory.ovrfloToReserve(vault)` into `VaultInfo.reserve`; no client env reserve variable
- [ ] Bootstrap enumerates `lendings(i)` for `i < lendingCount`, maps each through `lendingToOvrflo`, and fills `VaultInfo.retiredLendings` with markets where `ovrfloToLending[vault] != market` (KD7 web wind-down pin); with no replacement the list is empty and existing behavior is unchanged
- [ ] Supply path branded money is ovrfloToken, not underlying
- [ ] Deposit review requires one PT approval and no underlying fee approval
- [ ] Wrap and unwrap target the discovered reserve; wrap-reserve reads target the reserve
- [ ] `borrow` calldata includes `onBehalfOf`; a self-borrow may pass the user address
- [ ] Maps `docs/maps/ui/assets.md` and `docs/maps/state/keys/chain-reads.md` retarget wrap-reserve to the reserve
- [ ] `npm --prefix web run test` green; production build green; existing E2E suite green against a seeded fork (or environment gate recorded)

## Plan unit

CS1 U7 in `docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md`
