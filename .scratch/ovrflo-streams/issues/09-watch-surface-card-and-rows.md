# 09 — Watch surface card and rows

**What to build:** Streams lens shows every live row (dot-ribbon unchanged). Selecting a row paints the ledger card in HTML from already-hydrated stream state. Markets runs a CSS light band on streaming bars only. Wallet `tokenURI` stays still and is not the paint path.

**Repo:** this OVRFLO repo (`web/components/watch/`).

**Blocked by:** 08 and 05

**Status:** resolved

**Labels:** ready-for-agent

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-08-13-001-feat-ovrflo-streams-plan.md

Scope: U9 only (= this ticket). Stop when this ticket's acceptance criteria are met.
Ticket: .scratch/ovrflo-streams/issues/09-watch-surface-card-and-rows.md
Spec/harness: .scratch/ovrflo-streams/spec.md — follow its per-session rules.
Do not edit the plan. Do not write E2E (U10). Do not change discovery staging (U8).
Do not paint the card from tokenURI. Do not sandbox the detail card as an <img>.
Before any writes, read Required reading and the plan sections: R14, R16,
KTD4, KTD9, ### U9, and watch-surface plan KTD13 (narrow list→detail).
Layout lock: .scratch/design/ovrflo-stream-ledger-card.html and U3.
Parse U5-staged U3 goldens with DOMParser (only well-formedness gate in the stack).
Honor ovrflo-web-standard.
INTENT RECORD (before the first code write): post assumptions, predicted
blast radius, and the verification that will prove this ticket. Log plan
deviations on this ticket with why; do not edit the plan. Before Status:
resolved, fill Final diff from git diff --stat vs that prediction. Also write
.scratch/decisions/YYYY-MM-DD-*.yaml (docs/maps/SCHEMAS.md §4). Do not
reconstruct the record afterward. See spec.md Intent record and
docs/agents/onboarding.md Before writing code.
After verification, mark ticket checkboxes done
and set Status: resolved.
Commit with write-tree / commit-tree / update-ref. Never git commit.
```

**Required reading:**

- `.scratch/ovrflo-streams/spec.md` (Intent record)
- `docs/agents/onboarding.md` § Before writing code
- `docs/maps/SCHEMAS.md` §4 and `.scratch/decisions/template.yaml`
- Plan R14, R16, KTD4, KTD9, SC15, ### U9
- Watch-surface plan KTD13 (narrow viewport: `WatchApp.tsx`, `useNarrowViewport`, `watch-back`, `url.deselect()`)
- `.scratch/design/ovrflo-stream-ledger-card.html`
- `docs/solutions/patterns/ovrflo-web-standard.md`
- https://ethskills.com/SKILL.md (frontend-ux)
- U5-staged U3 golden fixtures
- this ticket's acceptance criteria

## Settled decisions this ticket must not reopen

- **Rows stay dot-ribbon.** Do not replace the streams lens with a card grid.
- **No paging, no count, no virtualization** (KTD4). Render every live row up to R16's ceiling (08 already flips unavailable past 500).
- **HTML card from hydrated state.** Markets does not fetch `tokenURI` to paint. Optional background `tokenURI` fetch may run as a parity check keyed on mutable storage, `refetchInterval: false`, never on a timer, never the render path.
- **R14 structure lock.** 24-segment bar. Last filled streaming cell gold (ink elsewhere). Depleted swaps "Days left" for "Withdrawn". HTML uses app font tokens; SVG (wallet) stays generic monospace — that split is intentional.
- **Motion.** CSS light band along the filled part, 4s loop, base state fully transparent, clipped to the fill. Streaming only. Settled and depleted omit the band. Under `prefers-reduced-motion: reduce`, band off and `RollingNumber` decorative transitions freeze; vested value still comes from local math.
- **Snapshot vs ticker.** Bar segment count and percent label come only from last-hydrated `streamedAmountOf` (or equivalent batch field). HTML fill is a snapshot from last hydration — selection, remount/visibility-regain, or a mutable-storage change — never a timer. `RollingNumber` alone uses the local clock. Hero vested and card bar may diverge between 15s polls by design.
- **Wallet SVG stays still.** No SMIL in `tokenURI` (already U3). Do not add animation to the NFT from this ticket.
- **SC15.** Descriptor hot-swap emits `BatchMetadataUpdate`. Wallets honor it; this app cannot hear it. Put the descriptor address (or a pinned version) in the card's cache key so the app is not the worse renderer of its own artifact.
- **Accessibility.** Card root `aria-label` includes stream id and status. Segmented bar `role="meter"` with `aria-valuemin="0"`, `aria-valuemax="100"`, `aria-valuenow` from hydrated snapshot percent, `aria-valuetext` with streamed/remaining. Decorative band wrapper `aria-hidden="true"`. Hero `RollingNumber` keeps `role="timer"`.
- **Card states.** (1) book LOADING — no stream detail. (2) row selected while batch in flight — keep the prior card, never an empty shell. (3) hydration success — paint. (4) selected id burned or missing — terminal "stream closed". (5) freshness discard (`signingAllowed` false) — figures stay visible with existing stale borrow copy; bar still last successful snapshot.
- **Narrow (<1024px).** Reuse watch KTD13: list→detail with `watch-back`; URL `?stream=`; browser Back deselects; Enter/Space on the row; back button focused on enter.
- **Identity.** Selected id stays `bigint`.
- **Degraded copy.** Rewrite recovery text with `OVRFLOStream`-specific guidance. Current copy points at Sablier's address.
- **Existing live ticker, facts list, borrow CTA, and pledge-loan link** continue alongside the card.
- **R17/R19** are not this ticket. Do not change lending or factory.

## This ticket owns / does not own

**Owns:** `Wall.tsx` row list (no paging); `StreamDetail.tsx` HTML card; `WatchApp.tsx` narrow selection; component tests; DOMParser golden parse; degraded-copy rewrite; band CSS; a11y attributes; descriptor address in card cache key.

**Does not own:** discovery staging (08); E2E (10); descriptor Solidity (03).

## Do not

- Paint from `tokenURI` or an `<img>` of the SVG
- Put a CSS band on settled/depleted bars
- Drive bar percent from the local clock
- Derive withdraw amounts from the client ticker
- Add a lens count or paging control
- Change row idiom away from dot-ribbon
- Use `5` instead of `5n` for the selected id
- Edit the plan file

## Implementation (binding)

1. Streams lens: every live row at once; empty already hidden by 08.
2. Selection moves focus into the detail region. Narrow behavior per KTD13.
3. `StreamDetail` HTML layout matches U3 + `.scratch/design/ovrflo-stream-ledger-card.html`: status, 24-segment bar, streamed/remaining, rate, days left (Withdrawn on depleted), end date, asset, id.
4. Band on streaming fill only; reduced-motion off.
5. Cache key includes descriptor address or pinned version (SC15).
6. Five card states listed above.
7. Rewrite degraded recovery copy.
8. Parse U5-staged U3 goldens with `DOMParser`; assert no parser-error node.
9. Keep ticker/facts/borrow CTA/pledge link.

## Intent record

Binding. See `.scratch/ovrflo-streams/spec.md` (Intent record) and `docs/agents/onboarding.md` (Before writing code). This ticket also writes a scratch YAML intent capsule (`docs/maps/SCHEMAS.md` §4).

1. Post the record in this chat **before the first code write**.
2. Write `.scratch/decisions/YYYY-MM-DD-*.yaml` from the template (all nine keys).
3. Fill **Deviations from the plan** as they happen, with why. Do not edit the plan.
4. Fill **Final diff** before `Status: resolved`. Put reviewer look-first paths in YAML `diff_hints`.

## Deviations from the plan

- SC15: pinned descriptor version `u3-ledger` in the card cache key instead of a live `nftDescriptor()` read. Why: ticket allows a pinned version; avoids a new RPC and keeps U8 discovery staging closed.
- Bar snapshot uses `streamedAmountOf(schedule, lastReadAt)` instead of adding `streamedAmountOf` to the U8 batch. Why: ticket forbids changing discovery staging; plan allows an equivalent batch field.
- Full `npm run build` (immutable / production artifact) fails without a production profile (U6 residual). Local `npx next build` with `.env.local` is green. Why: ticket says log and do not fail U9 on that residual.

## Final diff

- Predicted blast radius: `StreamDetail.tsx`, new `StreamLedgerCard.tsx`, `Wall.tsx`, `WatchApp.tsx`, `ledger-card.ts`, `watch.css`, watch/inventory tests, `docs/maps/ui/watch.md`, schedule/chain-reads keys + INDEX, scratch decision YAML.
- Actual (`git diff --stat`):
  ```
  .scratch/decisions/2026-08-15-u9-watch-surface-card.yaml (new)
  docs/maps/state/functions/INDEX.md
  docs/maps/state/keys/chain-reads.md
  docs/maps/state/keys/schedule.md
  docs/maps/ui/watch.md
  web/components/kit/RollingNumber.tsx
  web/components/watch/StreamDetail.tsx
  web/components/watch/StreamLedgerCard.tsx (new)
  web/components/watch/Wall.tsx
  web/components/watch/WatchApp.tsx
  web/components/watch/watch.css
  web/lib/ledger-card.ts (new)
  web/tests/inventory/watch-surface.test.tsx
  web/tests/watch/details.test.tsx
  web/tests/watch/ledger-card.test.tsx (new)
  web/tests/watch/wall.test.tsx
  ```
- Misses: `RollingNumber.tsx` (reduced-motion decorative freeze) was not in the initial prediction; required by R14. State INDEX regen followed key-file reader adds.

## Acceptance criteria

- [x] Intent record posted in the session before the first code write
- [x] Scratch decision YAML written under `.scratch/decisions/` before the first code write (`SCHEMAS.md` §4)
- [x] Deviations from the plan (if any) recorded on this ticket with why; plan file not edited
- [x] Final diff filled from `git diff --stat` vs the predicted blast radius
- [x] Selecting a row paints the HTML card for that id from hydrated state (Covers AE3)
- [x] 24 segments; gold on last filled streaming cell; depleted shows Withdrawn, not Days left
- [x] Band present on streaming, absent on settled/depleted, absent under reduced motion
- [x] `RollingNumber` remains the live vested value
- [x] Mocked clock advance with no hydration refresh: hero ticks; bar percent and cells stay fixed
- [x] Reduced motion: band off; ticker decorative transitions static; vested value still correct
- [x] A withdraw updates the HTML fill; quiet poll cycles do not rebuild the card from `tokenURI`
- [x] Below 1024px: selection swaps the screen, `watch-back` returns, URL carries `?stream=`, Enter/Space activate the row
- [x] Missing stream: terminal "stream closed"
- [x] Selected row while batch in flight keeps the prior card
- [x] `signingAllowed` false leaves figures visible
- [x] Selected id stays `bigint`; selection change ignores a stale paint
- [x] DOMParser on U3 goldens: no parser-error node
- [x] Degraded copy no longer points at canonical Sablier
- [x] Descriptor address (or version) is in the card cache key (SC15)
- [x] a11y attributes present as specified
- [x] Component tests green; `npm --prefix web run pretest` and `npm --prefix web run test` green
- [x] `npm --prefix web run lint:maps` green; local `npx next build` green (full `npm run build` logged as U6 residual)

## Plan unit

U9 in `docs/plans/2026-08-13-001-feat-ovrflo-streams-plan.md`
