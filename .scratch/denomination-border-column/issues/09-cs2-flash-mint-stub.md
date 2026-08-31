# 09 — CS2 stub: ERC-3156 flash mint in OVRFLOReserve

**What to build:** After a separate swept CS2 plan exists, `OVRFLOReserve` offers ERC-3156 flash mint of ovrfloToken. Fee launches at zero under a hardcoded single-digit-bps ceiling. Owner sets a supply cap under a hardcoded ceiling. Cap check, repay-and-burn check, per-function reentrancy guard, and supply-conservation FREI-PI all hold. The vault has no flash lock. Wrap and unwrap never touch the flash-mint path.

**This file is a stub.** Do not implement CS2 from the denomination plan. KD14 is inheritance for the later plan. Calibration numbers are open.

**Blocked by:** 08

**Status:** needs-info
**Labels:** needs-info

## Session prompt (paste into a new chat)

```text
STOP. This ticket is a stub. Do not implement flash mint from
docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md.

CS2 needs its own plan and sweep. Constants calibration is an explicit open
item (fee ceiling single-digit bps; supply cap a low multiple of circulating
supply and deepest pool depth, timelock-raised).

When a swept CS2 plan exists:
1. Point this ticket's Plan unit at that plan.
2. Replace this session prompt and acceptance criteria from that plan.
3. Set Status: ready-for-agent.
4. Then claim in a new chat.

Until then leave Status: needs-info. Do not write Solidity.
```

**Required reading:**

- Plan KD8 flash-mint FREI-PI bullet and KD14 CS2 paragraph
- this ticket's acceptance criteria (not executable until the CS2 plan exists)

## Acceptance criteria

- [ ] A swept CS2 plan exists and this ticket points at it
- [ ] `OVRFLOReserve` implements ERC-3156 `maxFlashLoan` / `flashFee` / `flashLoan` of ovrfloToken
- [ ] Fee ceiling is hardcoded single-digit bps; launch fee is zero with an owner setter
- [ ] Supply cap has a hardcoded ceiling and an owner setter
- [ ] Cap check, repay-and-burn check, per-function reentrancy guard, and `totalSupply` after equals `totalSupply` before all hold
- [ ] Wrap and unwrap share no path with flash mint
- [ ] No vault-wide flash lock is added

## Plan unit

CS2 in `docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md` — placeholder only. Replace with the swept CS2 plan before implementation.
