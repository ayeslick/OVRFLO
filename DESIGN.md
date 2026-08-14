---
name: OVRFLO Markets
description: One-bit instrument workbench for self-repaying loans
colors:
  paper: "#FDFDFC"
  ink: "#0A0A0A"
  dim: "#6B6B6B"
  halftone: "#EFEFEC"
  gold: "#E8930C"
  gold-ink: "#FFB84D"
  ok: "#177245"
  err: "#C22F2F"
  rule-hairline: "#CCCCCC"
  rule-faint: "#DDDDDD"
typography:
  display:
    fontFamily: "Martian Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "36px"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.03em"
    fontFeature: "tabular-nums"
  headline:
    fontFamily: "Schibsted Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 800
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Schibsted Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 900
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Schibsted Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "-0.02em"
  label:
    fontFamily: "Martian Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.3
    letterSpacing: "0.08em"
rounded:
  none: "0px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "22px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.gold-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "11px 22px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.gold-ink}"
    rounded: "{rounded.none}"
  button-default:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "11px 22px"
    height: "44px"
  button-default-hover:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
  button-disabled:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.dim}"
    rounded: "{rounded.none}"
    height: "44px"
  lens-tab:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "9px 20px"
    height: "44px"
  lens-tab-selected:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.none}"
    height: "44px"
  entity-row:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "14px 16px"
  entity-row-selected:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.none}"
  receipt:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
  amount-field:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.display}"
    rounded: "{rounded.none}"
  rate-chip:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "13px 14px"
    height: "44px"
  rate-chip-selected:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.gold-ink}"
    rounded: "{rounded.none}"
---

# Design System: OVRFLO Markets

## Overview

**Creative North Star: "One-bit instrument workbench"**

The Markets app is a paper instrument, not a dark casino. Warm newsprint (`--paper`) is the canvas. Hard black rules (`--ink`) are structure. Square controls, inverted selection, and a single amber accent mark the live operation. Schibsted Grotesk carries decisions and prose; Martian Mono carries receipts, amounts, labels, and navigation. Bitmap dots live in frames and capital bands, never behind copy.

Home is the watch wall. Borrow, Supply, and Assets launch as flows. Depth comes from 1–2px rules and inversion, never from shadow, glass, or glow. Motion is compositor-only and interruptible; ticking numbers update in place. Region briefs own meaning and copy; this file recovers the visual system from the shipped CSS and kit (`web/app/globals.css`, `web/app/status-warning.css`, `web/components/kit/kit.css`, `web/components/kit/hero-rolling.css`, flow CSS).

**Key Characteristics:**

- Paper canvas, ink rules, one gold accent
- Square corners; selection is inversion
- Grotesk decisions over mono receipts
- Gold-ink on ink for body-size accent text; display-scale gold on paper only where the CSS actually sizes it
- No cyan, Inter, NOW/NEXT strip, or health-factor gauge

## Colors

Eight tokens on `:root` in `web/app/globals.css`. Hairline greys in kit CSS are not tokens; they are structural rules.

### Primary

- **Instrument ink** (`{colors.ink}`): text, rails, selected fills, primary action fills, focus outline.
- **Operation gold** (`{colors.gold}`): the only accent. Used as a 2px outline on primary actions, as fill on queue/self/draw band parts, as selected rate-band color, and as display-scale gold on paper (36px) for Borrow `YOU RECEIVE` and watch earnings. Do not invent a second accent.

- **Gold on ink** (`{colors.gold-ink}`): gold-family text and numerals on inverted ink — selected entity decisive numbers, selected rate APR, primary action label.

### Neutral

- **Newsprint** (`{colors.paper}`): page and shell ground. Body, html, kit, receipts, and modal scrim all sit on it.
- **Caption grey** (`{colors.dim}`): kickers, secondary labels, disabled copy, USD captions, pending trace steps.
- **Halftone** (`{colors.halftone}`): defined on `:root` as the warm frame fill. Shipped surfaces do not yet paint it; bitmap texture uses `currentColor` radial dots instead (`background-size: 5px 5px`).
- **Hairline rule** (`{colors.rule-hairline}` / `{colors.rule-faint}`): wall/footer/receipt row dividers (`#ccc` / `#ddd`). Not accent.

### Outcomes (not accents)

- **Confirm green** (`{colors.ok}`): confirmed / closed status only (`.status-positive`).
- **Reject red** (`{colors.err}`): invalid fields, reverted/error trace steps, field errors.

**The One Gold Rule.** Gold is the sole accent. Cyan is retired. Green and red never decorate idle chrome; they only report transaction outcomes.

**The Gold-on-Ink Rule.** Gold-family *text* at body size sits on inverted ink (`gold-ink` on `ink`). Display-scale gold-on-paper is 36px: Borrow `YOU RECEIVE`, watch earnings inside `.kit-hero` (`hero-rolling.css`), and the Assets amount at `min-width: 800px`. Warning copy is ink (`status-warning.css` loads after `globals.css`, which still contains a gold `.status-warning` rule). Queue-band gold is a fill, not copy. Gold `RollingNumber` outside `.kit-hero` is body-size on paper — do not ship that.

