# Agent review contract

**Review is run by agents, not the Owner.** A routine change merges on an agent
review verdict. The Owner is not a required reviewer and must not be inserted as one
— the five escalation triggers below are the whole of the Owner's review surface.

Review is performed by the compound-engineering review skills. Do not hand-roll a
review process here: pick the right skill, give it the right scope, and add the
OVRFLO-specific criteria below.

Charter: `README.md`. Schemas: `SCHEMAS.md`.

---

## Which skill reviews what

| What changed | Skill | Invocation |
|---|---|---|
| Code — `web/`, scripts, contracts | `ce-code-review` | `ce-code-review base:<merge-base>` (add `plan:<path>` when a plan exists) |
| Documents only — plans, specs, briefs, this charter | `ce-doc-review` | `ce-doc-review <path>` |
| Both | both | `ce-code-review` on the code, `ce-doc-review` on the documents |

Route on what the diff actually touches, not on which felt like the main effort. A
change that edits a region brief *and* the component it describes gets both.

**Reviewer count is not fixed.** `ce-code-review` selects a risk-driven roster from
its own persona catalog and self-sizes to the diff — a small, low-risk change draws a
lite roster, a broad or sensitive one draws the full set. Do not cap it at two
reviewers, and do not hand-pick personas. Pass `depth:full` when you want the full
roster regardless of diff size.

**Mutation boundaries, so you know what you are authorizing:** `ce-code-review` is
report-only and never pushes; it applies fixes only with an explicit `apply:local`.
`ce-doc-review` applies its `safe_auto` fixes to the document as part of the run.

## OVRFLO review criteria

These are the concerns no generic persona owns, because they come from this
project's maps. State them in the invoking prompt, and point the review at
`docs/maps/`. Every review of a Markets UI or client-state change applies them.

### State and trust

Against `docs/maps/state/` and `SCHEMAS.md` §2–§3:

- Are all state keys the change reads or writes declared, with their readers and
  writers? Does the declared blast radius match the diff?
- Does every displayed fact carry a trust domain, and is it the right one?
- **Does any `projection` or `pure-client` value reach a gate?** Anything feeding an
  `if (…) allow` must be re-read from the authority.
- Are loading, stale, unavailable, failed, and empty still distinguishable? Did any
  path collapse a failure into a confident empty result?
- Did a trust domain move? If so, is there a summary ADR?
- Is the generated function index still generated — not hand-edited?

### Cross-layer consistency

Seven invariants no single module can guarantee alone (adapted from
ponytail-fullstack-web3, `docs/cross-layer-invariants.md`). Apply them to any
change that crosses the UI↔chain boundary — form input, transaction build,
submission, receipt handling, or display of chain facts:

- **Intent** — the executed operation matches what the user reviewed in the
  confirm step: same market, same action, same amounts, same stream.
- **Identity** — preparation, signing, submission, and attribution all use the
  same intended account; an account switch mid-flow invalidates prepared state.
- **Chain/environment** — config, reads, addresses, submissions, explorer links,
  and projections all point at the same chain and deployment.
- **Amount** — parsed, displayed, simulated, signed, submitted, emitted, and
  reconciled amounts use compatible units and rounding. The money-cast ban in
  `web/scripts/check-banned-patterns.sh` exists because this failed once; the
  ban catches one syntactic form, this lens covers the rest of the pipeline.
- **Version** — the frontend's ABI and address book are compatible with the
  deployment it talks to.
- **Outcome** — the UI claims only what the defined success condition supports;
  weaker data never overwrites stronger knowledge (freshness precedence,
  `SCHEMAS.md` §2).
- **Recoverability** — reloads, reconnects, replaced transactions, and delayed
  reads can be reconstructed from persisted or on-chain state; no flow strands
  the user in a state only component memory could resolve.

### Product and brief

Against `PRODUCT.md`, `docs/maps/ui/`, and the covering Gherkin:

- Does every touched control still satisfy its seven mandatory fields?
- Does the change match the brief's `Purpose`, `Visible when`, `States`, `Action`,
  and `Copy rules` — or is the brief updated in the same change?
- Does the copy state the obligation concretely — exact assets, amounts, timing,
  fees, on-chain consequence — rather than a promise?
- **Does anything imply health factors, liquidation, or liquidation risk?** OVRFLO
  has none. A comp is not authority for product behavior.
- Is authority order respected — comps win on pixels, briefs win on meaning?
- Do new controls have IDs in the `SCHEMAS.md` format, and are flow-level Gherkin
  tags updated?

### Solidity changes

