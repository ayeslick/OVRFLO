# OVRFLO Design System

## Aesthetic: "Architectural Dark" (Hyperstudio)
OVRFLO is a highly precise, technical DeFi protocol. The design language must reflect this by avoiding generic "slop" (unnecessary gradients, heavy drop shadows, bubbly shapes) in favor of an opinionated, strict, editorial, grid-based aesthetic.

### 1. Canvas & Structure
*   **Pure Black Focus:** The base background is near black (`#050505` Obsidian).
*   **Grid Lines:** Structure is dictated by strict 1px grid lines (`#333333` Graphite).
*   **No Drop Shadows:** Elevation and depth are conveyed through borders and subtle background shifts (e.g., `#111111` Carbon), not blurs or shadows.
*   **Grid Background:** A subtle 40px grid pattern overlay reinforces the technical, blueprint-like feel.

### 2. Colors
*   `--obsidian`: `#050505` (Main Background)
*   `--carbon`: `#111111` (Secondary Background / Hovers)
*   `--graphite`: `#333333` (Grid lines / Borders)
*   `--chalk`: `#f4f4f4` (Primary Text)
*   `--dim`: `#888888` (Secondary / Muted Text)
*   `--accent-cyan`: `#00e5ff` (Borrowing / Obligation actions)
*   `--accent-gold`: `#ffcf00` (Supplying / Yield actions)

### 3. Typography
The typography is split strictly by use case to establish hierarchy and intent.
*   **Display & Prose:** `Inter` (or similar clean sans-serif). Used for headers, descriptions, and buttons. Kept normal-weight (400-500); avoid heavy bolding. Tightly tracked (-0.02em) for a sharp, literary feel.
*   **Data & Structure:** `IBM Plex Mono` (or similar monospace). Used strictly for all financial data (APYs, token amounts), secondary labels, table headers, and structural elements (like ASCII diagrams).

### 4. Component Rules
*   **Tables:** Flat, border-collapse. Monospace headers (uppercase, small). Bottom borders only for rows.
*   **Buttons:** Transparent background, 1px border matching the text color. Hover states invert the colors (solid background, obsidian text).
*   **Cards:** No border-radius (or maximum 2px). Sharp edges. Wrapped in 1px graphite borders.

### 5. Layout (Tables UI)
The primary application interface uses a "Tables UI" approach. It avoids heavy dashboard cards in favor of scannable, dense data rows. User balances are clearly separated at the top, followed by interactive market depth.

### 6. Color Semantics
Accent colors are strictly semantic, never decorative:
*   **Cyan = borrow side.** Borrow APRs, obligations, outstanding debt, "Borrow" actions.
*   **Gold = lend side.** Lend APRs, offers, claimable yield, streams, "Lend" / "Supply" actions.
*   **Chalk = neutral facts.** Balances, TVL, maturities.
*   A given number is colored by which side of the book it belongs to, not by whether it is "good" or "bad".
*   **Status colors** (used sparingly, mono, small): `--positive: #4ade80` (confirmed tx, loan closed), `--negative: #f87171` (reverted tx, validation errors), `--warning: #ffcf00` (reuses gold: pending tx, approaching maturity). Status is communicated by a small mono label or 1px border tint, never by flooding a surface with color.

### 7. Split Panels & Section Dividers
*   Two-column sections (hero, borrower/lender split) are divided by a single 1px graphite vertical rule, not by gap alone. The right column gets `border-left` + generous `padding-left` (4rem); the left column gets matching `padding-right`.
*   Section labels (e.g. "SYSTEM ARCHITECTURE", "THE OVRFLO CYCLE") use the `.stat-label` treatment: mono, 0.75rem, uppercase, dim.
*   ASCII diagrams are a first-class element: monospace, chalk on obsidian, inside a labeled right-hand panel. Keep them hand-aligned and under ~40 chars wide.

### 8. Forms & Inputs
*   Inputs are transparent with a 1px graphite border, sharp corners, mono text for numeric entry. Focus state: border color shifts to chalk (or the action's accent), no glow/outline ring.
*   Amount inputs pair with a "MAX" text button (mono, dim, hover chalk) and a dim mono balance line underneath.
*   Validation errors appear as a small mono line under the field in `--negative`; the border tints to match. No toasts for field errors.
*   Disabled controls drop to `--dim` text and border at 50% opacity; cursor `not-allowed`. Never hide an action, disable it and say why in a dim mono caption.

### 9. Modals & Transaction Flow
*   Modals are sharp-cornered carbon panels with a 1px graphite border, centered on an obsidian scrim (85% opacity). No blur, no shadow.
*   Transaction lifecycle is shown as a mono step list inside the modal: `[1] APPROVE  [2] SIGN  [3] CONFIRMED`, with the active step in the action's accent color.
*   Every confirm modal shows the exact on-chain consequence in a bordered summary row (e.g. `OBLIGATION 47.10 ovrfloETH @ 4.62% APR`). Users sign numbers, not vibes.

### 10. Data Formatting
*   All numeric data is mono with `font-variant-numeric: tabular-nums` so columns align.
*   Token amounts: 2 decimal places by default, 4 for sub-1 values; always suffixed with the symbol (`120.50 ovrfloETH`). Rates rendered from bps as percent with 2 decimals (`4.62%`).
*   Amounts in the book UI are ovrfloToken-denominated (1:1 with underlying); the symbol shown is the market's ovrfloToken symbol.
*   Maturities: `27JUN27` style in identifiers, `Matures Jun 27, 2027` in captions. Countdown (`142d 06h`) only where time-to-maturity drives a decision.
*   Addresses and stream/loan/offer IDs: mono, truncated middle (`0x1a2b…9f`), click-to-copy.
*   Empty states: a dim mono line inside the bordered container (`NO ACTIVE LOANS`), never an illustration.
*   Loading: dim mono placeholders (`—` or `LOADING`) in place, no spinners or skeleton shimmer.

### 11. Motion
*   Transitions limited to `0.2s ease` on color/background/border. No movement, scaling, parallax, or entrance animations.
*   The only permitted "live" motion is data itself updating (e.g. a stream's vested amount ticking), which should update in place without flashing.

### 12. Responsiveness
*   The container is a fixed 1200px column with left/right graphite rails; below 1200px the rails hug the viewport with 2rem padding.
*   Below ~800px: split panels stack (vertical rule becomes a horizontal top border), stat grids go single-column, and tables keep their columns but scroll horizontally inside `.table-container`. Do not reflow tables into cards.
