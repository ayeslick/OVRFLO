# OVRFLO Design System

## Status and Change Policy

This document records the strongest current design hypothesis, not an immutable constitution. Product truth and task clarity are stable; visual choices are replaceable when a materially better direction is demonstrated.

- No aesthetic choice is protected merely because it appears here or already exists in code.
- Proposed changes must be evaluated as rendered alternatives, not argued from adjectives.
- Comparisons include the incumbent as a baseline whenever practical.
- A selected alternative replaces the superseded rule here; the document must describe the built system rather than defend its history.
- Revisit a choice when user behavior, content density, accessibility, implementation constraints, or a stronger visual direction exposes a weakness.

## Product Expression

OVRFLO is an exact, self-repaying lending protocol. The interface must feel like financial infrastructure: quiet, legible, deterministic, and specific to streamed collateral.

The visual world is **Architectural Dark**: an obsidian technical canvas, strict graphite rules, restrained typography, and semantic cyan/gold accents. It is not a generic “crypto terminal.” Every surface must make a financial decision easier.

The page hierarchy is:

1. Choose a market.
2. Choose **Supply** or **Borrow**.
3. Review exact consequences.
4. Sign and retain a receipt.

Depositing PT, wrapping, unwrapping, claiming, and servicing positions remain available as contextual utilities. They must not compete with Supply and Borrow at the market level.

## Simplicity Contract

OVRFLO is complex; the interface must not expose that complexity all at once.

- One region has one dominant decision.
- A market may expose at most two primary actions: **Supply** and **Borrow**.
- One action gets one canonical control. Never repeat the same action in a balance row and an action band.
- Secondary utilities appear beside the balance or position they affect, or behind a clearly named disclosure.
- Conditional utilities such as `CLAIM ALL` appear only when actionable. Primary actions remain visible when disabled and state why.
- Default views show decision inputs, not every implementation detail. Full ladders, advanced repayment, and conversion utilities use progressive disclosure.
- Do not add cards, labels, borders, or explanatory copy unless they improve grouping, hierarchy, or consequence clarity.
- A screen with more than four peer choices must group, rank, or progressively disclose them.

## Canvas and Structure

- `--obsidian: #050505` is the page canvas.
- `--carbon: #111111` is reserved for selected, expanded, or interactive surfaces.
- `--graphite: #333333` defines structural rules.
- Depth comes from borders and surface shifts, never shadows, blur, or glow.
- Corners are square; a 2px radius is the absolute maximum.
- The current implementation uses a 40px root grid as a measurement metaphor. It is a candidate treatment, not a brand invariant; comparisons may reduce, replace, or remove it.
- Borders are structural, not decorative. Nested bordered containers are forbidden unless the inner boundary represents a real interactive object such as a position.
- Selected market state must remain visible while its detail is open.

## Color

Accent colors are semantic and never decorative:

- `--chalk: #f4f4f4` — neutral facts and primary text.
- `--dim: #888888` — secondary labels and captions.
- `--accent-gold: #ffcf00` — lender return, supplied liquidity, claimable yield, and Supply actions.
- `--accent-cyan: #00e5ff` — borrower proceeds, obligations, debt, and Borrow actions.
- `--positive: #4ade80` — confirmed or closed.
- `--negative: #f87171` — invalid or reverted.
- `--warning: #ffcf00` — pending or approaching maturity.

A number is colored by its side of the market, not whether it is “good” or “bad.” Never flood a surface with an accent. Use accent on the decisive number, action border, or compact status label.

## Typography

- **Display and prose:** the current implementation uses Inter, weight 400–500, tracking `-0.02em`. Future comparisons may replace it with a more distinctive, equally legible workhorse face.
- **Data and structure:** IBM Plex Mono with tabular numerals and normal tracking.
- The application must load both faces; do not rely on local installation.
- Monospace is for amounts, rates, IDs, table headers, compact labels, and transaction state—not paragraphs or brand costume.
- Use no more than four type sizes on an application surface.
- Headings must create an obvious scale step. A label cannot substitute for hierarchy.
- Uppercase is reserved for controls, compact labels, and state. Explanatory prose uses sentence case.

Inter and the canvas grid are known slop signatures in the incumbent implementation. They may survive only after an unsuppressed review presents them beside rendered alternatives and the retained version wins on task clarity and audience identification.

## Market Index

The market index is the page’s primary navigation and comparison surface.

- Market data remains a table at every breakpoint. Narrow screens scroll the table horizontally.
- The section heading explains the task, not merely the container. Prefer `SELF-REPAYING MARKETS` over repeating `MARKETS`.
- Each row shows only what supports comparison: asset, maturity, TVL, lender terms, and borrower terms.
- Lender APR and borrower upfront value are distinct lenses. Label them explicitly; never compress them into an unexplained `APR · value ↑` string.
- Expanding a market must produce a persistent selected-row treatment and repeat the asset and maturity in the detail heading.
- Only one market may be expanded at a time.
- Loading, failed, empty, and truncated are distinct states. `—` is not a substitute for a state label.

## Positions and Balances

Market data stays tabular. A user’s stateful positions may use compact `.position-card` blocks because they carry per-item progress, state, and actions.

- Position cards are the only routine card exception.
- Cards must not be nested.
- The global position summary contains at most four metrics.
- Summary actions appear in the heading and only when actionable.
- Balance utilities live beside the balance they affect.
- Advanced position servicing stays collapsed until requested.
- Progress bars always include a programmatic label and numeric value.

