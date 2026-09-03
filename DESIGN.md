---
name: OVRFLO Markets
description: Calm, guided position management for self-repaying loans and fixed returns
mode: operate
creative_north_star: A calm path through one economic choice at a time
colors:
  canvas: "#F6F8FC"
  surface: "#FFFFFF"
  ink: "#0B1F3A"
  muted: "#627187"
  border: "#D9E2EF"
  control_border: "#8094AD"
  primary: "#1769E0"
  primary_hover: "#0F56C2"
  primary_soft: "#EAF2FF"
  loan: "#2B7DE9"
  loan_soft: "#E8F2FF"
  fixed_return: "#218A62"
  fixed_return_soft: "#E8F6F0"
  success: "#16815C"
  success_soft: "#E8F6F0"
  warning: "#9A5A00"
  warning_soft: "#FFF4DF"
  error: "#C93737"
  error_soft: "#FDECEC"
  disabled_surface: "#EEF2F7"
  focus: "#2563EB"
typography:
  display: { fontFamily: "Schibsted Grotesk, ui-sans-serif, system-ui, sans-serif", fontSize: "40px", fontWeight: 700, lineHeight: 1.08, letterSpacing: "-0.03em", fontFeatureSettings: "\"tnum\" 1" }
  headline: { fontFamily: "Schibsted Grotesk, ui-sans-serif, system-ui, sans-serif", fontSize: "30px", fontWeight: 700, lineHeight: 1.18, letterSpacing: "-0.025em" }
  title: { fontFamily: "Schibsted Grotesk, ui-sans-serif, system-ui, sans-serif", fontSize: "20px", fontWeight: 700, lineHeight: 1.25, letterSpacing: "-0.015em" }
  body: { fontFamily: "Schibsted Grotesk, ui-sans-serif, system-ui, sans-serif", fontSize: "15px", fontWeight: 400, lineHeight: 1.5, letterSpacing: "-0.01em" }
  label: { fontFamily: "Schibsted Grotesk, ui-sans-serif, system-ui, sans-serif", fontSize: "13px", fontWeight: 500, lineHeight: 1.35, letterSpacing: "0" }
  numeric: { fontFamily: "Schibsted Grotesk, ui-sans-serif, system-ui, sans-serif", fontSize: "16px", fontWeight: 500, lineHeight: 1.3, letterSpacing: "-0.01em", fontFeatureSettings: "\"tnum\" 1, \"lnum\" 1" }
radii:
  control: "10px"
  card: "16px"
  panel: "20px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  xxl: "48px"
layout:
  compact_max: "767px"
  wide_min: "1024px"
  hub_max_width: "1160px"
  focused_max_width: "720px"
  gutter_compact: "16px"
  gutter_wide: "24px"
  grid_gap: "16px"
components:
  button-primary: { backgroundColor: "{colors.primary}", textColor: "{colors.surface}", typography: "{typography.label}", borderRadius: "{radii.control}", minHeight: "44px", padding: "11px 20px", boxShadow: "none" }
  button-primary-hover: { backgroundColor: "{colors.primary_hover}", textColor: "{colors.surface}", typography: "{typography.label}", borderRadius: "{radii.control}", minHeight: "44px", padding: "11px 20px" }
  button-primary-pressed: { backgroundColor: "{colors.primary_hover}", textColor: "{colors.surface}", typography: "{typography.label}", borderRadius: "{radii.control}", minHeight: "44px", padding: "11px 20px" }
  button-primary-disabled: { backgroundColor: "{colors.disabled_surface}", textColor: "{colors.muted}", typography: "{typography.label}", borderRadius: "{radii.control}", minHeight: "44px", padding: "11px 20px" }
  button-secondary: { backgroundColor: "{colors.surface}", textColor: "{colors.primary}", typography: "{typography.label}", border: "1px solid {colors.control_border}", borderRadius: "{radii.control}", minHeight: "44px", padding: "11px 20px" }
  card: { backgroundColor: "{colors.surface}", textColor: "{colors.ink}", border: "1px solid {colors.border}", borderRadius: "{radii.card}", padding: "24px", boxShadow: "0 10px 32px rgba(15, 39, 74, 0.08)" }
  collection-row: { backgroundColor: "{colors.surface}", textColor: "{colors.ink}", borderBottom: "1px solid {colors.border}", minHeight: "64px", padding: "14px 16px" }
  status-info: { backgroundColor: "{colors.primary_soft}", textColor: "{colors.ink}", typography: "{typography.label}", borderRadius: "999px", minHeight: "24px", padding: "3px 9px" }
  status-success: { backgroundColor: "{colors.success_soft}", textColor: "{colors.ink}", typography: "{typography.label}", borderRadius: "999px", minHeight: "24px", padding: "3px 9px" }
  status-warning: { backgroundColor: "{colors.warning_soft}", textColor: "{colors.ink}", typography: "{typography.label}", borderRadius: "999px", minHeight: "24px", padding: "3px 9px" }
  status-error: { backgroundColor: "{colors.error_soft}", textColor: "{colors.ink}", typography: "{typography.label}", borderRadius: "999px", minHeight: "24px", padding: "3px 9px" }
  amount-field: { backgroundColor: "{colors.surface}", textColor: "{colors.ink}", typography: "{typography.numeric}", border: "1px solid {colors.control_border}", borderRadius: "{radii.control}", minHeight: "56px", padding: "12px 14px", focusColor: "{colors.focus}" }
