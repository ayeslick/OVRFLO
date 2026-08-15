---
module: planning
tags: [planning, review, unknown-unknowns, decision-sufficiency, process]
problem_type: process_gap
---

# The ignorance-lens sweep — mandatory before any plan is declared build-ready

**The rule:** *walk the plan as the implementer will; find every decision it leaves underdetermined;
ask whether two competent onboarded agents would decide the same way; rotate lenses until dry.*

Run this on every implementation-ready plan before implementation begins. A plan that has not been
swept is not build-ready, regardless of review verdicts.

The file keeps its name so existing references stay valid. The "ignorance" is the **plan's**
ignorance of what the implementer will face — not the implementer's ignorance of the codebase.

## Who the implementer is

Assume an onboarded AI agent. It has read `AGENTS.md`, `docs/agents/onboarding.md`,
`ovrflo-critical-patterns.md`, `ovrflo-coding-standard.md`, and `ovrflo-style-guide.md`. It can read
the code and will verify claims rather than assume them. It is competent.

It is **not** clairvoyant, and it does not share the planner's session. It cannot recover a decision
that was argued and settled in a conversation the plan does not record. When the plan is silent, it
decides — and the decision is invisible in the diff, because a reasonable choice looks exactly like
an instructed one.

The facts on the ground will differ from the plan in places. That is normal and expected. The plan's
job is not to predict every difference. Its job is to make the implementer's response to a
difference predictable.

## The threshold

A plan is decision-sufficient when, for **every** decision the implementer must make, at least one
of these holds:

1. **The plan states the decision.**
2. **A standing rule states it** — the coding standard, style guide, critical patterns, or
   `AGENTS.md`. The plan does not need to restate it.
3. **The reasonable choices are interchangeable** — same behavior, same cost, same reversibility.
   Naming, file placement inside an established convention, ordering of independent steps.
4. **The plan states a rule for deciding**, including when to stop and ask rather than proceed.

If none holds, that is a finding.

**Over-specification is also a finding.** A plan that spells out a decision covered by (2) or (3)
adds length, buries the decisions that actually matter, and goes stale when the standard moves. Flag
it and cut it.

### Decisions that must be in the plan

- Irreversible or expensive to undo. Deployed bytecode, storage layout, an external ABI, a published
  interface.
- Changes what another system reads. Anything the frontend, another contract, or a script consumes.
- Materially different outcomes from reasonable alternatives — behavior, gas, risk, or blast radius.
- Already litigated. A choice argued and settled during planning must be recorded **with its
  reasoning**, or the implementer re-opens it and may land on the rejected side. Record the rejected
  option too, and why it lost.
- The plan's premise could be false. If the plan assumes a file, function, or behavior exists, and it
  might not, say what to do when it does not.

### Decisions to leave alone

Variable and function names. Which test file a case lands in. The order of independent steps. Helper
extraction. Anything `ovrflo-style-guide.md` already decides. Specifying these is noise.

## Procedure

1. **Pick lenses.** Two families, both needed.

   **Decision lenses** walk the plan as the implementer and stop at each point where a choice is
   implied. One lens per unit of work, or per section for a small plan.

   **Reality lenses** come from the plan's own dependencies — every runtime, library, protocol,
   pipeline, and environment it touches. Each asks: *what fact on the ground would contradict this
   plan, and does the plan say what to do when the implementer finds it?* The catalog below seeds
   them.

2. **One agent per lens, in parallel.** Each prompt: read the plan and the relevant source —
   *verify, never speculate*. Assume the implementer is onboarded and competent. Find decisions the
   plan leaves underdetermined, and decisions it over-specifies. **Exclude everything the plan
   already covers**; name the covered items in the prompt. Report only items that would change the
   built result. Cap at 6–8, ranked.

3. **Per-finding shape.** The decision point · how two competent onboarded agents would diverge ·
   what that difference costs · the sentence that closes it. A finding that cannot name a divergence
   is not a finding. Findings without verified evidence — `file:line`, doc, or binary inspection —
   are discarded.

