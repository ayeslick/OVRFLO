# 21 — eth-compress benchmark and evaluate gate

**What to build:** An evidence file that says `evaluate` or `do not adopt` for read-only eth-compress. Measure plain JSON-RPC POST bodies on the three named representative calls. Install nothing. Record request-body wire bytes, request latency, and provider success class. Record response compression separately and never count it as adoption evidence. Non-adoption is a valid close.

**Blocked by:** 12, 14, owner start-OK

**Status:** ready-for-agent
**Labels:** ready-for-agent

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md

Scope: CS6-U1 only (= this ticket). Stop when this ticket's acceptance criteria are met.
Ticket: .scratch/denomination-border-column/issues/21-eth-compress-benchmark.md
Spec/harness: .scratch/denomination-border-column/spec.md — follow its per-session rules.
Do not edit the plan. Do not start other units. Do not add eth-compress to
web/package.json. Do not git-install. Do not invent a
percentage threshold. Do not send stateDiff or compress_call.
STOP if the owner has not recorded start-OK on this ticket. Pins are KD19.
Do not re-research pins.
Read Required reading below and the plan sections: KD19, AS8, sweep rule 13,
### CS6-U1, CS6 stop conditions, and Verification Contract successor
*Compression isolation*.
Write evidence to .scratch/denomination-border-column/cs6-eth-compress-evidence.md.
After local verification, mark ticket checkboxes done and set Status: resolved
with evaluate or do not adopt. If do not adopt, mark ticket 22 cancelled.
```

**Required reading:**

- Plan KD19 and CS6-U1
- this ticket's acceptance criteria

## Acceptance criteria

- [ ] Owner recorded start-OK on this ticket before the first code or bench write
- [ ] Evidence file lists the three named KD19 calls, each `rpcUrls` entry from `web/lib/config.ts`, wire bytes, latency, success class, response encoding, and `cache: cold`
- [ ] Call 1 (vault-binding multicall) is measured and marked never-adopt
- [ ] `streamsOfOwnerIn` used `COMPLETE_SET_WINDOW`, not `COMPLETE_SET_UNBOUNDED_MAX`
- [ ] Three cold runs per call per URL; unstable success class or byte-delta sign produced STOP, not `evaluate`
- [ ] Verdict is exactly `evaluate` or `do not adopt` per KD19
- [ ] On `do not adopt`, no eth-compress runtime code or dependency remains; ticket 22 is cancelled
- [ ] `web/package.json` has no `eth-compress` entry

## Plan unit

CS6-U1 in `docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md`