---

# Design System: OVRFLO Markets

## Overview

**Creative north star: A calm path through one economic choice at a time.**

OVRFLO Markets is a guided position manager. It helps a connected wallet understand what it owns, choose one meaningful economic action, and complete that action with exact consequences visible before signing. It is not a trading terminal or a metrics dashboard.

This file is the normative visual and interaction system. The approved frontend boards are acceptance evidence for it. They are not a fallback source for implementation-time token changes. Any token change requires an explicit design-system revision here before implementation. Agent cockpit: `docs/agents/system.md`.

Default and Advanced are disclosure levels over the same current destination. They share tokens, position identities, action intent, transaction feedback, accessibility behavior, and responsive structure. Advanced may reveal exact protocol controls when product truth supports them. It is not a separate theme, alternate home, or license to invent Dashboard or Markets destinations.

Amounts default to USD for the selected column's underlying. The customer can switch to token units. Signing stays token-native. A missing USD quote hides dollars for that column and does not invent a figure.

**Key characteristics:**

- Cool near-white canvas and white surfaces.
- Deep navy text with cobalt actions.
- Blue Self-Repaying Loan identity and green Fixed Return identity.
- Exact token-native consequences before signing.
- USD as the default display for the selected column.
- One active economic decision at a time.
- Clear incomplete, waiting, failed, and recovery states.

## Colors

The palette is calm and functional. Color identifies actions, product types, and outcomes without implying investment performance.

- **Canvas** supports the page background.
- **Surface** supports cards, collections, controls, review panels, and sheets.
- **Ink** is the default text and strong-icon color.
- **Muted** is reserved for secondary explanation and metadata. It must still meet the applicable contrast requirement.
- **Border** is decorative separation for cards, collections, and dividers.
- **Control border** marks interactive boundaries such as fields, secondary buttons, radios, and selectors.
- **Primary** marks the current navigation item, purposeful links, progress, selection, and the main action.
- **Loan** and **Fixed Return** identify position types. They do not indicate favorable or unfavorable performance.
- **Success**, **Warning**, and **Error** color the icon and use their matching soft background. Status text remains Ink.
- **Disabled surface** supports unavailable controls. Disabled text remains legible and a nearby reason explains the state.
- **Focus** is a visible keyboard focus ring distinct from selection.

Never rely on hue alone. Pair every state with an icon and plain label.

## Typography

Schibsted Grotesk is the interface workhorse in the shipped 400, 500, 700, and 900 weights. Use 400, 500, and 700 for the interface. Reserve 900 for a verified wordmark asset if that asset requires it. Do not synthesize weight 600.

- **Display** carries large amounts and decisive outcomes.
- **Headline** carries page titles and the current step question.
- **Title** carries card, collection, and position names.
- **Body** carries explanations and recovery guidance.
- **Label** carries navigation, fields, badges, and controls.
- **Numeric** carries token amounts, dates, APRs, balances, and progress with lining tabular numerals.

Use sentence case for actions and guidance. Use title case for product types and page titles. Keep token units adjacent to their values. Preserve at least 16px input text on mobile. Keep explanatory text near a 65–75 character measure.

Martian Mono is allowed only for narrow technical identifiers in Advanced, such as full addresses, hashes, calldata, and exact protocol IDs. It is not the navigation, card-title, amount, or receipt face.

## Layout

The application uses a centered hub container up to 1160px and a focused task container up to 720px. Compact gutters are 16px. Wide gutters are 24px. Grid gaps are 16px.

At 1024px and wider, the welcome banner spans the hub. The two position-type cards occupy equal columns. Help sits below the type cards. Below 1024px, these regions stack in source order. At 767px and below, controls and collections use the compact single-column treatment without horizontal page overflow.

Desktop create flows show the active decision surface plus a compact summary of completed choices. The six-card board documents sequence. It is not a simultaneous production layout. Mobile shows one decision surface at a time, full-width controls, a clear Back action, and safe-area padding where content meets viewport edges. Review remains its own step.

### Navigation and modes

Default navigation labels are exactly `Your OVRFLO` and `Create`. `Portfolio` is not an alternate Default label. Wallet and network remain visible but secondary.

