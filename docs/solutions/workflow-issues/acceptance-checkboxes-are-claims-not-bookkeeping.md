---
title: Ticking an acceptance checkbox is a claim, not bookkeeping
date: 2026-07-29
category: workflow-issues
module: docs/plans, .scratch issue tracker
problem_type: workflow_issue
component: development_workflow
severity: high
applies_when:
  - Closing out an implementation unit against a plan's acceptance criteria
  - Updating ticket files under .scratch/<feature-slug>/issues/
  - Any agent-driven run where the plan's Definition of Done is the completion signal
tags: [verification, definition-of-done, plans, agent-workflow, false-completion]
---

# Ticking an acceptance checkbox is a claim, not bookkeeping

## Context

During the 2026-07-28 audit-remediation run, acceptance criteria were marked
satisfied twice before they had been earned:

1. **Unit 7** ticked `R21` and `L-10` at the end of the unit. On re-checking,
   `formatTokenAmount` still rounded **half-up** — `0.999999999999999999`
   rendered as `"1.0000"` — and three unit tests were actively pinning that
   behavior as correct. The criterion said "balance displays round down, never
   up." It was false at the moment the box was ticked.
2. **Unit 10** ticked its criteria with a blanket
   `s.replace("- [ ]", "- [x]")` across the ticket file. That swept up two
   `I-3` boxes which had been *explicitly deferred earlier in the same unit*.

Both were caught and corrected in-session, but only because something else
prompted a re-read. Neither was caught by the act of ticking.

## Guidance

**Treat every checkbox flip as an assertion you are willing to defend, and
verify it against the diff immediately before flipping it.**

Two concrete rules:

- **Never bulk-edit checkboxes.** No `sed`, no `replace_all`, no
  `s.replace("- [ ]", "- [x]")`. Edit each box individually, because the
  per-box edit is what forces the per-box read. A batch edit cannot
  distinguish a criterion you met from one you deliberately deferred four
  paragraphs earlier — and it will not tell you it crossed that line.
- **Re-read the criterion's text against the actual change**, not against your
  memory of intending to make it. "Balance displays round down" is checkable in
  seconds by reading the function; the failure mode is not that the check is
  hard, it is that it never gets run.

When a criterion is partially met, say so in the ticket comment and leave the
box unticked. A ticket that reads "3 of 4 criteria met, R21 deferred because…"
is more useful than four ticks and a footnote.

## Why This Matters

The checkbox is the completion signal that everything downstream trusts. A
plan's Definition of Done is assembled from them; a reviewer scanning a
17-ticket set reads the boxes, not the diffs; a future agent picking up the
work treats a ticked box as settled and will not re-derive it.

The root cause is a **framing error**, not carelessness. Checkbox-flipping
arrives at the *end* of a unit, is mechanically trivial, and feels like
clerical cleanup — so it inherits none of the scrutiny applied to the code
change five minutes earlier. But it is the only part of the unit that makes a
truth claim about the whole thing. The scrutiny is inverted relative to the
stakes.

The second failure is a specific and predictable consequence of the first: the
moment box-ticking is framed as clerical, a *bulk* edit looks like the obvious
efficiency. It is the natural next step down the same wrong path, which is why
the two rules above are one lesson rather than two.

## When to Apply

- Closing an implementation unit against plan acceptance criteria
- Updating any ticket file's `- [ ]` list
- Writing a Definition of Done summary that aggregates unit-level status
- Any time the temptation to "tidy up the checkboxes at the end" appears —
  that impulse is the signal, not the solution

## Examples

**What the criterion said (ticket 07):**

```markdown
- [x] Balance/maturity displays round down, never up
```

**What the code did at the moment it was ticked** — `value / divisor` with a
half-up adjustment, so `0.999999999999999999` displayed as `1.0000`.

**What it does now** (`web/lib/format.ts:26`), with the reasoning in the source
so the next reader does not re-round it:

```ts
// R21/M-14: floor, never round half-up. Rounding up overstates what the user
// holds — a 0.999 balance rendering as "1.00" invites them to spend a whole
// unit they do not have and eat the revert. Displaying slightly less than the
// truth is the safe direction for a balance.
const roundedTotal = value / divisor;
```

**The bulk edit that should never have run:**

```python
# Wrong — cannot distinguish "met" from "deliberately deferred"
content = content.replace("- [ ]", "- [x]")
```

## Related

- [Triage, fix, and document audit findings](../best-practices/triage-fix-and-document-audit-findings.md) — the surrounding campaign workflow whose completion signal these boxes feed
- [E2E race fixes should sync tests, not weaken app validation](./e2e-race-fixes-should-sync-tests-not-weaken-app-validation.md) — the adjacent failure mode of making a check pass rather than making the claim true
