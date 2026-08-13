# Manual QA checklist

Not a code gate. This is a short list of `DESIGN.md` compliance items that require visual
judgment (does this actually *look* right?) rather than a computed-style or DOM assertion.
Everything that Playwright can meaningfully assert — journey behavior, error states, focus
trapping, responsive breakpoints — lives in `tests/e2e/*.feature` instead; see R10-R13 of
`docs/plans/2026-07-23-002-test-web-frontend-test-suite-plan.md` for why the split lands here.

Walk this list against the running app (`npm --prefix web run dev`, or against a deployed
preview) after any change that touches shared layout, CSS, or a component covered below.
Each item cites the `DESIGN.md` section it verifies.

## Canvas & structure (§1)

- [ ] Base background reads as near-black (`--obsidian`), not a lighter dark gray.
- [ ] Panel/card backgrounds that sit "above" the base use `--carbon`, not a shadow or glow, to
      read as elevated.
- [ ] Grid lines (table borders, panel dividers, card borders) are crisp 1px `--graphite`, not a
      soft or anti-aliased-looking rule.
- [ ] No drop shadows or blurs anywhere (cards, modals, dropdowns, tooltips).
- [ ] The 40px background grid overlay is present and subtle (visible on close inspection, not
      distracting at a glance).

## Color semantics (§6)

- [ ] Every cyan-colored number/label is genuinely borrow-side (APRs, obligations, outstanding
      debt, "Borrow" actions) — no cyan used decoratively.
- [ ] Every gold-colored number/label is genuinely lend-side (lend APRs, offers, claimable yield,
      streams, "Supply"/"Lend" actions) — no gold used decoratively.
- [ ] Neutral facts (balances, TVL, maturities) render in `--chalk`, not tinted to either side.
- [ ] Status colors (`--positive`/`--negative`/`--warning`) appear only as a small mono label or
      1px border tint — never flooding a surface.

## Typography (§3)

- [ ] Headers, descriptions, and button labels use the display sans-serif (Schibsted Grotesk), normal weight
      (400-500) — nothing looks heavily bolded.
- [ ] All financial data (APYs, token amounts), table headers, and structural/ASCII elements use
      the monospace face (Martian Mono).
- [ ] Display text reads with a visibly tight tracking (-0.02em) rather than default letter-spacing.

## Component rules (§4, §5, §9)

- [ ] Tables are flat with border-collapse and bottom-borders-only between rows — no per-cell
      boxing.
- [ ] Buttons are transparent with a 1px border matching their text color at rest, and invert
      (solid background, obsidian text) on hover.
- [ ] Cards and modals have sharp corners (0px, or at most a barely-there 2px radius) — nothing
      reads as "rounded."
- [ ] The Tables UI layout (market data as scannable rows) is not replaced by dashboard-style
      cards, except for the locked position-card exception in §5 (streams/loans/supplied
      liquidity within an expanded row).
- [ ] Modals sit on an obsidian scrim that reads as ~85% opacity (background dimmed but still
      faintly visible through it), not fully opaque or barely-there.

## Forms & inputs (§8)

- [ ] Focused inputs shift border color (to chalk or the action's accent) with no glow/outline
      ring around the field.
- [ ] Disabled controls visibly drop to `--dim` text/border at roughly 50% opacity, and the
      cursor changes to not-allowed on hover.
- [ ] Field-level validation errors render as a small mono line under the field (tinted
      `--negative`), never as a toast.

## Motion (§11)

- [ ] Interactive state changes (hover, focus, disabled) transition smoothly over roughly 0.2s —
      no visible snap.
- [ ] Nothing moves, scales, or parallaxes on mount/update (no entrance animations); the only
      motion is live data updating in place (e.g. a vesting amount ticking) without a flash.

## Data formatting (§10)

- [ ] Numeric columns visually align (tabular figures) rather than drifting due to
      proportional-width digits.
- [ ] Empty states show as a dim mono line (e.g. `NO ACTIVE LOANS`) inside its bordered
      container — no illustration.
- [ ] Loading states show dim mono placeholders (`—` / `LOADING`) in place — no spinners or
      skeleton shimmer.

## Out of scope for this checklist

- Responsive behavior at any breakpoint — covered by component tests and
  watch URL `?lens=` / `?position=` / `?loan=` persistence, not this checklist.
- Any journey/error-state/functional behavior — covered by `tests/e2e/*.feature`
  (`watch`, `supply`, `borrow`, `repay-close`, `deposit-wrap-unwrap`, `first-run`).