`Go to Advanced` is available from desktop account navigation and the mobile menu on every Default route. The hub help panel may repeat it. Advanced exposes `Return to Default` in the same global location. A mode change preserves the current object or task when the destination supports it. Otherwise it routes to the closest truthful parent and explains the change.

Destination URLs use a trailing slash. Advanced writes no path and no query param. Refresh on a destination lands in Default. `?lens=` is ignored and stripped. Unknown query keys must not crash. Pre-CS4 shapes have no compatibility redirects.

| Destination | URL | Notes |
|---|---|---|
| Your OVRFLO hub, empty, or incomplete scan | `/` | Incomplete scan does not change the path and does not write matrix query params from a provisional count |
| Self-Repaying Loan collection | `/?type=loan` | Written only after complete hydration on `/` |
| Self-Repaying Loan detail | `/?lending=<market>&loan=<id>` | Identity stays `(lending, id)` |
| Fixed Return collection | `/?type=fixed` | Written only after complete hydration on `/` |
| Fixed Return detail | `/?lending=<market>&position=<id>` | Same identity rule as today |
| Create (type not yet chosen) | `/create/` | Empty-portfolio Create and the Create nav item land here |
| Create Self-Repaying Loan | `/borrow/` | Existing page. `?stream=` and `?step=` stay |
| Create Fixed Return | `/supply/` | Existing page. `?step=` stays |
| Wrap, unwrap, PT deposit | `/assets/` | Existing page |
| Risk | `/risk/` | Unchanged |
| Default vs Advanced | no path or query change | Disclosure only. `Return to Default` is the control. Browser Back does not toggle disclosure. Refresh lands in Default on the same destination |

Query keys that survive: `?lending=`, `?loan=`, `?position=`, `?stream=`, `?step=`, `?type=` (`loan` or `fixed` only). Transaction checkpoints remain unenterable from history.

After route or stage navigation, focus moves to the new surface heading. Inline refresh, validation, and transaction-status updates retain focus and announce through a concise live region. Back returns focus to the control that opened the prior surface.

### Portfolio routing and trust

On-chain enumerable books supply stream, loan, supply, and resting-request ids. Each id becomes a position only after direct on-chain hydration confirms ownership, type, status, and amount.

Route to empty, detail, collection, or mixed-type hub only after those books are complete and every row is hydrated. While a book is partial or retrying, keep a stable incomplete `Your OVRFLO` surface. Preserve confirmed cards. Never route from a provisional count.

After complete hydration:

1. Zero positions shows the empty portfolio state and Create.
2. One position routes to its detail.
3. Multiple positions of one type route to that type's collection.
4. Multiple position types show the `Your OVRFLO` hub.

Never sum positions with different token symbols. Aggregate only positions with the same underlying. When underlyings differ, show the count and group collection totals by underlying.

## Elevation & Depth

Cards use restrained ambient elevation on the cool canvas. Collections may rely on the decorative border instead. Do not combine a prominent border with a wide shadow. Nested content uses spacing, dividers, or a soft tint rather than another elevated card.

A card border is decorative and uses Border. Any boundary that communicates interactivity uses Control border.

Motion confirms a state change rather than decorating an idle screen. Use restrained 140–220ms ease-out transitions for selection, disclosure, progress updates, and confirmed status. Remove nonessential motion under `prefers-reduced-motion: reduce`. Do not use ambient movement, ticking numerals, confetti, parallax, looping gradients, or repeated card entrances.

## Shapes

Controls use a 10px radius. Cards use a 16px radius. Major panels may use a 20px radius. Status badges are pill-shaped. Moderate rounding is shared across Default and Advanced.

Use one rounded-outline icon family with a 1.75px stroke and rounded caps. A standard medallion is 40px with a 20px icon. A compact medallion is 32px with a 16px icon. Loan uses water/drop geometry. Fixed Return uses stable/growth geometry. Use verified brand assets when current files provide them. Otherwise keep branding path-agnostic and do not invent asset filenames.

## Components

### Position identities

A **Self-Repaying Loan** is borrowed value now with deterministic repayment from an eligible stream. Show the exact amount received or obligation, amount remaining, repayment progress, qualified completion timing, status, and valid next action. Progress is not a risk meter.

A **Fixed Return** is the Default presentation of an OVRFLOLending supply position. The user supplies ovrfloToken to a selected APR tick. Before match, the funds rest, remain withdrawable, and show `Waiting`; do not promise the target return. `No borrower demand yet` is a waiting supply state. After match, show the exact contractual return and date only when authoritative position and loan reads establish them. PT acquisition is not the Default Fixed Return position. It may remain an Advanced conversion primitive only when product truth supports it.

