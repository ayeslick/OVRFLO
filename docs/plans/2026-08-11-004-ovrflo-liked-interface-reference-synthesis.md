---
title: "OVRFLO liked interface reference synthesis"
type: design-reference
date: 2026-08-11
status: exploration
---

# OVRFLO Liked Interface Reference Synthesis

## Authority

These eight images are the current visual-preference authority for the Markets app. Recent dark atmospheric watch-surface explorations are not the visual target. The watch-surface product behavior may survive, but it must be expressed through the grammar extracted here.

This is a preference synthesis, not an implementation specification. Three material questions remain open at the end.

## Reference analysis

### 1. Spacious borrower decision

![ovrflo-ref-01-spacious-borrow](../../.impeccable/mocks/ovrflo-ref-01-spacious-borrow.png)

What it contributes:

- The strongest example of progressive disclosure: one stream, one amount, one rate, one outcome, one action.
- The customer's received amount is the visual center of gravity; mechanics remain subordinate.
- Cyan is not decoration. It consistently means borrower outcome and forward action.
- Generous whitespace makes a novel borrowing mechanism feel simple rather than empty.
- The two-line repayment/residual explanation communicates the complete economic story without a diagram or dense table.

Carry forward: the borrower flow's default composition, large outcome number, plain-language repayment/residual rows, and single-action bottom edge.

Do not literalize: USDC.e fixtures, exact dates, or the fee wording without live contract data.

### 2. Spacious lender decision

![ovrflo-ref-02-spacious-supply](../../.impeccable/mocks/ovrflo-ref-02-spacious-supply.png)

What it contributes:

- Supply is as simple and customer-centered as Borrow, but its focal outcome is fixed APR rather than proceeds.
- Three adjacent rates provide enough context without opening the entire order book.
- Queue position and unmatched-withdrawal behavior are present at the decision point.
- Amber provides a distinct lender/supply identity while preserving the same black-and-white base system as Borrow.
- The hierarchy is excellent: amount → rate choices → selected APR → operational facts → action.

Carry forward: lender flow hierarchy, contextual three-rate selector, large selected APR, queue fact, and amber action language.

### 3. Pure One-Bit desktop character

![ovrflo-ref-03-one-bit-desktop](../../.impeccable/mocks/ovrflo-ref-03-one-bit-desktop.png)

What it contributes:

- The highest-character reference: bitmap texture, inverse title bars, window frames, receipts, visible system state, and unapologetic monochrome contrast.
- Market table, depth ladder, supply, borrow, and transaction receipt each have an immediately recognizable responsibility.
- The transaction receipt turns wallet friction into understandable progress: approve, sign, confirmed.
- Dense information remains legible because every region has a hard boundary and a clear title.

Potentially separable qualities:

- Valuable: bitmap/dither material, inverse selections, exact receipts, visible progress, square controls, explicit region ownership.
- Potentially too literal: Apple menu bar, desktop folders, trash can, overlapping windows, faux operating-system chrome.

Carry forward only after resolving whether the literal desktop shell is liked or merely the character and state clarity inside it.

### 4. Three-bay market and rate tape

![ovrflo-ref-04-three-bay-rate-tape](../../.impeccable/mocks/ovrflo-ref-04-three-bay-rate-tape.png)

What it contributes:

- A strong expert topology: market selection, rate/depth selection, and customer action stay spatially stable.
- Inverse rows make selection unmistakable without soft color treatments.
- The selected market and rate flow directly into a ready-to-review borrow form.
- Small step progress, disclosure rows, and exact quote summary make the transaction understandable.
- It feels like a real instrument rather than a generic finance form.

Carry forward: this is a strong disclosed market/depth workspace or expert mode, not the default first-contact Borrow screen.

### 5. Positions master/detail

![ovrflo-ref-05-positions-master-detail](../../.impeccable/mocks/ovrflo-ref-05-positions-master-detail.png)

What it contributes:

- The clearest information architecture for positions: action strip, role filters, scannable list, selected row, focused detail.
- Position states are written in human language: earning, resting, close ready, claimable.
- One selected entity owns the right pane; the list remains visible for context.
- The detail pane leads with current state and actions, then moves history and contract data behind disclosures.
- Strong inversion makes the selected position legible without connector lines.

Carry forward: the structural model for Positions and the watch surface. Replace simultaneous borrower/lender content with a role lens when needed, but preserve master/detail behavior.

### 6. Flow chooser

![ovrflo-ref-06-flow-chooser](../../.impeccable/mocks/ovrflo-ref-06-flow-chooser.png)

What it contributes:

