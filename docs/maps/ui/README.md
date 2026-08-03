# Markets region briefs — index

The meaning layer for OVRFLO Markets UI/UX. Six region-level briefs, each documenting
its controls against the seven mandatory fields in `../SCHEMAS.md`.

**All six bodies are written (pass 1).** Every control carries the seven mandatory
fields. Optional columns — a11y notes, colour/token references, links to covering tests —
are deferred and may be added later, never as a substitute for the seven.

## The six regions

| Region | Slug | Brief | Incumbent code |
|---|---|---|---|
| Header | `HEADER` | [`header.md`](header.md) | `web/components/MarketsApp.tsx` · `web/components/WalletRuntime.tsx` · `web/components/CopyValue.tsx` |
| Your positions | `POSITIONS` | [`positions.md`](positions.md) | `web/components/PositionSummary.tsx` · `web/components/PositionList.tsx` |
| Self-repaying markets table | `MARKETS-TABLE` | [`markets-table.md`](markets-table.md) | `web/components/MarketsTable.tsx` · `web/components/RateLadder.tsx` |
| Expanded settlement | `SETTLEMENT` | [`settlement.md`](settlement.md) | `web/components/MarketRowDetail.tsx` · `web/components/MarketDetail.tsx` |
| Action modal / overlay | `ACTION` | [`action.md`](action.md) | `web/components/ActionModal.tsx` · `web/components/ClaimAllModal.tsx` · `web/components/action-flow/` |
| System chrome | `CHROME` | [`chrome.md`](chrome.md) | `web/components/Providers.tsx` · `web/components/WalletRuntime.tsx` · `web/components/ModalErrorBoundary.tsx` · `web/components/TruncationNotice.tsx` |

Six regions, fixed at pass 1. A surface that seems to need a seventh is a signal to
re-read the boundaries above, not to add a region.

### Where a shared component is documented

Two components render outside the region the charter's incumbent-code column assigns
them to. The brief follows the code; the table above keeps the charter's mapping so the
two do not silently diverge.

| Component | Charter column | Documented in | Why |
|---|---|---|---|
| `RateLadder.tsx` | `MARKETS-TABLE` | `action.md` (`UI-ACTION-RATE-LADDER`) | Nothing in `MarketsTable.tsx` renders it; it renders inside the borrow, supply, and adjust-rate flows. The table's own rate display is `UI-MARKETS-TABLE-RATES`. |
| `MarketDetail.tsx` | `SETTLEMENT` | `action.md` (`UI-ACTION-OVERLAY`) | It is the dialog shell every action opens, so its scrim / focus trap / Escape / close contracts belong with the actions rather than with settlement. `settlement.md` owns the expanded-row body. |

Cross-region controls that follow the same rule: `PositionList` cards are documented in
`positions.md` though they render inside the expanded row (`settlement.md`), and
`CLAIM ALL` is triggered in `positions.md` while its overlay is `UI-ACTION-CLAIM-ALL-*`.

## How a brief is structured

One file per region, with controls nested inside it — not one file per control. Each
control carries all seven fields from `../SCHEMAS.md` §1:

**ID · Purpose · Visible when · States · Action · Copy rules · Data authority**

Optional at pass 1: a11y notes, color/token references, links to covering tests.

## Sources a brief is built from

- `PRODUCT.md` — product truth, and the boundary a brief may not cross
- The incumbent components listed above — what the control does today
- `web/tests/e2e/*.feature` — flow-level behavior, tagged by control ID
- `DESIGN.md` — visual system

**Tag status.** Control-ID tags on the Gherkin are the target shape (charter authority
order; plan D6), but no `.feature` file carries one yet — the six existing features
(`adjust-rate`, `borrow`, `claim-all`, `deposit-wrap-unwrap`, `repay-close`, `supply`)
are untagged. Test links stay in the optional column until the tags land; do not cite a
tag that does not exist.

**Not** Impeccable generative fields. Comps win on pixels and nothing else; a value
that appears in a comp without product truth behind it does not become a brief fact.
OVRFLO has no health factors and no liquidations.
