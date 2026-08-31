# 26 — Compound and codify

**What to build:** Harvest every lesson, deviation, and recorded decision from tickets 01–25 into durable knowledge. Write solution writeups for reusable lessons. Refresh critical patterns that this buildout enforced, superseded, or left stale. Do not restate critical patterns in new overlapping rules.

**Executor note:** this ticket is NOT a fresh-chat cheap-model ticket. The coordinator session that holds the review history executes it and consults the user where a rule's generality is uncertain.

**Blocked by:** 25

**Status:** ready-for-human
**Labels:** ready-for-human

## Session prompt (coordinator)

```text
Do not paste this into a fresh cheap-model chat.

Harvest CS1–CS7 (and CS2/CS3 stubs if they resolved) into docs/solutions writeups
and pattern updates. The denomination plan stays read-only. Ticket 09, 10, 18,
and 22 may still be open or cancelled — harvest what shipped and record the
open gates.
Read Required reading below. Follow the remediation hierarchy in
.scratch/lending-v1-lite/issues/09-compound-and-codify.md (unrepresentable >
unmissable > detected > reviewable). Cite sources. Deduplicate against
ovrflo-critical-patterns.md.
```

**Required reading:**

- `docs/solutions/patterns/ovrflo-critical-patterns.md`
- `docs/solutions/patterns/ovrflo-coding-standard.md`
- `docs/solutions/patterns/ovrflo-style-guide.md`
- `docs/solutions/patterns/ovrflo-web-standard.md`
- `.scratch/lending-v1-lite/issues/09-compound-and-codify.md` (hierarchy and harvest method)
- this ticket's acceptance criteria

## Acceptance criteria

- [ ] Every dated decision and deviation across tickets 01–25 has a writeup or an explicit "not generalizable" note
- [ ] Review-roster findings that changed code or docs are traceable into a writeup or a pattern update
- [ ] New or refreshed critical patterns cite detection greps and current code
- [ ] No new rule restates an existing critical pattern (reference only)
- [ ] Plan-gap harvest classifies could-not-follow-the-plan instances (ambiguity / contradiction / unpinned decision / wrong assumption / missing contingency)
- [ ] Open owner gates (USD, Hosted Convert, CS2/CS3 plans, eth-compress, CS7 pins) are listed rather than silently closed
- [ ] `AGENTS.md` reading list points at any new required docs
- [ ] User has reviewed the harvest

## Plan unit

None — post-plan compounding pass over the whole buildout.
