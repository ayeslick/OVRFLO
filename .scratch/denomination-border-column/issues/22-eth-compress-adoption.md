# 22 — eth-compress read-only path with plain fallback

**What to build:** If ticket 21 records `evaluate`, install npm `eth-compress@0.4.0` under KD19 and restrict `compress_call` to threshold-passing calls 2 and/or 3. Every transformed call has a same-input, same-block, same-pin plain `eth_call` fallback. Decoded semantic results must match. A call selected for viem-dlc deployless execution cannot also select eth-compress. Factory bootstrap (call 1), authorization, simulation, and wallet writes never enter the transformed path. If materiality fails, uninstall.

**Blocked by:** 21 with an `evaluate` decision

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
If ticket 21 recorded evaluate, re-run the KD19 install-rule checks. Install
only npm eth-compress@0.4.0. STOP if unpublished, if _esm browser files are
missing, or if those files use node: or fs. Do not git-install. Do not
install unpublished 0.5.0. Do not add TypeScript 7. STOP if the production
client bundle includes index.node.js.
Read Required reading below and the plan sections: KD19, sweep rule 13,
### CS6-U2, CS6 Definition of Done, and Verification Contract successor
*Compression isolation*.
ce-work overrides (they win over the skill's defaults): skip ce-code-review.
Branch: work on ticket/22 in this worktree. Do not create another branch or
ask about branches. Commits: plumbing bypass per
.cursor/rules/no-commit-attribution.mdc; never run git commit. Review: dispatch
one read-only reviewer subagent with the slug from spec § Model routing;
reviewers report, this chat decides. No PR, no ce-commit-push-pr, no branding:
push the ticket branch and stop.
After local verification, mark ticket checkboxes done and set Status: resolved.
```

**Required reading:**

- Ticket 21 evidence file
- Plan KD19 and CS6-U2
- this ticket's acceptance criteria

## Acceptance criteria

- [ ] Ticket 21 recorded `evaluate` (otherwise this ticket is cancelled)
- [ ] Installed package is npm `eth-compress@0.4.0` and passes the KD19 artifact checks
- [ ] The production client bundle does not contain `_esm/index.node.js`
- [ ] Each adopted call returns a decoded result equivalent to the plain call at the same block hash
- [ ] All four KD19 materiality conjuncts hold, or the package is uninstalled and the record is `do not adopt`
- [ ] Unsupported state overrides, provider rejection, malformed compressed results, or decode failure use the plain fallback
- [ ] A call selected for viem-dlc deployless execution cannot also select eth-compress
- [ ] Factory/bootstrap (call 1), authorization reads, transaction simulation, and wallet writes never enter the transformed path
- [ ] Calls below the skip threshold remain plain

## Plan unit

CS6-U2 in `docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md`
