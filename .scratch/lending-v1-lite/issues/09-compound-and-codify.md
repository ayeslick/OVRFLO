# 09 — Compound the buildout: solution writeups, coding standard, style guide

**What to build:** Harvest every lesson, deviation, and recorded decision from the v1-lite buildout into durable knowledge, then distill it into two decision-eliminating documents. The distillation draws on TWO source pools — internal (the buildout trail) and external (idiomatic Solidity / industry standards) — merged with judgment, not concatenated. Three layers:

1. **Solution writeups** (`docs/solutions/`, repo conventions: category dirs + YAML frontmatter). One writeup per genuinely reusable lesson from tickets 01–08 — sourced from the plan's dated decision notes, the per-ticket review-roster findings, and builder-surfaced judgment calls. Known candidates as of ticket 03 (later tickets will add more): the grossPrice-cap forcing chain (how a closed error catalog + a documented call-site precondition jointly force an implementation choice); the packed-slot `vm.load` + `forge inspect` verification technique; the discriminating-boundary test pattern (net-fee floor, `UNIT-1` flooring — a test at the wrong distance from a boundary proves nothing); ERC-721-ownership-as-guard (deleting `StreamAlreadyPledged`: when an external contract's own checks make an on-chain guard structurally redundant); the checked-narrowing-vs-partial-fill trap (`_toUnits` on max targets); frozen-history/monotone-counter as a safety argument style.
2. **Coding standard** (`docs/solutions/patterns/ovrflo-coding-standard.md`): the enforceable rules a model must follow writing OVRFLO Solidity — error/event conventions (custom errors from a closed catalog, absolute-checkpoint events, full-field emit tests), types and narrowing (SafeCast routing, unit boundaries), storage packing discipline, reentrancy/FREI-PI ordering, external-integration rules (plain `transferFrom` for Sablier, StreamPricing never re-derived), test-integrity requirements (uncheatable tests, exact-selector expectRevert, plan-derived literals). Every rule cites the writeup or review finding it came from.
3. **Style guide** (`docs/solutions/patterns/ovrflo-style-guide.md`): the softer conventions that remove micro-decisions — naming (`test_Fn_Behavior`, no `l`/`O`/`I` adjacent to digits, OVRFLO never OVFL), file/section layout, NatSpec voice and required tags, comment discipline (constraints only, no narration), fixture conventions (the 73-day/1.02 exact-arithmetic pattern).

Both documents get wired into `AGENTS.md` required reading so every future session inherits them. Rules must be deduplicated against `ovrflo-critical-patterns.md` — reference, never restate; where a critical pattern was superseded by v1-lite, the standard records the successor rule.

**Critical-patterns freshness audit (user directive, 2026-08-08).** ALL patterns in `ovrflo-critical-patterns.md` — not just the ones tickets already flagged (#4/#10/#16 superseded, #12–#15 stale greps) — get re-validated one by one against the rebuilt codebase. Each pattern ends the audit in exactly one state: **enforced** (cite the current code line and the test that regression-guards it), **superseded** (annotated with the v1-lite successor rule and the plan decision that retired it), or **stale** (detection grep, cited line, or rationale refreshed to match the rewrite). A pattern nobody can place in one of those states is itself a finding — it means the rule was aspirational, and it either gets an enforcing test or gets demoted out of the critical list. Any other `docs/solutions/` writeup found stale in passing gets flagged the same way (ce-compound-refresh spirit), but the exhaustive sweep is scoped to the critical patterns.

**External research mandate (user directive, 2026-08-08).** Before distilling, research idiomatic Solidity and industry practice: ETHSKILLS (the security/testing/concepts skills likely carry relevant material), the official Solidity style guide, OpenZeppelin conventions, audit-firm published standards (Trail of Bits, ConsenSys Diligence secure-contracts), and Foundry-ecosystem best practices. Adoption filter, in the user's terms: industry standard is welcome so long as it does not adversely impact the codebase, degrade readability, or degrade maintainability — and "just because it's good doesn't mean it's good for this protocol." Deep research, strong synthesis, careful analysis, sound judgment on what belongs. Where an industry convention conflicts with an established OVRFLO convention, present the conflict to the user rather than silently picking. **Blast radius is not a veto:** do not negate a change merely because adopting it touches a lot of code — cost it honestly and let the merits decide (user is explicitly not scared of high-blast-radius changes).

**Executor note:** this ticket is NOT a fresh-chat cheap-model ticket. It is executed by the coordinator (orchestrator session), which holds the full review history and decision trail, consulting the user where a rule's generality is uncertain. The value of the documents is exactly the coordinator's cross-ticket insight.

**Blocked by:** 08

**Status:** open
**Labels:** ready-for-human

## Acceptance criteria

- [ ] Every dated decision note in the plan (2026-08-08 series and any later) has either a solution writeup or an explicit "not generalizable" note
- [ ] Every review-roster finding that changed code or docs across tickets 01–08 is traceable into a writeup, the standard, or the style guide
- [ ] External research performed and cited: ETHSKILLS material, Solidity style guide, OZ conventions, at least two audit-firm standards — each adopted, adapted, or rejected with a stated reason tied to the codebase-impact/readability/maintainability filter
- [ ] No rule rejected solely for blast radius; any high-blast-radius adoption carries an honest cost estimate and its merits case
- [ ] `ovrflo-coding-standard.md` exists; every rule cites its source (internal writeup/finding or external standard); no rule restates `ovrflo-critical-patterns.md` (references only)
- [ ] `ovrflo-style-guide.md` exists; naming/layout/NatSpec/test conventions each carry one concrete example from the shipped code
- [ ] Every critical pattern in `ovrflo-critical-patterns.md` audited to exactly one state — enforced (code line + guarding test cited), superseded (successor rule + retiring decision cited), or stale-now-refreshed; none left unplaced; aspirational rules get an enforcing test or are demoted with rationale
- [ ] `AGENTS.md` reading list references both documents
- [ ] `MEMORY.md`/memory updated where a lesson is user-preference rather than repo fact
- [ ] User has reviewed both documents (this ticket's definition of done includes user sign-off)

## Plan unit

None — post-plan compounding pass over the whole buildout.
