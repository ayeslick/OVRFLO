# AI-first Maps system fill

**Authoritative plan:** `docs/plans/2026-08-03-001-feat-ai-maps-system-fill-plan.md`

**Objective:** Stand up and fill an AI-operable Maps system for OVRFLO Markets UI/UX — charter, region briefs, client state map, extracted coding standard, testing-map upgrade, decision summaries + scratch, dual-agent review, presence gate, and stack-fitness scorecard — so coding agents can change the UI with declared blast radius and durable rationale, while the human remains Owner/operator rather than default reviewer.

**Tickets:** `.scratch/ai-maps-system-fill/issues/` (01–07). Work the frontier: any ticket whose blockers are done. Start with **01** alone; then **02**, **03**, and **05** can proceed in parallel.

**Out of scope for this feature:** Clearing Ledger visual redesign implementation; actual stack migration; replacing Solidity `x-ray/`; mandatory human review of routine changes.

---

## How to execute (ce-work + tickets)

Do **one ticket per chat**. Do not run the whole plan in one session.

### Every session

1. Open a **new** agent chat (clear context).
2. Claim the ticket: set `Status: claimed` near the top of that issue file.
3. Paste the **Session prompt** block from that ticket (already filled in).
4. Let `/ce-work` implement only that plan unit; it must read Required reading before writing artifacts.
5. Search `docs/solutions/**/*.md` for relevant guidance when touching enforcement scripts or UI honesty patterns; read matching files in full. This feature is **docs/process + light tooling** — do **not** treat it as a Solidity ticket. Skip `BASE_SECURITY.md` / contract-authoring ETHSKILLS branches unless a ticket explicitly expands into contracts (it must not).
6. Before inventing process docs, run a **mandatory reuse audit**:
   - Prefer extending `web/reviews/*`, `docs/frontend-decision-map.md`, and existing banned-pattern checks over parallel catalogs.
   - Prefer the plan’s schemas over inventing new field names.
   - In the final report, list what was reused vs newly created and why.
7. Before implementation, run a **mandatory unit-boundary reconciliation**:
   - Read the plan’s Implementation Units for this ticket and adjacent units.
   - State what this ticket owns now vs what later tickets own (e.g. presence gate must not invent brief schema).
   - Do not edit the plan file while implementing.
8. Verify acceptance criteria (doc schema checklist, generator dry-run, or presence-gate fixtures as specified). Prefer small mechanical checks over hand-wavy “looks good.”
9. When acceptance checkboxes are done: set `Status: resolved`, commit on the feature branch (use **commit-tree plumbing** — never bare `git commit` from the agent; see user rule on Cursor `--trailer` injection), stop.
10. Next ticket → new chat again.

### Parallel start

After **01** is resolved: **02**, **03**, and **05** have no further blockers among themselves — separate chats/worktrees are fine. **04** waits on **02**. **06** waits on **01+02+03**. **07** waits on **02+03**.

### Dual-agent review (when a ticket says so)

Default reviewers are two agents (state/trust + product/brief), not the Owner. Owner escalates only per plan D8 / `docs/maps/REVIEW.md` once that file exists (ticket 01).

### Do not

- Point `ce-work` at the whole plan with no unit scope
- Edit the plan file while implementing
- Implement Clearing Ledger UI pixels or migrate the frontend stack
- Replace or “improve” Solidity `x-ray/` as part of this feature
- Require human review for routine dual-agent passes
- Duplicate the state-key catalog into a hand-maintained function index (generate B from A)
- Use `git commit` from the agent (Cursor injects `Co-authored-by`); use write-tree / commit-tree / update-ref, verify message clean, then push

---

## Ticket map

| # | Title | Plan units | Blocked by |
|---|---|---|---|
| 01 | Maps operating charter | U1, U6 | — |
| 02 | Six Markets region briefs | U2 | 01 |
| 03 | UI client state map | U3 | 01 |
| 04 | Extracted UI coding standard | U4 | 02 |
| 05 | Testing map + accountability | U5 | 01 |
| 06 | Maps presence gate | U7 | 01, 02, 03 |
| 07 | Stack-fitness scorecard | U8 | 02, 03 |

```
01 ──┬── 02 ──┬── 04
     │        └── 07
     ├── 03 ──────┘
     ├── 05
     └── 06 (needs 01+02+03)
```

---

## Authority (do not invent)

Product truth → UI region briefs → Gherkin → DESIGN.md / Impeccable comps → code.  
OVRFLO has no health factors or liquidations; comps may show generative noise — never ship it as product behavior.