## Typography

**Display Font:** Schibsted Grotesk (ui-sans-serif / system-ui / sans-serif), loaded via `next/font/local` as `--font-schibsted` (`web/app/fonts.ts`). Weights 400 / 500 / 700 / 900. Fallback metrics on; `display: swap`. Body letter-spacing `-0.02em`.

**Body Font:** the same Grotesk stack (`--font-decision`).

**Label/Mono Font:** Martian Mono (ui-monospace / SFMono-Regular / Menlo), `--font-martian` / `--font-receipt`. Weights 400 / 700. Tables use `font-stretch: condensed` plus `tabular-nums`. Dense labels track `0.08em`–`0.14em` and are usually uppercase.

**Character:** Grotesk is the decision voice — titles, ledes, wordmark. Mono is the instrument voice — amounts, rates, IDs, nav, receipts, status. Mono never carries paragraphs.

### Hierarchy

- **Display** (Martian Mono 700, 36px / 44px amount field at `min-width: 800px`, line-height 1.1): Borrow proceeds, amount entry, the live money the user is deciding. `tabular-nums`; width in `ch` from the locale formatter's max-magnitude sentinel.
- **Headline** (Schibsted 800, 28px): Borrow / Supply flow titles.
- **Title** (Schibsted 900, 20px): `OVRFLO` wordmark. First-run / disconnected entry prose is Schibsted 400 at 18px / line-height 1.45.
- **Body** (Schibsted 400, 15px / line-height 1.45, max ~42em on ledes): teaching copy, first-run lists, degraded explanations.
- **Label** (Martian Mono 400, 10–13px, tracking 0.08–0.14em, often uppercase): kickers (`11px`), nav (`12px` / `0.1em`), status line (`10.5px`), receipt titles (`10px` / inverted), fact rows and stream meta (`12.5–13px`), change links (`12px`).

Flow CSS uses `font-weight: 800` on titles; the loaded Grotesk files are 400/500/700/900, so 800 synthesizes.

**The Receipt Face Rule.** Amounts, APRs, addresses, timestamps, and committed receipt lines are Martian Mono with `tabular-nums`. Sentence-case prose is Schibsted. Uppercase is for controls, compact labels, and state — not body paragraphs.

## Layout

The shell is a `min(1200px, 100%)` column, `100dvh` min-height (`100vh` fallback), 1px ink rails left and right (`web/components/kit/kit.css` `.kit-shell`). Header is 56px min-height, 22px horizontal padding, 2px ink bottom rule. Body padding is 22px / 32px; header and body drop to 12px below 800px.

Watch home is a two-column split (`1fr 1fr`) with a 1.5px ink top rule. The wall has a `#ccc` right rule; detail pads 22px left. Below 1024px the split stacks and `data-narrow-detail` hides wall or detail so one pane fills the viewport; back control is 44px min-height.

Borrow and Supply default to a 720px single-decision column (28px gap). Review split (`data-split="true"`) opens to 1100px and, from 900px, `1.1fr / 0.9fr`. First-run teaching uses a 1 / 1.15 / 1 three-bay grid (28px gap) that is that surface's composition, not a global three-bay.

Spacing rhythm in use: 8 / 12 / 16 / 22 / 32px. Touch targets are ≥24px on compact chrome (copy, MAX, connect) and ≥44px on primary actions, paddles, lens tabs, amount inputs, series picks, and the narrow back control. Amount inputs are 16px on viewports under 800px (mobile zoom) and 44px at 800px and up.

URL state is client-only; the exported HTML is the parameterless shell. `dir="ltr"` is asserted on the layout. DOM source order inside a region matches the brief's aural order.

**The One Decision Rule.** Default Borrow/Supply viewports are a single column. Density (ALL RATES, converter bays, watch wall+detail) is a named surface composition, not a dashboard of peer cards.

## Elevation & Depth

The system is flat. Depth is a 1–2.5px ink (or hairline) rule, or a full inversion to ink. There are no box-shadows, blurs, glows, or glass. Modal scrim is opaque paper, not a dim overlay. Ghosted receipts use `opacity: 0.55`. Stale surface state gets a 2px ink left rule, not a warning wash.

Bitmap / dither is `radial-gradient(currentColor 1.1px, transparent 1.1px)` at `5px 5px`, used on minibands, queue parts, and rate bands — frames and fills, never as a page background behind text. Review and receipt surfaces stay untextured.

**The Flat Rule.** Do not add shadow, glow, or translucency to encode hierarchy. Invert or rule.

## Shapes

Every control is square (`border-radius: 0` on buttons, inputs, chips, receipts, paddles, lens tabs, action buttons, switches). A 2px radius is not used. Primary actions use a 2px ink border plus, when `data-variant="primary"`, a 2px gold outline offset 2px. Focus-visible is a 2px ink outline offset 2px; `:focus` without `:focus-visible` is outline none. Hairlines (`1px #ccc/#ddd`) separate rows; structural edges are 1.5–2.5px ink. Dashed 1.5px `#999` rules join settlement-trace steps.

**The Square Rule.** No pills, no cards with radius, no rounded fields. Inversion, not rounding, marks selection.

