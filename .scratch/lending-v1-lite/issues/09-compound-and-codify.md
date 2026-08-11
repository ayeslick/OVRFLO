# 09 — Compound the buildout: solution writeups, coding standard, style guide

**What to build:** Harvest every lesson, deviation, and recorded decision from the v1-lite buildout into durable knowledge, then distill it into two decision-eliminating documents. The distillation draws on TWO source pools — internal (the buildout trail) and external (idiomatic Solidity / industry standards) — merged with judgment, not concatenated. Three layers:

1. **Solution writeups** (`docs/solutions/`, repo conventions: category dirs + YAML frontmatter). One writeup per genuinely reusable lesson from tickets 01–08 — sourced from the plan's dated decision notes, the per-ticket review-roster findings, and builder-surfaced judgment calls. **Orchestration lessons are in scope too (user directive, 2026-08-10)** — the multi-agent process knowledge belongs in `developer-experience/` so future buildouts inherit it: (a) Bash tool calls die at the default 120s timeout — any run over ~2 minutes needs `timeout: 600000` or `run_in_background` (the U6 mutation campaign lost its first hour to this); (b) detached script runs are invisible to the harness — agents "wait" by ending turns and need a coordinator alarm-clock (background timer → check → resume); (c) the two-layer campaign pattern: a reviewer agent designs mutants and judges results while a spawned runner executes the run-loop — keeps the judging context clean of run noise; (d) verify capability claims empirically before ruling them out — "subagents can't spawn subagents" was a misdiagnosis of a process death and briefly warped orchestration; (e) resume-from-transcript is lossless across process restarts — never restart an agent that can be resumed; user-stopped agents are cancelled and cannot be; (f) agents in a shared checkout commit by explicit path only, never `git add -A` (the U4 commit collision); (g) match reviewer depth to what the artifact IS — a test-only commit whose product is the safety net needs the adversarial lens at full strength more than a third security pass. Known candidates as of ticket 03 (later tickets will add more): the grossPrice-cap forcing chain (how a closed error catalog + a documented call-site precondition jointly force an implementation choice); the packed-slot `vm.load` + `forge inspect` verification technique; the discriminating-boundary test pattern (net-fee floor, `UNIT-1` flooring — a test at the wrong distance from a boundary proves nothing); ERC-721-ownership-as-guard (deleting `StreamAlreadyPledged`: when an external contract's own checks make an on-chain guard structurally redundant); the checked-narrowing-vs-partial-fill trap (`_toUnits` on max targets); frozen-history/monotone-counter as a safety argument style.
2. **Coding standard** (`docs/solutions/patterns/ovrflo-coding-standard.md`): the enforceable rules a model must follow writing OVRFLO Solidity — error/event conventions (custom errors from a closed catalog, absolute-checkpoint events, full-field emit tests), types and narrowing (SafeCast routing, unit boundaries), storage packing discipline, reentrancy/FREI-PI ordering, external-integration rules (plain `transferFrom` for Sablier, StreamPricing never re-derived), test-integrity requirements (uncheatable tests, exact-selector expectRevert, plan-derived literals). Every rule cites the writeup or review finding it came from.
3. **Style guide** (`docs/solutions/patterns/ovrflo-style-guide.md`): the softer conventions that remove micro-decisions — naming (`test_Fn_Behavior`, no `l`/`O`/`I` adjacent to digits, OVRFLO never OVFL), file/section layout, NatSpec voice and required tags, comment discipline (constraints only, no narration), fixture conventions (the 73-day/1.02 exact-arithmetic pattern).

Both documents get wired into `AGENTS.md` required reading so every future session inherits them. Rules must be deduplicated against `ovrflo-critical-patterns.md` — reference, never restate; where a critical pattern was superseded by v1-lite, the standard records the successor rule.