For contract diffs, state these in the invoking prompt alongside
`docs/solutions/patterns/solidity-implementation-discipline.md` (adapted from
ponytail-fullstack-web3's `solidity-review`):

- **Safety strictly before minimality.** Pass 1 checks authorization,
  accounting, rounding, reentrancy, token edge cases, and invariant coverage
  across *all* affected entry points — only then does pass 2 hunt removable
  surface.
- Minimality findings carry a tag naming the cut — `delete:` / `reuse:` /
  `native:` / `standard:` / `dependency:` / `storage:` / `call:` / `role:` /
  `yagni:` / `shrink:` — and **a minimality finding is invalid if it weakens a
  safety property.**
- `// deliberate-ceiling:` markers in the diff are validated, not read: the
  ceiling must be enforced in code and the trigger measurable (discipline doc,
  "Deliberate ceilings").
- Do not inflate severity, and qualify any cited audit finding ID with its
  audit (AGENTS.md — finding IDs collide across audits).

## Verdict and re-review

`ce-code-review` returns one of **`Ready to merge`**, **`Ready with fixes`**, or
**`Not ready`**, with findings graded P0–P3. `ce-doc-review` returns findings
classified `safe_auto` / `gated_auto` / `manual`, having already applied the
`safe_auto` set.

- **`Ready to merge`, no actionable findings** → merge.
- **Anything else** → the implementing agent addresses the actionable findings and
  review runs again. **One re-review.**
- **Still not resolved after that one re-review** → escalate to the Owner
  (trigger 1).

A review that cannot reach a verdict because a required artifact is missing reports
that as a finding naming the missing artifact. It does not guess, and it does not
write the missing artifact itself.

## Owner escalation triggers

The Owner is pulled in for exactly these five, and nothing else:

1. Review cannot resolve the change after one re-review
2. Charter, product identity, or authority order is being edited
3. A new trust domain, or a projection value being treated as authority
4. An exception to a mapped invariant is requested
5. Secrets, or an irreversible deploy or config change

**A stack change is not a standing escalation trigger.** Stack fitness is scored
separately in [`STACK_FITNESS.md`](STACK_FITNESS.md). That scorecard is not
Owner-scheduled work.

Routine passes never escalate. If a change is merely large, or merely unfamiliar,
that is not a trigger — run the review.

## Mechanical gates

Semantic judgment belongs to the review skills. Mechanical checks stay dumb, fast,
and documented:

- **Existing bans** — `web/scripts/check-banned-patterns.sh` and
  `web/tests/scripts/banned-patterns.test.ts`. Extend these rather than starting a
  parallel catalog. Exemptions are **exact-path only**; a prefix match re-creates the
  risk the ban exists to stop
  (`docs/solutions/security-issues/discovery-security-guard-exemptions-must-be-exact-path-only.md`).
- **Artifact presence gate** — `tools/scripts/check-maps-presence.sh`, wrapped by
  `web/tests/scripts/maps-presence.test.ts`. Run it before review:

  ```sh
  npm --prefix web run lint:maps
  ```

  That runs the presence gate against the diff, then
  `node tools/scripts/generate-state-function-index.mjs --check` for index drift.
  Three rules — rules 1 and 2 presence-only, rule 3 a heading check inside a
  changed ADR:

  1. A change under `web/components/` or `web/hooks/` must also change at least one
     of `docs/maps/ui/**`, `docs/maps/state/keys/**`, or a numbered
     `docs/adr/NNNN-*.md`. `docs/adr/README.md` is the process doc and does not
     count as a companion.
  2. A change under `docs/maps/state/keys/**` must also change
     `docs/maps/state/functions/INDEX.md` — regenerated, never hand-edited.
  3. A changed numbered ADR must carry `Date:`, `Status:`, `## Context`,
     `## Decision`, and `## Consequences`. The `Scratch:` pointer stays optional —
     the ADR must stand on its own — so the gate never requires it.

  Exemptions apply to rule 1 only — rules 2 and 3 cannot be exempted. They live
  in `tools/scripts/maps-presence-exemptions.txt`, are
  **exact-path only**, and require a written reason — an exemption with no reason
  fails the gate rather than passing silently. Prefer writing the companion
  artifact over adding an entry.

  The gate decides from changed paths and, for a changed ADR, from required
  headings — never from meaning: no model call, no network, no source
  inspection. It is not a substitute for the review skills above, and there is no
  LLM semantic review in CI in this system.

`.scratch/` is tracked as of 2026-08-06, so the gate *can* now see scratch files —
but the contract is unchanged: the summary ADR is the durable, self-standing record,
scratch carries the depth behind it, and the gate requires only the ADR.

## Test changes

Test coverage is a quality gate and is not weakened casually. A removed or
semantically weakened test requires an entry in `web/reviews/test-accountability.md`
recording the reason and where the behavior is now covered. **An agent review may
approve that entry** — it does not require the Owner.
