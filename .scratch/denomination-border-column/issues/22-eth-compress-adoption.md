# 22 — eth-compress read-only path with plain fallback

**What to build:** If ticket 21 records `adopt`, pin eth-compress and restrict transformation to the benchmarked large read-only lens and multicall classes. Every transformed call has a same-input, same-block, same-pin plain `eth_call` fallback. Decoded semantic results must match. A call selected for viem-dlc deployless execution cannot also select eth-compress. Factory, authorization, simulation, and wallet writes never enter the transformed path.

**Blocked by:** 21 with an `adopt` decision

**Status:** ready-for-agent
**Labels:** ready-for-agent

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md

Scope: CS6-U2 only (= this ticket). Stop when this ticket's acceptance criteria are met.
Ticket: .scratch/denomination-border-column/issues/22-eth-compress-adoption.md
Spec/harness: .scratch/denomination-border-column/spec.md — follow its per-session rules.
Do not edit the plan. Do not start other units.
If ticket 21 recorded do not adopt, set this ticket Status: cancelled and stop.
If ticket 21 recorded adopt, install published npm 0.5.0 only if reviewed
provenance matches; otherwise use the approved Git pin at
f1df09b9cb12b3a4a72019db544bac258ba9f7de after browser-artifact verification.
Read Required reading below and the plan sections: KD19 last two paragraphs,
### CS6-U2, CS6 Definition of Done, and Verification Contract successor
*Compression isolation*.
After local verification, mark ticket checkboxes done and set Status: resolved.
```

**Required reading:**

- Ticket 21 adoption record
- Plan KD19 and CS6-U2
- this ticket's acceptance criteria

## Acceptance criteria

- [ ] Ticket 21 recorded `adopt` (otherwise this ticket is cancelled)
- [ ] Each adopted call returns a decoded result equivalent to the plain call at the same block
- [ ] Unsupported state overrides, provider rejection, malformed compressed results, or decode failure use the plain fallback
- [ ] A call selected for viem-dlc deployless execution cannot also select eth-compress
- [ ] Factory/bootstrap, authorization reads, transaction simulation, and wallet writes never enter the transformed path
- [ ] Calls below the benchmarked class remain plain
- [ ] Post-adoption performance still clears the evidence-backed materiality rule

## Plan unit

CS6-U2 in `docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md`
