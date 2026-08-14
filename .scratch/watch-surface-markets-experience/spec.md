# Watch-surface Markets experience

**Authoritative plan:** `docs/plans/2026-08-11-003-feat-watch-surface-markets-experience-plan.md`

**Objective:** Rebuild the Markets web app so its home is the watch surface — lenders watching earnings roll up with claim at hand, borrowers watching debt roll down to a known done-date — wired to the v1-lite OVRFLOLending tick order book, in the ratified one-bit gold grammar, with the entire frontend mapped: every screen under a control contract, every piece of client state cataloged, every data path documented with its trust domain.

**Tickets:** `.scratch/watch-surface-markets-experience/issues/` (01–17). Work the frontier: any ticket whose blockers are done. Start with **01** alone. **15–17** are the plan's tail after U1–U14: they are not implementation units; they still block ship.

**Out of scope for this feature:** Solidity changes; a backend/indexer service; health-factor or liquidation UX; a projection value feeding an action gate; marketing landing; notifications; shareable/public loan views; cross-position Claim-All; spectator/synthetic demonstration loans; engagement mechanics; analytics/telemetry. Ops checklist items remain Owner/ops, not tickets: `app.overflow.finance` DNS/hosting cutover, registrar/DNS hardening, per-release IPFS mirror, deploy-pipeline key discipline, incident switch.

---

## How to execute (ce-work + tickets)

Do **one ticket per chat**. Do not run the whole plan in one session.

### Every session

1. Open a **new** agent chat (clear context).
2. Claim the ticket: set `Status: claimed` near the top of that issue file.
3. Paste the **Session prompt** block from that ticket (already filled in).
4. Let `/ce-work` implement only that plan unit; it must read Required reading before writing.
5. Search `docs/solutions/**/*.md` for relevant guidance when touching executor, query, honesty, or E2E patterns; read matching files in full. This feature is **Markets frontend** — read https://ethskills.com/SKILL.md and follow the frontend-ux / frontend-playbook branches before shipping UI. Skip `BASE_SECURITY.md` / contract-authoring ETHSKILLS branches unless a ticket explicitly expands into contracts (it must not).
6. Before inventing modules, run a **mandatory reuse audit**:
   - Prefer extending existing executor / query-key / maps / kit patterns over parallel catalogs.
   - Prefer the plan’s schemas, region IDs, and mechanism-map paths over inventing new field names.
   - In the final report, list what was reused vs newly created and why.
7. Before implementation, run a **mandatory unit-boundary reconciliation**:
   - Read the plan’s Implementation Units for this ticket and adjacent units.
   - State what this ticket owns now vs what later tickets own (e.g. kit must not invent flow routes; lib must not invent hooks).
   - Do not edit the plan file while implementing.
8. Verify acceptance criteria (build, `lint:maps`, unit/E2E, grep gates as specified). Prefer mechanical checks over hand-wavy “looks good.”
9. When acceptance checkboxes are done: set `Status: resolved`, commit on the feature branch (use **commit-tree plumbing** — never bare `git commit` from the agent; see user rule on Cursor `--trailer` injection), stop.
10. Next ticket → new chat again.

### Parallel start

After **01** is resolved: **02** is next (charter/briefs). After **02**: **03**. After **03**: **04** and **05** can proceed in parallel. **06** waits on **05**. After **04** and **06**: **07**, **09**, **10**, and **11** can proceed in parallel. **08** waits on **07** as well (watch-row landing). After **07–11**: **12** and **13** can proceed in parallel. **14** waits on **12** and **13**. Tail is linear: **15** waits on **14**; **16** waits on **15**; **17** waits on **16**. Each of 15–17 is a **fresh reviewer context** — do not continue the U14 chat.

### Dual-agent review (when a ticket says so)

Default reviewers are agents via `ce-code-review` / `ce-doc-review` with maps lenses (state/trust + product/brief), not the Owner. Owner escalates only per `docs/maps/REVIEW.md`.

### Do not

- Point `ce-work` at the whole plan with no unit scope
- Edit the plan file while implementing
- Change Solidity, add an indexer, or invent health-factor / liquidation UX
- Let a projection value gate an action
- Work around a session-settled decision that proves unimplementable — stop and surface it
- Duplicate the state-key catalog into a hand-maintained function index (generate B from A)
- Run tickets 15–17 in the U14 chat, or start them before 14 is resolved
- Execute DNS/hosting/registrar/IPFS/deploy-key/incident-switch ops as agent tickets
- Use `git commit` from the agent (Cursor injects `Co-authored-by`); use write-tree / commit-tree / update-ref, verify message clean, then push

---

## Ticket map

| # | Title | Plan units | Blocked by |
|---|---|---|---|
| 01 | Foundation: ABI, tokens, fonts, purge | U1 | — |
| 02 | Charter + region briefs | U2 | 01 |
| 03 | State-key catalog + standards | U3 | 02 |
| 04 | Component kit | U4 | 02, 03 |
| 05 | Pure lib layer | U5 | 03 |
| 06 | Hooks + executor re-anchor | U6 | 05 |
| 07 | Shell + watch surface | U7 | 04, 06 |
| 08 | Supply flow | U8 | 04, 06, 07 |
| 09 | Borrow flow | U9 | 04, 06 |
| 10 | Assets: converter + stream creation | U10 | 04, 06 |
| 11 | First run + risk surface | U11 | 04, 06 |
| 12 | States, navigation, persistence hardening | U12 | 07, 08, 09, 10, 11 |
| 13 | Repo sync: concepts, Gherkin, metadata | U13 | 07, 08, 09, 10, 11 |
| 14 | Acceptance: render inventory + suites | U14 | 12, 13 |
| 15 | Impeccable finish review | Tail | 14 |
| 16 | DESIGN.md from shipped UI | Tail | 15 |
| 17 | ethskills:qa pre-ship audit | Tail | 16 |

```
01 ── 02 ── 03 ──┬── 04 ──────────────┬── 07 ──┬── 08 ──┬── 12 ── 14 ── 15 ── 16 ── 17
                 │                    │        │        │
                 └── 05 ── 06 ────────┤        ├── 09 ──┤
                                      │        ├── 10 ──┤
                                      │        └── 11 ──┘
                                      │                 └── 13 ──┘
```

---

## Authority (do not invent)

When sources disagree, the higher one wins:

1. Product truth: `PRODUCT.md`, `CONCEPTS.md`.
2. UI region briefs: `docs/maps/ui/` **as rewritten by ticket 02** (briefs win meaning; comps win pixels).
3. Behavior: `docs/plans/2026-08-11-markets-frontend-flow-spec.md` (read-only) as extended/superseded by this plan's Product Contract; Gherkin as rewritten by ticket 13.
4. Visual: liked-interface synthesis, Impeccable refs, approved walkthrough, surface brief.
5. Contract truth: `src/OVRFLOLending.sol`, `src/OVRFLO.sol`, `src/OVRFLOFactory.sol` as built — never a doc's paraphrase.

`docs/plans/2026-08-11-002-feat-web-v1-lite-frontend-rebuild-plan.md` is superseded history. OVRFLO has no health factors or liquidations; comps may show generative noise — never ship it as product behavior.
