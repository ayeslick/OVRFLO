# 09 — Compound the buildout: solution writeups, coding standard, style guide

**What to build:** Harvest every lesson, deviation, and recorded decision from the v1-lite buildout into durable knowledge, then distill it into two decision-eliminating documents. Three layers:

1. **Solution writeups** (`docs/solutions/`, repo conventions: category dirs + YAML frontmatter). One writeup per genuinely reusable lesson from tickets 01–08 — sourced from the plan's dated decision notes, the per-ticket review-roster findings, and builder-surfaced judgment calls. Known candidates as of ticket 03 (later tickets will add more): the grossPrice-cap forcing chain (how a closed error catalog + a documented call-site precondition jointly force an implementation choice); the packed-slot `vm.load` + `forge inspect` verification technique; the discriminating-boundary test pattern (net-fee floor, `UNIT-1` flooring — a test at the wrong distance from a boundary proves nothing); ERC-721-ownership-as-guard (deleting `StreamAlreadyPledged`: when an external contract's own checks make an on-chain guard structurally redundant); the checked-narrowing-vs-partial-fill trap (`_toUnits` on max targets); frozen-history/monotone-counter as a safety argument style.
2. **Coding standard** (`docs/solutions/patterns/ovrflo-coding-standard.md`): the enforceable rules a model must follow writing OVRFLO Solidity — error/event conventions (custom errors from a closed catalog, absolute-checkpoint events, full-field emit tests), types and narrowing (SafeCast routing, unit boundaries), storage packing discipline, reentrancy/FREI-PI ordering, external-integration rules (plain `transferFrom` for Sablier, StreamPricing never re-derived), test-integrity requirements (uncheatable tests, exact-selector expectRevert, plan-derived literals). Every rule cites the writeup or review finding it came from.
3. **Style guide** (`docs/solutions/patterns/ovrflo-style-guide.md`): the softer conventions that remove micro-decisions — naming (`test_Fn_Behavior`, no `l`/`O`/`I` adjacent to digits, OVRFLO never OVFL), file/section layout, NatSpec voice and required tags, comment discipline (constraints only, no narration), fixture conventions (the 73-day/1.02 exact-arithmetic pattern).

Both documents get wired into `AGENTS.md` required reading so every future session inherits them. Rules must be deduplicated against `ovrflo-critical-patterns.md` — reference, never restate; where a critical pattern was superseded by v1-lite, the standard records the successor rule.

**Executor note:** this ticket is NOT a fresh-chat cheap-model ticket. It is executed by the coordinator (orchestrator session), which holds the full review history and decision trail, consulting the user where a rule's generality is uncertain. The value of the documents is exactly the coordinator's cross-ticket insight.

**Blocked by:** 08

**Status:** open
**Labels:** ready-for-human

## Acceptance criteria

- [ ] Every dated decision note in the plan (2026-08-08 series and any later) has either a solution writeup or an explicit "not generalizable" note
- [ ] Every review-roster finding that changed code or docs across tickets 01–08 is traceable into a writeup, the standard, or the style guide
- [ ] `ovrflo-coding-standard.md` exists; every rule cites its source; no rule restates `ovrflo-critical-patterns.md` (references only)
- [ ] `ovrflo-style-guide.md` exists; naming/layout/NatSpec/test conventions each carry one concrete example from the shipped code
- [ ] `AGENTS.md` reading list references both documents
- [ ] `MEMORY.md`/memory updated where a lesson is user-preference rather than repo fact
- [ ] User has reviewed both documents (this ticket's definition of done includes user sign-off)

## Plan unit

None — post-plan compounding pass over the whole buildout.
