---
title: Record rejected audit and code-review findings with claim, rationale, and evidence
category: best-practices
module: docs/audit/rejected-findings-record.md
date: 2026-06-27
problem_type: best_practice
component: documentation
severity: low
applies_when:
  - "Completing a code review or audit and deciding which findings to reject"
  - "An external or automated reviewer is likely to re-raise a finding that has already been settled"
  - "Onboarding a new reviewer who needs to know what has already been considered and dismissed"
tags: [audit, code-review, rejected-findings, decision-record, documentation, evidence]
---

# Record rejected audit and code-review findings with claim, rationale, and evidence

## Context

Code reviews and audits produce findings across a severity spectrum. The
project owner accepts some and rejects others, often with reasoning that is
non-obvious: a finding may be dismissed because of a design decision (e.g.,
intentional cross-market fungibility), a trust boundary (e.g., multisig
governs admin functions), or a protocol-specific constraint (e.g., Sablier V2
v1.1 ACL differs from newer docs). Without a persistent record, each new
reviewer or auditor re-derives the same findings, re-investigates the same
edge cases, and re-asks the same questions.

This project maintains `docs/audit/rejected-findings-record.md` as a
persistent decision record. The 2026-06-27 code review added 7 rejected
findings (CR-M1 through CR-I3) to the existing record, each with the
original claim, rejection rationale, and supporting evidence (file paths,
line numbers, design doc references). The record also includes a Q&A bank
of resolved open questions and a table of probed-but-not-exploitable attack
vectors.

## Guidance

For every finding you reject, record:

1. **Original claim** with the severity as raised. Frame it as the reviewer
   framed it, not as you wish it had been framed.
2. **Rejection rationale** in 2-4 sentences. State the design decision, trust
   boundary, or protocol constraint that makes the finding non-applicable.
3. **Evidence** with file paths and line numbers, design doc references, or
   external verification (e.g., "verified against sablier-labs/v2-core tag
   v1.1").
4. **ID** for cross-referencing (e.g., CR-M1, H-2). Future reviewers can
   search for the ID to find the settled conclusion.

Also record:

- **Downgrades** (not just rejections): if a finding is downgraded from High
  to Low, record the downgrade rationale and note that the Low finding
  remains active with a recommended fix.
- **Probed vectors that were not exploitable**: a table of attack vectors
  that were systematically checked and found safe, so a reviewer encountering
  them treats them as closed.
- **Resolved Q&A**: questions an auditor predictably asks in week one, with
  the answers, so they are not re-asked.

Frame every entry as **evidence to challenge**, not a conclusion to accept.
If a reviewer finds new evidence (e.g., a protocol upgrade changes an ACL
model), they should re-raise the finding. The record is the starting point,
not a wall.

## Why This Matters

Without a rejected-findings record, the cost of each successive review grows
linearly: every reviewer re-investigates the same edge cases, re-asks the same
questions, and re-derives the same conclusions. The record collapses that cost
to a lookup. It also prevents a subtle failure mode: a reviewer who re-raises
a settled finding without new evidence wastes the project owner's time
re-explaining the rationale, and a reviewer who accepts a settled finding
without checking the evidence may miss that the rationale depends on
assumptions that could change (e.g., a Sablier version upgrade).

The record is especially valuable for findings whose rejection depends on
protocol-specific details that are easy to get wrong. For example, the H-2
finding (permissionless Sablier withdraw while book holds the NFT) was
rejected because Sablier V2 v1.1 has no public withdraw path, but newer
Sablier docs describe one. An auditor reading the newer docs will re-raise
this as High; the record points them to the v1.1 verification so they can
confirm the distinction before re-raising.

## When to Apply

- After any code review or audit that produces findings, before the findings
  are communicated externally.
- When a finding's rejection depends on a protocol-specific detail, trust
  boundary, or design decision that a future reviewer might not share.
- When onboarding a new reviewer or auditor: point them to the record as the
  starting point, not the codebase from scratch.
- When a protocol dependency upgrades (e.g., Sablier V2 to V4): re-evaluate
  each rejected finding against the new version and update the record.

## Examples

### Rejected finding entry (from the 2026-06-27 code review)

```markdown
### CR-L2 — Infinite approval to Sablier in OVRFLO constructor — REJECTED (intentional, gas optimization)

- **Original claim (Low):** `IERC20(ovrfloToken).approve(address(sablierLL), type(uint256).max)`
  contradicts the "never use infinite approvals" guidance.
- **Rejection rationale:** The approval is to an immutable, trusted Sablier
  address. The vault is the sole minter of ovrfloToken and does not store
  ovrfloToken as a balance. Re-approving per stream would waste gas on every
  deposit for zero security benefit.
- **Evidence:** `src/OVRFLO.sol` constructor —
  `IERC20(ovrfloToken).approve(address(sablierLL), type(uint256).max)`;
  `sablierLL` is `immutable`.
```

### Probed-but-not-exploitable table entry

```markdown
| Flash-loan TWAP manipulation | 15-30 min TWAP window resists single-block
  flash-loan manipulation; cardinality validated at onboarding |
```

### Resolved Q&A entry

```markdown
6. **Flash-loan PT yield extraction pre-maturity?** — Accepted by design.
   Flash-loan PT → deposit → sell stream on book → unwrap → buy PT back is
   yield arbitrage using the protocol as designed. Protocol remains solvent.
```

## Related

- `docs/audit/rejected-findings-record.md` — the project's persistent decision
  record, containing settled findings from the internal review and the
  2026-06-27 code review.
- `x-ray/multi-agent-audit-report.md` — the source audit report whose
  rejected findings are recorded in the decision record.
- [patterns/ovrflo-critical-patterns.md](../patterns/ovrflo-critical-patterns.md)
  — the "Considered and rejected" section (R-01 through R-05) follows the same
  pattern in distilled form.
- ethskills.com audit guidance — "record what you checked and why it's safe"
  is the upstream principle this practice implements.
