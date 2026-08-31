# 21 — eth-compress benchmark and adopt gate

**What to build:** A reviewed evidence record that says `adopt` or `do not adopt` for read-only eth-compress. Measure passive request transport first on representative large lens and multicall calls. Record request-body wire bytes, request latency, and provider acceptance. Record response compression separately and never count it as adoption evidence. Write the user-facing or provider-cost objective and the minimum material improvement before evaluating state overrides. Non-adoption is a valid close.

**Blocked by:** 12, 14

**Status:** ready-for-agent
**Labels:** ready-for-agent

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md

Scope: CS6-U1 only (= this ticket). Stop when this ticket's acceptance criteria are met.
Ticket: .scratch/denomination-border-column/issues/21-eth-compress-benchmark.md
Spec/harness: .scratch/denomination-border-column/spec.md — follow its per-session rules.
Do not edit the plan. Do not start other units. Do not add the runtime dependency
in this ticket. Do not invent a percentage threshold.
Before any dependency work, npm 0.5.0 must be published OR reviewers must
explicitly approve Git commit f1df09b9cb12b3a4a72019db544bac258ba9f7de and
verify built browser artifacts. Plain-transport measurement may proceed before
that gate. If the publication/Git gate is open, record the baseline, then STOP
before installing eth-compress.
Read Required reading below and the plan sections: KD19, AS8, ### CS6-U1,
CS6 stop conditions, and Verification Contract successor *Compression isolation*.
After local verification, mark ticket checkboxes done and set Status: resolved
with an explicit adopt or do not adopt record. If do not adopt, mark ticket 22
cancelled.
```

**Required reading:**

- Plan KD19 and CS6-U1
- this ticket's acceptance criteria

## Acceptance criteria

- [ ] Benchmark records request-body wire bytes, request latency, and provider acceptance separately from response compression and any state-override result
- [ ] Representative calls include large portfolio/lens and multicall reads
- [ ] Runs record provider and cache conditions so a favorable warm-cache result cannot masquerade as compression benefit
- [ ] The measured objective and minimum material improvement are written before any state-override evaluation
- [ ] Missing baseline, unstable results, or no reviewer-approved materiality rule produces a stop decision rather than a silent adopt
- [ ] A reviewed record states `adopt` or `do not adopt` with the evidence
- [ ] On `do not adopt`, no eth-compress runtime code or dependency remains; ticket 22 is cancelled
- [ ] Publication or approved Git pin plus verified browser artifacts is recorded before any install attempt

## Plan unit

CS6-U1 in `docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md`
