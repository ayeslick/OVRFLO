# OVRFLO Maps — AI-first operating charter

This is the operating charter for changing **OVRFLO Markets UI/UX**. It exists so a
coding agent opening a fresh checkout can declare blast radius and durable rationale
without inventing process.

The column tower, live vs target, and the hop table live in `docs/agents/system.md`.
Read that file first. This charter is layer 5 live control map plus client state.

Solidity already has an entry→state map and a process to keep it honest (`x-ray/`).
This is the client-side equivalent for the web app. **The two are separate systems.**
`x-ray/` remains the authority for on-chain state; nothing here replaces or subsumes it.

The human is **Owner/operator**, not the default reviewer. Routine changes are
reviewed by agents, through the `ce-code-review` and `ce-doc-review` skills — see
`REVIEW.md` for which one runs when. The Owner sets goals and handles the five
escalation triggers — nothing else.

---

## Authority order

When two sources disagree about a change, the higher one wins:

1. **Product truth** — `PRODUCT.md`, `CONCEPTS.md`
2. **UI region briefs** — `docs/maps/ui/` (meaning, control contracts)
3. **Gherkin** — `web/tests/e2e/*.feature` (flow-level behavior)
4. **`DESIGN.md` / Impeccable comps** — visual system
5. **Code** — `web/`

Two rules make this operational:

- **Comps win on pixels; briefs win on meaning.** A comp may not redefine what a
  control does, when it is visible, or which data authority backs it.
- **Comps may contain generative noise. Never ship it as product behavior.** OVRFLO
  has no health factors and no liquidations. A number, badge, or gauge that appears
  in a comp but has no product truth behind it does not enter the product.

Maps charter "code is last" applies to **product meaning vs `web/`**. It does not
outrank `src/` for what the chain does. See `docs/agents/system.md` ranking table.

The eight regions below are the **live** Markets control map. CS4 target IA is
`Default` / `Advanced` over one action graph (`DESIGN.md`). Do not add a ninth
region for Default. Do not treat the eight files as already rewritten to Default.

## The eight Markets regions

Region briefs live in `docs/maps/ui/` and are the meaning layer for the Markets app.
There are eight, and only eight. This set replaced the six-region pass-1 topology
(HEADER, POSITIONS, MARKETS-TABLE, SETTLEMENT, ACTION, CHROME) by Owner approval on
2026-08-11 — see `docs/adr/0001-watch-surface-region-set.md`.

| # | Region | Incumbent code |
|---|---|---|
| 1 | Shell | `web/app/layout.tsx` · `web/app/page.tsx` · `web/components/MarketsApp.tsx` · `web/components/WalletRuntime.tsx` · `web/components/CopyValue.tsx` · `web/components/Providers.tsx` · `web/app/{loading,error,global-error}.tsx` · `web/components/{ModalErrorBoundary,TruncationNotice,Footer}.tsx`. Wallet control is `WalletButton` from `wallet-runtime`. |
| 2 | Watch surface | `web/components/watch/{Wall,SuppliedDetail,BorrowedDetail,StreamDetail,ClosedLoanDetail}.tsx`. Entry gate lives in `web/app/page.tsx`. |
| 3 | Borrow flow | `web/app/borrow/page.tsx` · `web/components/borrow/*`. |
| 4 | Supply flow | `web/app/supply/page.tsx` · `web/components/supply/*`. |
| 5 | ALL RATES expert workspace | U4 `RateWindow` kit plus the U8/U9 `ALL RATES` workspace. The retired `RateLadder.tsx` does not return. |
| 6 | Split review + receipts | `web/components/action-flow/ActionFlowShell.tsx` until U8–U11 compose `SettlementTrace` and `Receipt` from the kit. Shared SETTLEMENT / PERMISSION / ACTION families live in `ui/review.md`. |
| 7 | Assets converter + stream creation | `web/components/action-flow/ConvertFlow.tsx` until U10 lands `web/app/assets/page.tsx` and `web/components/assets/*`. |
| 8 | Guided first run + risk | U11: `web/components/first-run/*` and `web/app/risk/page.tsx`. |

Each region documents its controls against the seven mandatory fields in
`SCHEMAS.md`. Regions are region-level documents with **nested controls** — not one
file per control.

The `Incumbent code` column names where a region's behaviour lives now and where the
watch-surface rebuild lands it. `ui/README.md` carries the same mapping plus the
render-inventory coverage table.