4. **Fold in immediately, at two levels.** Point-fix any plan text a finding proves *wrong* — resolve
   in place, never stack strata. Append the rest as rule groups in a `### Sweep Contracts` section,
   each rule one line, tagged with its owning unit, declared review-blocking.

5. **Run a completeness critic** after each round. It names the lenses still missing, ranked by
   expected yield, runs the top one itself, and renders the diminishing-returns verdict.

6. **Stop** when the critic says the remaining lenses overlap existing coverage, or a round comes back
   mostly dry. Record the un-run lenses so the next session can pick them up.

## Escalation triggers are part of the plan

A plan cannot enumerate every way reality will differ. It can name the differences that must stop the
work rather than be absorbed by a judgment call.

Write these as explicit branches:

> If `X` is already true, do `Y`. If it is not, stop and report — do not adapt.

The trigger belongs in the plan wherever the plan asserts a fact the implementer cannot verify until
they are in the code. Without it, the implementer adapts silently, and the deviation surfaces only if
someone diffs intent against outcome.

This pairs with the binding rule in `AGENTS.md`: log every deviation from the active plan and why. A
logged deviation against a plan with no escalation triggers still tells you what changed, but not
whether the change was sanctioned.

## Lens catalog (extend per plan)

Reality lenses run so far: browser-runtime pathology (timers/throttling, bigint arithmetic,
dPR/canvas, multi-tab, StrictMode) · protocol/contract economic edge states · UI-framework and
data-library internals at pinned versions · build/export mode constraints · testing time-derived and
canvas UI · screen-reader narrative and locale/i18n · production incidents (supply chain, DNS,
drainers) · fixture/fork fidelity to mainnet · reorg/finality semantics · long sessions and deploy
skew.

Named but not yet run: checkpoint-grammar state-machine cross-product · build reproducibility ·
error-boundary recovery UX · timezone/DST presentation.

Decision lenses to run on every plan: storage/interface irreversibility · what the frontend or
another contract reads · the rejected-alternatives record · premise verification (does every file,
function, and behavior the plan names still exist?) · test-accountability scenarios.

## Yield evidence (2026-08-11, under the earlier framing)

Round 1: five lenses, 32 hits (6.4/lens). Round 2: three lenses, 18 hits (6.0/lens). Final half-round:
two lenses, 10 hits (5.0/lens). The curve barely bent — stop on critic judgment about remaining-lens
overlap, not on a feeling that the plan "seems done."

Notable classes caught: later lenses corrected earlier fixes (sale-copy trigger, eligibility-mirror
split, checkpoint max-merge, chainId keying); the plan's paraphrase of working code nearly deleted an
existing reorg defense; a test-accountability entry named units that did not contain the scenario.

Those three classes are all decision-sufficiency failures in retrospect, which is why the framing
changed: each one was a place where the plan let a competent implementer land somewhere the planner
did not intend.

## Two authorship rules this sweep exposed (binding beyond the sweep)

- **Never paraphrase working code into a plan — cite its contract.** "Carries over the chunked
  scanner" plus a looser restatement ("last-scanned-block checkpoint") silently dropped the
  `(number, hash)` reorg identity the scanner actually implements. A plan sentence describing
  existing code either quotes the code's contract with a `file:line` anchor or points at it without
  restating. A paraphrase is where defenses go to die.
- **A test-accountability entry names the successor scenario, not a unit.** "Covered now by: U6 /
  U14" passed every presence check while neither unit contained the behavior. The entry must name the
  specific scenario, and the sweep that closes a plan verifies the scenario exists where the entry
  points.

## Cost calibration

Roughly 10 lens-agents plus a critic per plan, each a bounded read-and-verify pass. Against the cost
of any one of these classes reaching production in a financial UI, the sweep is cheap. Scale lens
count to plan size: a lightweight plan may need two lenses; a deep client-heavy plan earned ten.