**Critical-patterns freshness audit (user directive, 2026-08-08).** ALL patterns in `ovrflo-critical-patterns.md` — not just the ones tickets already flagged (#4/#10/#16 superseded, #12–#15 stale greps) — get re-validated one by one against the rebuilt codebase. Each pattern ends the audit in exactly one state: **enforced** (cite the current code line and the test that regression-guards it), **superseded** (annotated with the v1-lite successor rule and the plan decision that retired it), or **stale** (detection grep, cited line, or rationale refreshed to match the rewrite). A pattern nobody can place in one of those states is itself a finding — it means the rule was aspirational, and it either gets an enforcing test or gets demoted out of the critical list. Any other `docs/solutions/` writeup found stale in passing gets flagged the same way (ce-compound-refresh spirit), but the exhaustive sweep is scoped to the critical patterns.

**Remediation hierarchy (user directive, 2026-08-10).** Less "write tests to catch the next time that error happens," more "make that class of error impossible with a better design." When harvesting a lesson, place its remedy on the strongest achievable tier and record the tier: (1) **unrepresentable** — the design excludes the error class (type/unit boundaries, API shape, state-machine restriction, or REMOVING the footgun: the `StreamAlreadyPledged` deletion and the harness's etch-over-code ban are the house examples); (2) **unmissable** — getting it wrong fails to compile or hits a closed catalog; (3) **detected** — invariant/test/mutation coverage; (4) **reviewable** — grep + checklist. A tier-3/4 rule must state why tier 1–2 wasn't available or wasn't worth it. Tests remain for what design cannot exclude — and as evidence that a tier-1 guarantee actually holds (the gas-flatness pair is evidence of blind-fill's design guarantee, not a patch guard). Guardrail: in this codebase, tier-1 means removing or narrowing, not adding defensive abstraction — the minimality ladder and "no redundant on-chain checks" preferences still govern.

**Plan-gap harvest (user directive, 2026-08-10).** The buildout trail is also evidence about the PLAN's quality, not just the code's. Collect every instance where an executing agent could not simply follow the plan because of the plan itself — an ambiguity that forced interpretation, a contradiction between sections, a decision the plan claimed to pin but didn't, a spec'd item that proved unimplementable as written (e.g. a property whose sound form differs from its spec'd form), a stale factual claim carried into a ticket, or a contingency the plan lacked (capability assumptions about the executing session). Sources: builder reports' "surfaced rather than decided" items, ticket-file correction commits, deviations recorded in review findings, and coordinator interventions that supplied missing decisions mid-flight. Each gap gets classified — ambiguity / contradiction / unpinned decision / wrong assumption / missing contingency — and feeds a writeup that updates the plan-authoring standard, so the NEXT plan makes that gap class impossible to write (the remediation hierarchy applies to plans too: prefer plan-template changes that make the gap unrepresentable over review-checklist items that merely catch it).

**External research mandate (user directive, 2026-08-08).** Before distilling, research idiomatic Solidity and industry practice: ETHSKILLS (the security/testing/concepts skills likely carry relevant material), the official Solidity style guide, OpenZeppelin conventions, audit-firm published standards (Trail of Bits, ConsenSys Diligence secure-contracts), and Foundry-ecosystem best practices. Adoption filter, in the user's terms: industry standard is welcome so long as it does not adversely impact the codebase, degrade readability, or degrade maintainability — and "just because it's good doesn't mean it's good for this protocol." Deep research, strong synthesis, careful analysis, sound judgment on what belongs. Where an industry convention conflicts with an established OVRFLO convention, present the conflict to the user rather than silently picking. **Blast radius is not a veto:** do not negate a change merely because adopting it touches a lot of code — cost it honestly and let the merits decide (user is explicitly not scared of high-blast-radius changes).

**Executor note:** this ticket is NOT a fresh-chat cheap-model ticket. It is executed by the coordinator (orchestrator session), which holds the full review history and decision trail, consulting the user where a rule's generality is uncertain. The value of the documents is exactly the coordinator's cross-ticket insight.

**Blocked by:** 08

**Status:** resolved — user sign-off received 2026-08-10 (four surfaced decisions answered: house order kept, custom-error migration executed in fdebe97, ticks renamed, no Slither); all criteria met, harvest record below.
**Labels:** ready-for-human

## Acceptance criteria

- [x] Every dated decision note in the plan (2026-08-08 series and any later) has either a solution writeup or an explicit "not generalizable" note
- [x] Every review-roster finding that changed code or docs across tickets 01–08 is traceable into a writeup, the standard, or the style guide
- [x] External research performed and cited: ETHSKILLS material, Solidity style guide, OZ conventions, at least two audit-firm standards — each adopted, adapted, or rejected with a stated reason tied to the codebase-impact/readability/maintainability filter
- [x] No rule rejected solely for blast radius; any high-blast-radius adoption carries an honest cost estimate and its merits case
- [x] `ovrflo-coding-standard.md` exists; every rule cites its source (internal writeup/finding or external standard); no rule restates `ovrflo-critical-patterns.md` (references only)
- [x] `ovrflo-style-guide.md` exists; naming/layout/NatSpec/test conventions each carry one concrete example from the shipped code
- [x] Every critical pattern in `ovrflo-critical-patterns.md` audited to exactly one state — enforced (code line + guarding test cited), superseded (successor rule + retiring decision cited), or stale-now-refreshed; none left unplaced; aspirational rules get an enforcing test or are demoted with rationale
- [x] NEW patterns from this buildout promoted into `ovrflo-critical-patterns.md` as numbered continuations, each with a detection grep and citation — candidates banked so far: closed-catalog error governance (errors amended only by dated user decision, never invented locally); uncheatable-test requirements (plan-derived literals, discriminating boundaries, mutation kills); the frozen-history/monotone-counter safety-argument style; shared-checkout commit discipline for agents (scoped `git add` only, never `-A` — the U4 collision); log-completeness for owner-mutable parameters (the feeAmount rule)
- [x] Every writeup and every rule in the standard states its remediation tier per the 2026-08-10 hierarchy directive; tier-3/4 entries state why a stronger tier wasn't achievable or wasn't worth it
- [x] Plan-gap harvest complete per the 2026-08-10 directive: every could-not-follow-the-plan instance across tickets 01–08 classified (ambiguity / contradiction / unpinned decision / wrong assumption / missing contingency) and traced into a plan-authoring-standard update; an empty harvest requires an explicit "none found" attestation per ticket, not silence
- [x] `AGENTS.md` reading list references both documents
- [x] `MEMORY.md`/memory updated where a lesson is user-preference rather than repo fact
- [x] User has reviewed both documents (this ticket's definition of done includes user sign-off)

## Plan unit

None — post-plan compounding pass over the whole buildout.

## Harvest record (2026-08-10, coordinator)

Dated-decision-note dispositions (criterion 1). Writeup keys: [EEG]=error-event-catalog-governance-20260808, [CNP]=checked-narrowing-vs-partial-fill-sentinel-20260808, [E7G]=erc721-ownership-as-guard-20260808, [FHM]=frozen-history-monotone-counter-safety-argument-20260810, [UTD]=uncheatable-test-discipline-20260810, [PSV]=packed-slot-vm-load-verification-20260808, [PGL]=plan-gap-ledger-v1-lite-20260810, [ORCH]=the three developer-experience orchestration writeups, [EFG]=environment-fidelity-mainnet-rules-gates-20260810, [MEB]=medusa-etch-over-existing-code-20260810.

| Dated note | Disposition |
|---|---|
| 2026-08-05 doc-review preservation note (R7/R9/R2/R18/AE3/AE8) | Not generalizable per item; the process lesson (doc review pre-code) → [PGL] |
| 2026-08-05 try/catch-on-internal-library unimplementable | [PGL] rule 1 |
| 2026-08-08 single-source-constants carve-out | Not generalizable (protocol constant convention); recorded in coding standard S2 |
| 2026-08-08 types/units inline-floor exception | [CNP] |
| 2026-08-08 permissionless repay | Not generalizable as a rule; the "state why permissionless is safe" form → standard X5 |
| 2026-08-08 NotCovered selector split | [EEG] rule 1 |
| 2026-08-08 uniform closure events | [EEG] rule 4 |
| 2026-08-08 min(withdrawable,outstanding) named security invariant | [UTD] rule 5 example; style guide §3 (named invariants) |
| 2026-08-08 reverting-vs-filtering helper split | Not generalizable beyond the pair; noted in standard V1 context |
| 2026-08-08 KTD8 views reassignment | Not generalizable (ticket bookkeeping) |
| 2026-08-08 outstanding==0 && !closed legal state | Standard S3 |
| 2026-08-08 PositionMissing mint / ZeroSteps reversal | [EEG] rule 3 |
| 2026-08-08 tickState validates spacing only | Not generalizable (deliberate under-validation, documented in code) |
| 2026-08-08 rollover predicate forced form | [PGL] rule 3; [FHM] transitions rule |
| 2026-08-08 ladder-view spacing sanity | Standard V2 |
| 2026-08-08 BelowMinimum deliberate sharing | [EEG] rule 1 (semantic-class test) |
| 2026-08-08 Borrowed.feeAmount log-completeness | [EEG] rule 4; CP#25 |
| 2026-08-08 StreamAlreadyPledged deletion | [E7G]; CP reference in standard X2 |
| 2026-08-08 U3 same-height gas pairs insufficient | [FHM]; [PGL] rule 8 |
| 2026-08-10 non-aligned grossPrice strict-inequality fixture | [UTD] rule 1 |
| 2026-08-10 invariant-profile claim correction | Not generalizable beyond "sync docs to foundry.toml"; [PGL] class table |

Review-findings traceability (criterion 2): U3 batch → [UTD] rules 1, [CNP], [PSV]; U4 batch → [EEG], standard S3/X5, [UTD] rule 5; U5 batch → [EEG] rule 3, standard V2, [PGL] rules 3; U6 batch → [UTD] rules 2–5, [PGL] rules 4–5; U7 → [MEB], [PGL] rule 6 (SP-26); U8 → [EFG], [ORCH] (trust boundaries), [PGL] rules 7 and 2. Tickets 01/02: no review findings existed (attested in [PGL]).

External research (criterion 3): all four required categories + two audit firms, dispositions in the coding standard's rule citations and its Considered-and-rejected / Pending-user-decisions registers.

Critical-patterns audit (criterion 7): all 25 patterns placed — none unplaceable; refreshes applied 2026-08-10 to #3, #5, #6, #7, #11, #17, #18/#19 grep scope; #4/#10/#16 superseded annotations verified; new #21–25 promoted with greps (criterion 8).
