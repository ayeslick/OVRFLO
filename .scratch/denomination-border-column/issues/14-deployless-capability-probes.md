# 14 — Deployless capability probes

**What to build:** Deployless lenses run only on providers that pass a real probe. The hash-pin probe stays. A second provider-and-lens-keyed probe calls real viem-dlc `policy(...)` with state override. Unsupported or ambiguous responses use the same-pin plain read. Wallet prompts reacquire a fresh connected-wallet client and revalidate independently of the public-read cache. viem-dlc never transforms or retries a write.

**Blocked by:** 12 (parallel with 13)

**Status:** ready-for-agent
**Labels:** ready-for-agent

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md

Scope: CS5-U3 only (= this ticket). Stop when this ticket's acceptance criteria are met.
Ticket: .scratch/denomination-border-column/issues/14-deployless-capability-probes.md
Spec/harness: .scratch/denomination-border-column/spec.md — follow its per-session rules.
Do not edit the plan. Do not start other units. 13 runs in parallel — do not rewrite
the discovery owner. Do not combine eth-compress with deployless code (21/22).
Before any code, read Required reading below and the plan sections: KD18 probe
bullets, AS7, ### CS5-U3, and CS5 Definition of Done.
Cache capability, not returned chain authority. A provider may pass the hash-pin
probe and fail one lens policy probe; only that provider/lens pair is disabled.
ce-work overrides (they win over the skill's defaults): skip ce-code-review.
Branch: work on ticket/14 in this worktree. Do not create another branch or
ask about branches. Commits: plumbing bypass per
.cursor/rules/no-commit-attribution.mdc; never run git commit. Review: dispatch
one read-only reviewer subagent with the slug from spec § Model routing;
reviewers report, this chat decides. No PR, no ce-commit-push-pr, no branding:
push the ticket branch and stop.
After local verification, mark ticket checkboxes done and set Status: resolved.
```

**Required reading:**

- `docs/solutions/patterns/ovrflo-web-standard.md`
- this ticket's acceptance criteria

## Acceptance criteria

- [ ] A provider that claims compatibility but rejects the real probe is capability-gated off
- [ ] Support for one deployless lens does not enable a different lens on the same provider
- [ ] Probe timeout or malformed response falls back to plain reads
- [ ] A mid-session capability change recovers reads without changing write semantics
- [ ] A wallet account or chain change after a public read makes the new wallet client and fresh authoritative state govern the prompt
- [ ] Hash-pin success plus one failed `policy(...)` state-override probe disables only that provider/lens pair
- [ ] Pin-probe and write-flow tests prove the public-read / write boundary

## Plan unit

CS5-U3 in `docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md`
