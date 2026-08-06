# 13 — Standards cleanup: shared clock hook + CSS class consistency

**What to build:** Three small, mechanical consistency fixes found in code review (judgement-call findings, not hard violations — bundled into one ticket since each is a one-line-shape change):

1. `web/components/MarketRowDetail.tsx:25` hand-rolls the null-init wall-clock pattern (`useState<bigint | null>(null)` + an effect setting it) instead of using the shared `useNowSeconds` hook this same feature already extracted for exactly this purpose (used elsewhere in `ActionModal.tsx` ×5 and `PositionList.tsx`). Switch it to the shared hook.
2. `web/components/MarketsTable.tsx:28` has the identical duplication — same fix.
3. `web/components/PositionList.tsx:112` has one inline `style={{...}}` layout wrapper where every sibling block in the same file uses a named `globals.css` class. Replace it with a named class matching the surrounding convention.

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] `MarketRowDetail.tsx` uses the shared `useNowSeconds` hook instead of its own local clock state; behavior (time-to-maturity display, teaser reads) is unchanged
- [x] `MarketsTable.tsx` uses the shared clock hook module instead of its own local clock state (see comment below — a new hydration-safe variant, not the eager one); behavior (maturity/days-remaining column) is unchanged
- [x] `PositionList.tsx`'s inline `style={{...}}` wrapper at line 112 is replaced with a named `globals.css` class consistent with its sibling blocks; visual output is unchanged
- [x] No new hydration-mismatch risk introduced
- [x] Full existing test suite green; no visual regression on the local fork

## Comments

**2026-07-27 — resolved, with one deviation from the literal instruction, flagged before implementing.**

The ticket's premise — "just call `useNowSeconds()`" — doesn't hold uniformly for both components, and its own AC ("confirm both call sites still initialize it the same safe way") is exactly the check that catches this:

- **`MarketRowDetail.tsx`**: safe as literally specified. It's only ever mounted after a user expands a row (`selectedMarket` starts `null` in `MarketsApp.tsx`), so it never appears in the initial render tree — purely client-side, post-hydration. Switched directly to `useNowSeconds()` (`web/hooks/useNowSeconds.ts`), removing the local `useState<bigint|null>(null)` + effect.
- **`MarketsTable.tsx`**: switching this one to the same eager `useNowSeconds()` would have been a regression, not a fix. `MarketsTable` renders unconditionally as part of the initial page tree (`page.tsx` → `MarketsApp` → `MarketsTable`, no `dynamic(..., {ssr:false})` anywhere), and `web/next.config.ts` sets `output: "export"` — the initial HTML is static, baked once at `next build` time. `useNowSeconds()`'s eager `useState(() => BigInt(Date.now()...))` would embed whatever the *build-time* clock read, then mismatch the client's real clock at hydration (potentially by however long the static artifact has been deployed) — a real hydration-mismatch bug, not a hypothetical one. This is precisely why the existing code used the null-init + effect pattern here in the first place.

  Resolution: added a second exported hook, `useNowSecondsHydrationSafe()`, to the same `web/hooks/useNowSeconds.ts` module — null until the first client effect runs, matching the static markup exactly on first paint. `MarketsTable.tsx` now imports this instead of hand-rolling the pattern locally, which satisfies the ticket's actual goal (stop duplicating the clock-init boilerplate in components, centralize it in the shared hook file) without introducing the hydration risk the literal instruction would have caused. `PositionList.tsx` already used the eager `useNowSeconds()` (per the ticket's own description) — confirmed it's safe there too, since it only mounts inside `MarketRowDetail`, transitively gated the same way.
- **`PositionList.tsx`**: added a new `.position-list { display: grid; gap: 1rem; }` rule to `globals.css` (next to `.position-group`, matching the file's `position-*` naming convention) and swapped the inline `style={{ display: "grid", gap: "1rem" }}` for `className="position-list"`. Purely cosmetic-equivalent — no clock involved.

Verification: `tsc --noEmit` (pre-existing unrelated errors in `tests/lib/abis.test.ts` confirmed present on `git stash` of these changes, not introduced here), `npm run lint` clean, `npm run test -- --run` 152/152 passing (including `markets-table.test.tsx`'s expand/collapse test, which exercises the exact code path changed), and `npm run build` (full static export, including the `verify-static-export.mjs` no-server-runtime gate) succeeds — grepped the exported `out/index.html` for any baked unix-timestamp-shaped number and found none, confirming `MarketsTable` renders its null clock state (not a build-time value) into the static markup as intended. `forge build`/`forge test` not run — no Solidity changed.
