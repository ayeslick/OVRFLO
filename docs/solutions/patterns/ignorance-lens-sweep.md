---
module: planning
tags: [planning, review, unknown-unknowns, process]
problem_type: process_gap
---

# The ignorance-lens sweep — mandatory before any plan is declared build-ready

**The rule:** *assume the implementer doesn't understand X; ask what the plan does not address but should; rotate X until dry.* Run this on every implementation-ready plan before implementation begins. It is not optional polish — on its first run (2026-08-11, the watch-surface frontend plan) it found ~60 verified traps in a plan that had already passed a seven-persona document review, and it corrected four of its own earlier fixes.

## Why it exists

Plans converge when review passes green — but every conventional research lane and review persona points at documents, repos, and incidents. The dark quadrants live where nobody's job description points: the browser as an adversary, the fixture environment's infidelity to mainnet, the deployment changing under a week-old tab, the font pipeline silently dropping the axis a design depends on. A reviewer asked "is this plan coherent?" cannot find what a reviewer asked "assume the implementer knows nothing about reorgs — what bites?" finds immediately.

## Procedure

1. **Pick lenses.** Each lens is one domain the implementer is *assumed ignorant of*. Start from the catalog below; derive new ones from the plan's own dependencies (every runtime, library, protocol, pipeline, and environment the plan touches is a candidate lens).
2. **One agent per lens, in parallel.** Each prompt: read the plan (and the relevant source/repo/docs — *verify, never speculate*); assume the implementer does not understand `<X>`; list what the plan does not address but should; **exclude everything the plan already covers** (name the covered items in the prompt); report only items that would actually bite this build; cap ~6-8, ranked.
3. **Per-finding shape:** the trap · why it is invisible from the implementer's seat · the user-visible consequence · a one-line defusal. Findings without verified evidence (source line, doc, binary inspection) are discarded.
4. **Fold in immediately, at two levels:** point-fix any plan text a finding proves *wrong* (resolve in place, never stack strata), and append the rest as rule groups in a `### Sweep Contracts` section of the Planning Contract — each rule one line, tagged with its owning unit, declared review-blocking.
5. **Run a completeness critic** after each round: it names the lenses still missing (ranked by expected yield), runs the top one itself, and renders the diminishing-returns verdict.
6. **Stop** when the critic says the remaining lenses overlap existing coverage, or a round comes back mostly dry. Record the un-run lenses in the plan or the sweep notes so the next session can pick them up.

## Lens catalog (from the first run; extend per plan)

Run: browser-runtime pathology (timers/throttling, bigint arithmetic, dPR/canvas, multi-tab, StrictMode) · protocol/contract economic edge states · UI-framework + data-library internals at pinned versions · build/export mode constraints · testing time-derived and canvas UI · screen-reader narrative + locale/i18n · production incidents (supply chain, DNS, drainers) · fixture/fork fidelity to mainnet · reorg/finality semantics · long sessions + deploy skew.

Named but not yet run: checkpoint-grammar state-machine cross-product · build reproducibility · error-boundary recovery UX · timezone/DST presentation.

## Yield evidence (2026-08-11)

Round 1: five lenses, 32 hits (6.4/lens). Round 2: three lenses, 18 hits (6.0/lens). Final half-round: two lenses, 10 hits (5.0/lens). The curve barely bent — stop on critic judgment about remaining-lens overlap, not on gut feeling that the plan "seems done." Notable classes caught: later lenses corrected earlier fixes (sale-copy trigger, eligibility-mirror split, checkpoint max-merge, chainId keying); the plan's paraphrase of working code nearly deleted an existing reorg defense; a test-accountability ledger entry named units that did not contain the scenario.

## Two authorship rules this sweep exposed (binding beyond the sweep)

- **Never paraphrase working code into a plan — cite its contract.** "Carries over the chunked scanner" plus a looser restatement ("last-scanned-block checkpoint") silently dropped the `(number, hash)` reorg identity the scanner actually implements. A plan sentence describing existing code either quotes the code's contract with a `file:line` anchor or points at it without restating; a paraphrase is where defenses go to die.
- **A test-accountability entry names the successor scenario, not a unit.** "Covered now by: U6 / U14" passed every presence check while neither unit contained the behavior. The entry must name the specific scenario (and the sweep that closes a plan verifies the scenario exists where the entry points).

## Cost calibration

~10 lens-agents plus a critic per plan, each a bounded read-and-verify pass. Against the cost of any one of these classes reaching production in a financial UI, the sweep is cheap. Scale lens count to plan size: a Lightweight plan may need two lenses; a Deep client-heavy plan earned ten.
