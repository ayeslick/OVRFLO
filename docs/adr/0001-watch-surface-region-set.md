# ADR-0001 — Watch-surface region set

Date: 2026-08-11
Status: accepted

## Context

The Maps charter documented six Markets regions (HEADER, POSITIONS, MARKETS-TABLE,
SETTLEMENT, ACTION, CHROME) against the destination-first app: a positions strip,
a markets table, an expanded settlement row, and a modal action overlay.

The watch-surface rebuild makes the connected wallet's instruments the home. Borrow
and Supply become flows launched from that home. Rate picking gains an ALL RATES
expert workspace. Review and receipts become a split composition shared by every
write. Assets and the guided first run are first-class surfaces. The six-region
set cannot name those surfaces without stretching SETTLEMENT and ACTION until the
IDs stop meaning what they say.

Replacing the region set is a charter edit and an Owner-escalation item under
`docs/maps/REVIEW.md` (trigger 2: charter, product identity, or authority order).

## Decision

Replace the six fixed region slugs with eight:

`SHELL`, `WATCH`, `BORROW`, `SUPPLY`, `RATES`, `REVIEW`, `ASSETS`, `FIRST-RUN`.

Control IDs stay `UI-<REGION>-<CONTROL>`. The SETTLEMENT step trace and the
PERMISSION / ACTION receipts are shared control families documented once in
`docs/maps/ui/review.md` and referenced by ID from the flows that use them —
not a ninth region.

The Owner approved this replacement at plan scoping on 2026-08-11
(`docs/plans/2026-08-11-003-feat-watch-surface-markets-experience-plan.md`,
KTD3).

`docs/maps/ui/review.md` is the REVIEW region brief. `docs/maps/REVIEW.md` remains
the agent review contract. They are different documents.

## Consequences

Later units implement against the eight briefs. U3 re-extracts
`docs/maps/ui/CODING_STANDARD.md` from them; the retired six-region briefs and
their IDs are not authority. Flow-spec entry and Positions-as-destination framing
are superseded by the Product Contract (watch is home); flow grammar, checkpoints,
receipts, and exceptions otherwise stand.

A further region-set change is again a charter edit and again escalates to the
Owner.
