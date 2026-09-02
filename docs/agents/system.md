# Agent cockpit for the OVRFLO system

Audience: coding agents. Read this file first. Then hop. Do not reread every charter for a question this file already routes.

This repo is one system. The root object is a **column**. Every contract, position, USD quote, and product mode hangs off one column. A second underlying is a second column, not a special case inside the first.

---

## Root object

A **column** is one underlying plus the vault, receipt token, wrap reserve, lending market, and (after CS3) request book that serve it. The factory admits at most one column per underlying.

ovrfloToken of that column is 1:1 with that underlying on wrap and unwrap. Streams, loans, and supply positions of that column are denominated in that ovrfloToken after CS1. USD quotes key by that underlying only. Never apply another column's quote, backing, lending book, or recipe.

---

## Tower

Read from the bottom. Each layer names the layer below. It does not restate that layer's rules.

| Layer | What it is | Live owner | Target owner (denomination plan) |
|---|---|---|---|
| 1. Underlying | Column identity asset (`vault.underlying()`) | `src/` | unchanged |
| 2. Column wiring | Factory admits vault, token, wrap reserve, lending | Vault constructs reserve. Reserve constructs token. Wrap lives on `OVRFLOReserve`. Lending escrows ovrfloToken. PT flash is gone. Factory maps `ovrfloToReserve`. | Request book is the lending router (CS3). |
| 3. Positions | ovrfloToken, stream, loan, supply, request | `src/` + `x-ray/` | Request book is CS3. |
| 4. Display overlay | USD per underlying. Token units always available. | Optional USD in older product copy | USD default when that column's recipe is live. Calldata stays token-native. Missing recipe hides USD for that column only. |
| 5. Product modes | What the customer sees | Eight Markets map regions (watch, borrow, supply, rates, …) | `Default` / `Advanced` over one action graph. `DESIGN.md` is normative. The eight regions stay the live control map until CS4 lands. |
| 6. Agent cockpit | How you drive the repo | this file, then the hop table | unchanged |

`src/` is live after CS1 for column wiring. CS2 flash mint, CS3 request book, and CS4 product modes remain target. Do not write a sentence that mixes live `src/` with an unbuilt later unit.

---

## Which ranking applies

There is no single total order. Pick the ranking that matches the question.

| Question | Winner | Do not use |
|---|---|---|
| What does the chain do right now? | `src/` and the test that would fail if the claim were wrong | PRODUCT, CONCEPTS, maps, memory |
| What did this campaign pin? | The active plan Key Decision, read-only while implementing | Minimality arguments, a later ticket's guess |
| What word does this repo use? | `CONCEPTS.md` | Synonyms |
| What may the customer see or believe? | `PRODUCT.md`, then `DESIGN.md` for pixels, then `docs/maps/ui/` for control contracts | Comp noise, health-factor language |
| What may Markets code do? | Region brief beats `web/` | Inventing a ninth region |
| Is this finding already dead? | `docs/audit/rejected-findings-record.md`, qualified by audit name | Bare `H-1` |
| How do I write Solidity or web? | Coding standard, style guide, web standard, Sequence 6 / scratch YAML | A new parallel checklist |

Maps charter "code is last" applies to **product meaning vs `web/`**. It does not outrank `src/` for what the chain does.

---

## Hop table

Open one file. Stop.

| I need | Open |
|---|---|
| The whole system | this file |
| Live contract map, actors, do/do-not | `docs/agents/onboarding.md` |
| Campaign decision for denomination / Default | the ticket's plan unit inside `docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md` |
| How to run that campaign | `.scratch/denomination-border-column/spec.md` then the ticket |
| Word meaning | `CONCEPTS.md` |
| Customer-facing product rules | `PRODUCT.md` |
| Visual and Default/Advanced interaction | `DESIGN.md` |
| A Markets control | `docs/maps/ui/<region>.md` |
| Trust of a displayed fact | `docs/maps/SCHEMAS.md` §2 |
| Browser state blast radius | `docs/maps/state/keys/` |
| On-chain entry points | `x-ray/` |
| Enforceable protocol rules | `docs/solutions/patterns/ovrflo-critical-patterns.md` |
| A solved incident | `docs/solutions/` |
| How to test E2E | `docs/agents/testing.md` |
| Campaign ticket files | `docs/agents/issue-tracker.md` (local `.scratch/`, not GitHub Issues) |

If two hops disagree, name both and apply the ranking table. Do not average them.

---

## Session spend

A new chat reads this file, the ticket, and the cited plan unit. It does not read the whole denomination plan unless the ticket's Required reading names that section.

Record intent before the first code write (`docs/agents/onboarding.md` Before writing code). Compare `git diff --stat` to that prediction before calling the work done.

One ticket per chat. CS2 and CS3 do not land in CS1 commits.

---

## Accretion

New work joins a layer. It does not start a parallel system.

| Arrival | Joins |
|---|---|
| A new underlying | A factory-admitted column, plus a reviewed USD recipe row. Token-native flows do not wait. Never copy wstETH's row. |
| A new PT series | `setSeriesApproved` on an existing column. Same underlying recipe. |
| A new position type | `CONCEPTS.md` plus a maps control. Not a ninth region until the Owner amends the maps charter. |
| A new agent lesson | `docs/solutions/` and, if ALWAYS REQUIRED, a critical pattern. Not a third onboarding essay and not an `AGENTS.md` architecture dump. |
| A session landmine that hops failed to stop | `AGENTS.md` landmines. Hydra findings stay inlined. |
| A plan deviation | The ticket. Not an edit to the plan during implementation. |
| A display amount | Layer 4. Canonical action and calldata stay layer 3. |

If you are about to add a file that restates this tower, hop here instead.

---

## Fail closed across the tower

- No column recipe, stale quote, or other-column quote: hide USD for that column. Token submit still works.
- Scanner candidates are display only. Every write re-reads chain facts.
- Unregistered vault and lending are inert.
- A missing maps brief is a gap to report, not a license to guess.