Do not confuse `docs/maps/ui/review.md` (the REVIEW region brief) with
`docs/maps/REVIEW.md` (this charter's agent review contract).

## Client state

`docs/maps/state/` catalogs **client** UI state: React/machines, query/wagmi/executor,
and the facts the UI displays. Every displayed fact carries a **trust domain**
(`on-chain` / `projection` / `pure-client`) — see `SCHEMAS.md`.

State keys are the source of truth. The function/module index is **generated** from
the keys, never hand-maintained alongside them.

## Fill order

```
charter (this) ──┬── ui region briefs ──┬── coding standard
                 │                      └── stack fitness
                 ├── state keys ────────────┘
                 ├── testing map + accountability
                 └── ADR + scratch decisions
                              │
                              └── presence gate (needs charter + briefs + keys)
```

Current state of the fill:

| Artifact | Status |
|---|---|
| `README.md`, `SCHEMAS.md`, `REVIEW.md` | published |
| `docs/adr/README.md` | published |
| `.scratch/decisions/` process | published — local only, see `SCHEMAS.md` §4 |
| `docs/maps/ui/` region briefs | filled — eight regions (U2); coverage table in `ui/README.md` |
| `docs/maps/state/` keys + generated index | filled — watch-surface catalog (U3); index generated |
| `web/reviews/testing.md` + accountability | current as of 2026-08-03 |
| `ui/CODING_STANDARD.md` | re-extracted from the eight live briefs (U3) |
| `docs/solutions/patterns/ovrflo-web-standard.md` | published (U3) |
| Presence gate | wired — `npm --prefix web run lint:maps` |
| `STACK_FITNESS.md` | published — scored 2026-08-03 |

An artifact marked *stub* or *not yet* is **not** an invitation to invent its
contents inline. It means a later unit owns it.

## What an agent does before editing Markets UI

1. Read the region brief for the surface you are touching (`docs/maps/ui/`).
2. Read the state keys you will read or write (`docs/maps/state/`), and list the
   dependent readers/writers.
3. Implement.
4. If ownership, trust domain, or a key technical decision moved: write the summary
   ADR (rules in `docs/adr/README.md`) and the scratch YAML (schema in `SCHEMAS.md`
   §4 — that is the normative source).
5. Run the mechanical gate — `npm --prefix web run lint:maps` (`REVIEW.md`,
   Mechanical gates). It runs before review.
6. Run agent review — `ce-code-review` for code, `ce-doc-review` for documents
   (`REVIEW.md`). Merge on a clean verdict.

If a brief or state key you need does not exist yet, that is a gap to report — not a
blank cheque to guess. Say what is missing.

## Reused, not duplicated

This charter deliberately does **not** restate rules that already have an owner:

| Concern | Owner — do not fork it |
|---|---|
| Frontend conventions and audit standing | `docs/frontend-decision-map.md` |
| Web test catalog | `web/reviews/testing.md` |
| Test-change accountability | `web/reviews/test-accountability.md` |
| Code-quality review stance | `web/reviews/coding.md` |
| Mechanical bans | `web/scripts/check-banned-patterns.sh`, `web/tests/scripts/banned-patterns.test.ts` |
| Enforceable protocol rules | `docs/solutions/patterns/ovrflo-critical-patterns.md` |
| Solved-problem writeups | `docs/solutions/` |
| On-chain state authority | `x-ray/` |

When a rule can be enforced mechanically by one of the above, extend that mechanism
rather than adding prose here.

## Out of scope for the Maps system

- **Clearing Ledger visual redesign implementation** — deferred consumer of these
  maps (`docs/plans/2026-07-31-002-feat-clearing-ledger-markets-visual-redesign-plan.md`)
- **Stack migration** — Next.js + React stands for this fill;
  [`STACK_FITNESS.md`](STACK_FITNESS.md) scores fitness and does not perform a switch
- **Replacing Solidity `x-ray/`** — on-chain state authority stays where it is
- **Mandatory human review of routine changes** — the point of the system is that
  agent review can accept or reject a change without the Owner

## Files

| Path | Purpose |
|---|---|
| `README.md` | this charter |
| `SCHEMAS.md` | normative control fields, trust domains, scratch YAML keys |
| `REVIEW.md` | which review skill runs when, review criteria, Owner escalation |
| `ui/README.md` | region brief index |
| `ui/CODING_STANDARD.md` | extracted UI checklist — the brief rules a review cites by id |
| `state/README.md` | client state catalog index |
| `STACK_FITNESS.md` | stack-fitness rubric and its 2026-08-03 run — scored, never decided |
| `../adr/README.md` | when a summary ADR is required |

`.scratch/` is tracked as of 2026-08-06 (it was previously gitignored), so scratch
decision records travel with the repo. The normative scratch schema remains
`SCHEMAS.md` §4; where a local template disagrees, §4 wins.