## Controls

- Buttons are transparent with a 1px semantic border; hover inverts foreground and background.
- Primary market actions are equal peers: gold Supply and cyan Borrow.
- Neutral utilities use chalk or dim styling and must not visually outrank primary actions.
- Disabled primary controls stay visible and include a concise reason.
- Secondary controls with no possible action may be omitted until relevant.
- Touch targets should be at least 44×44px where space permits and never below 24×24px.
- Focus uses a 2px edge treatment with no glow and no layout shift.
- Unicode glyphs must not become an ad hoc icon system. Simple disclosure markers and mathematical symbols are the only exceptions.

## Forms and Transaction Flow

- Inputs are transparent, sharp, and bordered in graphite.
- Every input and select has a persistent programmatic label.
- Numeric fields use mono text, decimal input mode, a balance line where relevant, and `MAX` only when the maximum is truthful.
- Parsing errors are distinct from zero and appear inline with `aria-invalid` and linked error text.
- Field errors never use toasts.
- Transaction steps use `[1] APPROVE  [2] SIGN  [3] CONFIRMED`.
- Every confirmation shows exact assets, amounts, fees, obligation, residual, and slippage where relevant.
- Confirmation must preserve the submitted values and end on a durable receipt until the modal closes.
- Users sign numbers, not vibes.

## Data and Copy

- Token amounts show 2 decimals by default and 4 below one unit; always include the symbol.
- Rates show 2 decimals.
- Maturity identifiers use `27JUN27`; captions use `Matures Jun 27, 2027`; countdowns use `142d 06h` only when time drives a decision.
- Addresses and IDs truncate in the middle and support copy.
- Protocol terms are acceptable only when they are the correct term. Define PT, upfront value, obligation, residual, wrap reserve, and pool share at their first decision point.
- Errors name the problem and recovery. Never expose raw exception messages.
- Empty states state what is absent. Loading states say `LOADING`; unavailable states say `UNAVAILABLE`.
- Do not use `—` for multiple semantic states.
- Copy is direct and factual. No unsupported claims, marketing filler, or invented proof.

## Motion

- Motion never blocks reading, focus, or task completion.
- Color, background, and border transitions may use `0.2s ease`.
- Market-detail entrance may use one short transform/opacity transition.
- No parallax, bounce, scale-on-hover, ambient movement, shimmer, or decorative entrance cascades.
- Reduced-motion rules target the actual animated components. Do not globally collapse every future animation to `0.01ms`.
- Live financial values update in place without flashing.

## Responsive Behavior

- The application column is at most 1200px with graphite rails.
- Desktop side padding is 2rem; narrow layouts use 1rem.
- Below approximately 800px, split panels stack and market tables scroll.
- Position cards remain cards rather than becoming table rows.
- Primary actions wrap without changing their order or semantic color.
- Modals fit the dynamic viewport and preserve access to their close control and final action.
- Compactness never justifies hiding labels, clipping values, or shrinking controls below the minimum target.

## Slop Rejection

Reject these patterns unless a future product brief explicitly replaces this design system:

- gradients, glass, blur, glow, drop shadows, soft rounded cards, pills, or floating dashboard tiles;
- decorative grid repetition outside the root measurement canvas;
- interchangeable icon-heading-description card grids;
- hero metrics, fake analytics, ornamental sparklines, or meaningless progress rings;
- monospace paragraphs used to simulate technical credibility;
- unlabeled arrows, mystery icons, decorative badges, or color without semantic meaning;
- repeated headings, repeated actions, nested panels, and borders that do not encode structure;
- every value visible at once, every action equally loud, or every empty state rendered as a dash;
- generic DeFi copy that could belong to another protocol unchanged.

## Slop Review Protocol

Slop detection is a design input, not an automatic veto and never a silent waiver.

1. Run the detector without configuration, design-system, or inline-ignore suppression for the review target.
2. Present every signature with its rule name, location, visible symptom, and likely effect on hierarchy, trust, or usability.
3. Draw up at least three materially different responses. Whenever practical these are: remove it, reinterpret it, and retain it with stronger execution.
4. Render the alternatives at the real surface viewport. Text-only rationales are insufficient for a visual choice.
5. Compare against the incumbent and state the tradeoffs. A detector finding may be retained only because its rendered execution wins—not because DESIGN.md previously allowed it.
6. Record the selected disposition here and in any local suppression, including the rationale and the condition that should reopen the decision.

Never globally disable a detector rule. Never add a local suppression before the finding and its rendered alternatives have been presented.

## Review Gate

Before shipping a surface, verify:

1. The primary decision is identifiable within five seconds.
2. No action is duplicated.
3. No region has more than four ungrouped peer choices.
4. Lender and borrower values are explicitly labeled.
5. Loading, unavailable, empty, error, and confirmed states remain distinct.
6. Every form control has a persistent accessible label.
7. The user can state what will happen on-chain before signing.
8. Confirmation leaves a durable receipt.
9. Desktop and mobile preserve the same hierarchy.
10. The unsuppressed source and rendered-page slop scans have been run.
11. Every signature has been presented with rendered alternatives and a recorded disposition.
12. Every remaining suppression is local, documented, and backed by the selected comparison.