## Components

Kit lives in `web/components/kit/`. Flow pages compose it; they do not restyle a second visual world.

### Buttons

- **Shape:** square; 2px ink border; 11px 22px padding; min-height 44px; Grotesk 700 / 12px / 0.08em tracking on `.kit-action`.
- **Primary:** ink fill, gold-ink label, 2px gold outline offset 2px. Busy label is `SIGNING…`. Disabled stays visible with a reason under the control (`.kit-action-reason`, dim, 10.5px).
- **Default:** paper fill, ink border and text. Hover on the older `.button` utility inverts to ink/paper; kit action buttons do not invert on hover.
- **Connect / text actions:** unbordered, inherit the shell chip or receipt face (`CONNECT WALLET` in the header chip).

### Chips

- **Address chip:** 1.5px ink border, 7px 11px padding, Martian Mono 11px, min-height 24px. Truncates `0x` + 4, copies full value.
- **Lens tabs:** paper, 1.5px ink, no bottom border (they sit on the wall). Selected inverts to ink/paper and weight 700. Min-height 44px.
- **Rate chips:** three-up window, 1.5px ink, selected inverts to ink with gold-ink APR (19px mono 700). Selected hint and band use gold-ink / gold. Paddles are 44×44 square.

### Cards / Containers

There are no elevated cards. The receipt is the contained object: 1.5px ink box, inverted 10px title bar (`PERMISSION RECEIPT` / `ACTION RECEIPT` plus `ALWAYS TOKEN-EXACT`), 11.5px mono lines, 1px `#ddd` row rules. Entity rows are full-bleed list buttons with 1px `#ccc` bottoms; selected inverts the whole row and paints state/decisive in gold-ink.

### Inputs / Fields

- **Amount field:** no box border; 2.5px ink underline; mono tabular input; unit 20px; MAX is 11px / 700 / 0.1em. Invalid underline is `--err`. Desktop type jumps to 44px at 800px. Focus uses the kit 2px ink ring.
- **Token / USD switch:** square 1.5px ink segmented control; on-side inverts to ink/paper. USD captions are dim, never receipt lines.
- **Binary switch** (wrap/unwrap, etc.): same inversion language as lens tabs.

### Navigation

Header: 900 / 20px `OVRFLO` wordmark (home). Nav is Martian Mono 12px / 0.1em: BORROW, SUPPLY, ASSETS, RISK. Current page is a 3px ink underline and weight 700. Wallet sits in a 1.5px ink chip (11px mono) unless a connected identity cluster removes the chip border. Footer links are 11px / 0.1em mono on a `#ccc` top rule.

### Status and trace

Status line is 10.5px uppercase mono on a 1.5px ink bottom rule. Synced is dim; degraded/unavailable is ink. Settlement trace is a horizontal mono step list (active = ink 700, pending = dim, error = `--err`) joined by dashed rules. Refetch notice matches the status line, ink not dim.

### Signature: Rolling number and ribbon

Rolling numbers are inline mono 700, `tabular-nums`, width in `ch`, `role="timer"` while ticking. Decorative canvas ribbons and minibands use the 5px dot stamp; `prefers-reduced-motion` unsubscribes canvas motion while numeric text keeps updating. Live amounts are never part of a focused control's accessible name.

### Signature: Queue / capital band

16px-tall 1px ink band. Self/draw parts are gold fill; ahead/pool are `#8a8a8a`; overrun is ink with a 2px ink leading rule.

## Do's and Don'ts

### Do:

- **Do** load Schibsted Grotesk and Martian Mono from `web/app/fonts.ts` (`next/font/local`, subset woff2). Do not rely on a user-installed face or a runtime font package.
- **Do** put gold-family body text on ink (`--gold-ink`) or size gold-on-paper to display scale (36px / 44px).
- **Do** invert to mark selection (lens, row, rate, switch, primary action fill).
- **Do** keep receipts token-exact, paper, untextured, with an inverted title bar.
- **Do** honor `prefers-reduced-motion` on canvas; keep ticking numerals.
- **Do** size updating numbers in `ch` from the active locale's formatter.
- **Do** use `:focus-visible` 2px ink outline offset 2px; never a gold or glow ring.

### Don't:

- **Don't** reintroduce cyan, Inter, IBM Plex, Architectural Dark / obsidian canvas, or a tiled page grid.
- **Don't** add NOW/NEXT, NEEDS YOU, LIVE badges, or any aggregate attention strip.
- **Don't** draw a health-factor, LTV, or liquidation gauge — including as decoration.
- **Don't** put shadows, glass, blur, glow, pills, or visible color ramps on surfaces.
- **Don't** put bitmap texture behind text or on Review/receipt surfaces.
- **Don't** paint `--gold` on paper below display scale (36px / 44px). Warning copy stays ink.
- **Don't** color a number "good" or "bad"; `--ok` / `--err` are outcomes, not market sides.
- **Don't** put USD on a receipt line or in calldata. USD is a display switch.
- **Don't** use em dash `—` as a stand-in for loading, empty, or failed. Those states have copy.
- **Don't** nest another visual system on flow pages. Compose the kit.