Canonical lifecycle labels are `Active`, `Working`, `Waiting`, `Completed`, `Unavailable`, and `Failed`. Surface briefs map protocol states to these labels and add explanation. They do not invent badge synonyms.

### Create flows

Both position types use the adaptive grammar `SOURCE → UNDERLYING → AMOUNT → TERM → OUTCOME → REVIEW`.

- Source appears only for a meaningful source choice.
- Underlying appears only when multiple supported assets exist.
- Amount remains unless the source fixes it exactly.
- Term appears only when multiple valid terms exist.
- Outcome appears only when multiple valid outcomes exist.
- Review never hides.
- Zero valid options produce a named blocking state.

When an upstream choice changes, preserve a downstream value only if it remains valid. Clear every invalid dependent value. Recompute stage visibility. Move to the first newly required or blocking stage before Review.

Self-Repaying Loan Review states the exact asset used, amount received, obligation, relevant date, fees, and current executable availability. Fixed Return Review states the exact ovrfloToken supplied, selected APR tick, resting or matched status, withdrawability while resting, and any authoritative contractual return/date. Default hides PT, route, approval, calldata, and protocol internals.

### Amount fields

Use a labeled decimal input with `inputmode="decimal"`, visible asset unit, balance, optional Max action, and associated error text. Accept a dot or the active locale decimal separator only when unambiguous. Reject mixed conventions and grouping separators. Normalize to an ASCII decimal string using the asset's declared decimals. Never parse an execution amount through JavaScript `Number`.

### Actions and controls

One primary action is a maximum, not a requirement. Quote-refreshing and transaction-pending states may have no primary action. Permit at most one secondary button. Explorer and learning destinations are optional text actions and do not count as competing primary controls.

Primary button hover uses Primary hover. Pressed keeps that color and uses a restrained pressed treatment without changing size. Disabled uses Disabled surface, retains a legible label, and has a nearby explanation. Focus uses a 2px Focus ring with enough offset to remain visible. Secondary controls use Control border; hover may use Primary soft without dark inversion.

Choice rows use native radio behavior when selection is exclusive. The full row is at least 44px high. Selection uses control state, icon, and Primary soft rather than full dark inversion.

### Status and recovery

Status badges use their semantic soft background with Ink text. The icon and label carry state. The badge never carries the only explanation of a blocked action.

Every state answers: what happened, what remains true, and what the user can do next. If a previously valid action becomes obsolete, disable it, explain why, and preserve any authoritative recovery action. Do not expose retired implementation details as durable product language.

Loading, stale, unavailable, failed, incomplete, and empty are separate states. A failed read never becomes zero. A quote refresh keeps entered choices visible and suppresses stale submission.

### Review, runtime, and finality

Reviewed values must equal submitted values. If a quote, route, amount, fee, or deadline changes, return to a current Review before submission. Default and Advanced must resolve to the same mode-neutral action intent before calldata.

A transaction is confirmed only after a successful receipt reaches `RECEIPT_CONFIRMATIONS`, currently 2. A first-mined receipt remains pending. A position may display Completed, settled, closed, or repaid only after the final receipt threshold and a fresh authoritative state read establish that state.

Default may summarize an internal action graph as one user outcome. It must still show partial completion truthfully and offer only a valid continuation or recovery. Transaction milestones announce without moving focus.

### Exits

PT claim and unwrap are separate exits. PT claim requires maturity and sufficient PT backing. Unwrap is available whenever `OVRFLOReserve` and the wallet's ovrfloToken balance permit one-to-one redemption. Never describe unwrap as maturity-only.

## Do's and Don'ts

### Do

- **Do** guide the user from a confirmed position to one valid next action.
- **Do** keep confirmed cards visible during partial portfolio discovery.
- **Do** group financial totals by underlying when token symbols differ.
- **Do** expose Advanced globally while preserving the current object or task.
- **Do** use exact token units wherever an amount affects a decision.
- **Do** explain why a resting Fixed Return remains withdrawable and why no return is promised before match.
- **Do** preserve completed and waiting positions in portfolio navigation.
- **Do** use the same visual, action, finality, and accessibility system in Default and Advanced.

### Don't

- **Don't** treat the frontend boards as permission to revise tokens during implementation.
- **Don't** present a Pendle PT purchase as the Default Fixed Return position.
- **Don't** route from a provisional portfolio count or call partial history empty.
- **Don't** sum unlike token symbols.
- **Don't** show all six create stages as simultaneous production cards.
- **Don't** invent Dashboard or Markets navigation without product or active-surface authority.
- **Don't** use APY, health factor, LTV, or liquidation framing in Default.
- **Don't** reveal hidden Default mechanics through Details, transaction copy, or errors.
- **Don't** let USD, cached discovery data, or stale quotes become execution authority.
- **Don't** create a second visual system inside Advanced, mobile, errors, or create flows.
