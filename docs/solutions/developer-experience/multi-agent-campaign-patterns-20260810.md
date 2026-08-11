---
title: Multi-agent campaign patterns — layered roles, section ownership, and matching depth to the artifact
date: 2026-08-10
category: developer-experience
module: agent orchestration (no code module)
problem_type: developer_experience
component: orchestration
severity: medium
applies_when:
  - Splitting one deliverable across concurrent agents (shared files, shared campaign)
  - Designing a mutation/fuzz campaign that needs both judgment and grinding
  - Choosing reviewer lenses or an agent model for a spawned lane
tags: [orchestration, concurrency, mutation-testing, review-depth, model-selection]
---

# Multi-agent campaign patterns — layered roles, section ownership, and matching depth to the artifact

## Context

Recurring structural choices from the v1-lite buildout that produced clean
merges and clean judgments where naive splits had produced collisions and
noise.

## The patterns

**1. Two-layer campaigns: judge above, runner below.** The U6 mutation campaign
worked because a reviewer agent designed the mutants and judged the results
while a spawned runner executed the run-loop. The judging context stays free of
run noise; the runner needs no judgment. Collapse the layers and the judge
drowns in output before the interesting result arrives.

**2. Concurrent editing needs explicit section ownership plus a clobber guard.**
Ticket 07's two property implementers edited the same `Properties.sol` and
`PROPERTIES.md` concurrently without conflict because their briefs pinned:
(a) exclusive file sections (Global vs Specific, split at a comment marker),
(b) targeted `Edit` calls only — never whole-file `Write`, (c) a fresh `Read`
immediately before every edit, and (d) a coordinator-side snapshot loop copying
the shared files each minute so any clobber would be recoverable. The guard
never fired; it cost one background loop.

**3. Match the agent model to the lane.** Ticket 08 (an exactly-specified
sync sweep with checkable finish lines) ran on a mid-tier model to spec;
ticket 07's property formulation (novel, hard to verify, costly to redo) ran on
the frontier model. The published split — cheap models for spec'd finish lines,
frontier models for novel/hard-to-verify/costly-to-redo — held up in practice.

**4. Match reviewer depth to what the artifact IS.** A test-only commit whose
entire product is the safety net needs the adversarial lens at full strength —
a third security pass over unchanged production code adds nothing, while an
uncheatable-tests audit of the new tests is the whole point (U6's mutation
campaign was exactly this, and it is what caught the dead-ghost class).

**5. Fresh evidence beats relayed status.** Coordinator briefs for resumed or
follow-on agents must restate CURRENT disk state (verified by the coordinator
immediately before spawning), not forward the previous agent's last claim.
Two ticket-07 resumes found the prior status report wrong in both directions.

## Remediation tier (per the 2026-08-10 hierarchy)

Tier 4 (reviewable): brief-template and coordinator-checklist rules. The
section-ownership scheme is arguably tier 1 for the collision class it targets —
it makes same-line conflicts structurally impossible so long as the ownership
split is honored, with the snapshot guard as the tier-3 backstop.

## See also

- `.scratch/lending-v1-lite/issues/09-compound-and-codify.md` — orchestration
  lessons (c), (g).
- `docs/solutions/developer-experience/agent-harness-long-running-work-timeouts-resume-20260810.md`
