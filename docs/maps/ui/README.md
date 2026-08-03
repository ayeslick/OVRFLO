# Markets region briefs — index

The meaning layer for OVRFLO Markets UI/UX. Six region-level briefs, each documenting
its controls against the seven mandatory fields in `../SCHEMAS.md`.

**Bodies are not written yet.** This index is the day-one stub. Filling the briefs is
a separate unit — do not draft a region body inline while doing other work, and do not
invent control IDs ahead of the fill.

## The six regions

| Region | Slug | File (when filled) | Incumbent code |
|---|---|---|---|
| Header | `HEADER` | `header.md` | `web/components/MarketsApp.tsx` |
| Your positions | `POSITIONS` | `positions.md` | `web/components/PositionSummary.tsx` · `web/components/PositionList.tsx` |
| Self-repaying markets table | `MARKETS-TABLE` | `markets-table.md` | `web/components/MarketsTable.tsx` · `web/components/RateLadder.tsx` |
| Expanded settlement | `SETTLEMENT` | `settlement.md` | `web/components/MarketRowDetail.tsx` · `web/components/MarketDetail.tsx` |
| Action modal / overlay | `ACTION` | `action.md` | `web/components/ActionModal.tsx` · `web/components/ClaimAllModal.tsx` · `web/components/action-flow/` |
| System chrome | `CHROME` | `chrome.md` | `web/components/Providers.tsx` · `web/components/WalletRuntime.tsx` · `web/components/ModalErrorBoundary.tsx` · `web/components/TruncationNotice.tsx` |

The `File` column is the filename a brief will take when it is written; none of those
files exist yet.

Six regions, fixed at pass 1. A surface that seems to need a seventh is a signal to
re-read the boundaries above, not to add a region.

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

**Not** Impeccable generative fields. Comps win on pixels and nothing else; a value
that appears in a comp without product truth behind it does not become a brief fact.
OVRFLO has no health factors and no liquidations.