- An unusually clear connected-wallet entry: the customer's available resources determine which flows are possible.
- Borrow and Supply receive equal visual weight without mixing their information.
- Cyan and amber act as role/intent markers rather than decoration.
- Large action rows are more understandable than destination cards or protocol metrics.
- Wallet, network, and readiness details stay subordinate at the bottom.

Carry forward: empty-wallet or no-intent entry, guided first run, and possibly the role-switch transition. For wallets with positions, the watch surface can replace this chooser while keeping its clarity.

### 7. Unified supply flow

![ovrflo-ref-07-unified-supply](../../.impeccable/mocks/ovrflo-ref-07-unified-supply.png)

What it contributes:

- A refined synthesis of the spacious flow and one-bit character.
- The step trace is compact, readable, and integrated into the task rather than becoming a separate dock.
- Adjacent rate choices, selected inversion, queue visualization, operational facts, disclosure, and one action fit in one coherent column.
- Amber is strongest when used with black inversion and dot texture rather than as a flat decorative fill.
- The queue visualization gives the customer's position a literal place without becoming a full market chart.

Carry forward: likely the strongest default Supply-flow structure.

### 8. Split decision surface

![ovrflo-ref-08-split-decision](../../.impeccable/mocks/ovrflo-ref-08-split-decision.png)

What it contributes:

- The boldest composition without resorting to a desktop metaphor.
- Black holds customer context and the amount decision; white holds rate comparison and economic consequence.
- The hard vertical boundary produces real focus and gives the interface contemporary energy.
- The left progress rail explains where the customer is without dominating the page.
- It proves the one-bit material can feel modern when treated as composition rather than nostalgia.

Carry forward: a strong structural option for focused transaction steps, especially Supply and possibly Borrow review. It should not become the universal layout for Positions or Assets.

## Shared grammar

### What the references agree on

- **Base surface:** white or warm-white operating canvas, with black used for structure, inversion, or one decisive region. The app is not a dark atmospheric dashboard.
- **Hierarchy:** one customer decision dominates each default screen. Large numbers—not cards—create emphasis.
- **Shape:** square controls, thin hard rules, no rounded cards, no glass, no soft shadow stack.
- **Typography:** contemporary grotesk for questions and decisions; condensed mono/bitmap character for amounts, rates, identifiers, states, and receipts.
- **Selection:** black inversion is the primary selected state. Accent color identifies role or active operation.
- **Borrow color:** cyan is strongly associated with borrower proceeds, borrower actions, and forward movement.
- **Supply/lender color:** amber or gold is strongly associated with rate, queue placement, lender action, and claimable outcome.
- **Progressive disclosure:** default screens show the immediate decision and economic consequence; rate math, market depth, approvals, history, and contracts open only when requested.
- **Motion:** not yet visually specified by these stills. The references rely on state, contrast, and placement rather than ambient animation.
- **Density:** spacious by default; dense information is acceptable only in titled expert regions, detailed position panes, or explicit market/depth views.
- **Transaction trust:** wallet steps and receipts must name the exact action, asset, amount, permission, and result.

### Page mapping

| Surface | Primary references | Intended synthesis |
|---|---|---|
| Borrow | 1, 7, 8 | Spacious single decision; cyan outcome; optional split composition for Review |
| Supply | 2, 7, 8 | Amount then contextual rates; amber queue and action; one review action |
| Positions / Watch | 5, with 3 for character | Action strip plus role-focused master/detail; inverse selection; exact actions |
| Market/depth disclosure | 4, 3 | Three stable expert regions; inverse row selection; dense but titled |
| Empty/no-intent entry | 6 | Resource-aware Borrow/Supply paths with equal weight |
| Approvals and receipts | 3, 4, 7 | Explicit linear checkpoints and exact permission/action receipts |
| Assets converter | Prior approved three-bay converter, plus 7 | Keep converter-specific three-part relationship; do not universalize it |

## What should be discarded from recent work

- Full-dark watch surfaces.
- Atmospheric pressure maps as the primary operating shell.
- Luminous flow fields replacing core task structure.
- Generic DeFi dashboards and KPI cards.
- Simultaneous borrower and lender information on one default screen.
- Treating all pages as the same three-bay layout.
- Visual complexity that asks the customer to interpret a metaphor before acting.

## Open decisions

1. **Desktop literalism.** Is reference 3 liked for its bitmap character, inverse windows, receipts, and explicit state—or should the actual Apple-style menu bar, folders, trash, and overlapping windows return too?
2. **Role-coded color.** The reference set strongly implies cyan for Borrow and amber for Supply/Lender. Should that replace the earlier single-amber rule?
3. **Default versus expert density.** Should reference 4's three-bay market/depth view exist only behind `ALL RATES` / detailed market disclosure, while references 1, 2, and 7 govern default Borrow and Supply?

