# Capture: Clearing Ledger — Landing + Markets

Status: **capture complete — do not build until this brief is confirmed.**  
Branch intent: `feat/web-ui-polish`  
Captured: 2026-07-31  
Mode: Landing = Persuade · Markets = Operate  
World: **Clearing Ledger** (direction B)

---

## 1. Job and audience

- **Who:** Wallet-connected DeFi users (lenders, borrowers, Pendle PT holders) who already understand tokens, maturities, and signing.
- **Context:** They arrive to act on self-repaying markets, not to browse a generic DeFi dashboard.
- **Primary jobs:**
  - Landing: understand “self-repaying loans” and enter Markets.
  - Markets: pick a market → Supply or Borrow → see exact consequences → sign → keep a receipt.
- **Success:** The visitor can state what will happen on-chain before signing; no liquidation / health-factor language appears.

---

## 2. Locked decisions (do not reopen in build)

| Decision | Choice | Artifact |
| --- | --- | --- |
| Visual world | Clearing Ledger (B) | `.impeccable/mocks/ovrflo-clearing-ledger.png` (probe) |
| Composition | Markets ledger (comp 2), not prospectus or continuum | `.impeccable/mocks/ovrflo-clearing-comp-markets-final.png` |
| Mark | Hybrid B navy — three nested wave crescents, **no gold** | `.impeccable/mocks/ovrflo-mark-hybrid-b-navy.png` |
| Lockup | Wave mark **is** the first O of OVRFLO + `VRFLO` | `.impeccable/mocks/ovrflo-lockup-wave-o.png` |
| Header chrome | Logo lockup only — **no** `MARKETS` beside the logo | Header crop in final comp |
| Section title | `SELF-REPAYING MARKETS` remains the markets heading | MarketsTable / final comp |
| Rejected | O-letterform ring glyph; Interlocking Routes; Measured Blueprint as world; gold stream on mark | — |

User ratification: “THIS IS IT” on the wave-O lockup + Markets clearing composition (2026-07-31).

---

## 3. Selected direction — thesis

**Clearing Ledger:** security-paper white canvas, graphite/navy structural rules, muted gold for Supply / lender facts, muted cyan/navy for Borrow / borrower facts, humanist grotesk for prose, tabular mono for amounts/rates/IDs. Brand identity is the nested-wave mark reading as OVRFLO’s first O. The Markets surface is a ruled ledger: position strip → self-repaying markets table → one expanded settlement with exactly two equal actions (SUPPLY / BORROW).

Incumbent **Architectural Dark** is evidence and anti-reference for this rebuild — do not polish the dark theme toward paper; replace tokens and surfaces.

---

## 4. Direction contract (paste into root layout body on build)

```
THESIS: OVRFLO Markets as a securities clearing ledger — exact self-repaying terms on paper, not a crypto terminal.
OWN-WORLD: Security-paper white, navy ink, graphite rules, muted gold Supply / cyan Borrow, wave-mark-as-O lockup, no tiled grid, no glow/glass/shadow cards.
STORY: Choose a market, choose Supply or Borrow, review exact obligation/residual, sign, keep a receipt.
FIRST VIEWPORT: Slim lockup header (no MARKETS label) → four-metric YOUR POSITIONS → SELF-REPAYING MARKETS table with one expansion and equal SUPPLY/BORROW.
FORM: Clearing Ledger (user-pinned direction B); seed: session 2026-07-31 feat/web-ui-polish.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
```

---

## 5. Non-literal (never ship from comps)

Comps may still show generative noise. Builders must omit or replace:

- Account Health / Health Factor / Available Credit as liquidation health
- Liquidation LTV, auction discount, Chainlink oracle
- “Borrow APY” as a peer to lender APR (correct lenses: **Lender APR** and **Borrower upfront value**)
- Guilloche / register ornaments as primary content (optional sparse register marks only if they stay subordinate)
- Fake USD hero metrics presented as live protocol TVL without a real feed
- Duplicate `MARKETS` next to the logo

Product truth remains: self-repaying streams, no liquidations, no health factors; indexer is discovery hint only.

---

## 6. Implementation inventory (medium gate)

| Visible ingredient | Implementation medium | Notes |
| --- | --- | --- |
| Wave mark (standalone) | Authored PNG/SVG from approved `.impeccable/mocks/ovrflo-mark-hybrid-b-navy.png` | Transparent; favicon sizes derived |
| OVRFLO lockup | Semantic HTML: `<img>` mark + text `VRFLO` **or** single composed asset from `ovrflo-lockup-wave-o.png` | Prefer HTML+CSS for a11y (`OVRFLO` accessible name); optical gap/overshoot from lockup craft |
| Paper canvas / rules | CSS tokens in `web/app/globals.css` | Replace obsidian/carbon/graphite dark system |
| Humanist grotesk | Self-hosted webfont (not Inter) | Pair with IBM Plex Mono (or equal) for data only |
| Header | `MarketsApp` topbar | Lockup left; wallet/network right; no MARKETS label |
| YOUR POSITIONS strip | `PositionSummary` | ≤4 metrics; product-true labels only |
| SELF-REPAYING MARKETS table | `MarketsTable` | Keep tabular; expand one row |
| Settlement + SUPPLY/BORROW | `MarketRowDetail` / action flows | Equal peer actions; gold vs cyan semantics |
| Landing (Persuade) | New or migrated route from `mockups/landing-v3.html` content + Clearing Ledger tokens | Same lockup/world; CTA into Markets |
| Guilloche background | **Accepted omission** | Decorative in comps; not required |
| Vertical “CLEARING LEDGER” rail | Optional CSS; omit if it harms scanability | Not required for Operate clarity |

---

## 7. Scope and boundaries

**In scope**

- Landing + Markets visual world replacement to Clearing Ledger
- Logo lockup (wave-as-O) and favicon set from approved mark
- Token, type, header, summary, table, expand, Supply/Borrow affordances
- Preserve working wallet, reads, writes, and product copy truth

**Out of scope / untouched**

- Solidity / lending math
- Inventing health factors or liquidation UX
- Rewriting factual protocol copy without ask
- Polishing Architectural Dark instead of replacing it

**Anti-goals**

- Generic dark crypto terminal
- Icon+card marketing grids
- MARKETS duplicated in the header
- Inter + 40px tiled grid as brand atmosphere

---

## 8. States and ranges

- Markets list: empty / loading / error / truncated / ready (already distinct in app — preserve)
- Position strip: disconnected vs connected; claim utilities only when actionable
- Expanded market: settlement terms + Supply + Borrow; disabled primary stays visible with reason
- Tx flow: approve → sign → confirmed receipt (existing ActionModal contract)

Realistic density: few markets at launch; table must still work with one expanded row and horizontal scroll on narrow viewports.

---

## 9. Interaction and layout (intent)

1. Header identity (lockup) + wallet
2. YOUR POSITIONS (≤4 cells)
3. SELF-REPAYING MARKETS table — compare assets
4. Expand one market — settlement + SUPPLY | BORROW
5. Modal/flow for the chosen action — exact numbers — receipt

Narrow: stack summary; table scrolls horizontally; actions keep order and semantic color.

---

## 10. Build sequence (when build is authorized)

1. Export mark/lockup/favicons from `.impeccable/mocks/` into `web/public/` (only then).
2. Retoken `globals.css` to paper/ink/rule/muted gold/cyan; remove `grid-bg` tiled canvas.
3. Load distinct grotesk + keep mono for data; drop Inter as display default.
4. Update `MarketsApp` brand to wave-O lockup; no header MARKETS.
5. Restyle summary, table, detail, buttons to ledger rules (no behavior rewrites).
6. Landing surface in the same world; CTA to Markets.
7. Insert direction-contract HTML comment as first child of `body` in root layout.
8. Bounded desktop+mobile inspect → finish reviewer → documenter rewrites `DESIGN.md` from the built world.

---

## 11. Open decisions for the builder (must not invent silently)

- Exact webfont family for humanist grotesk (must not be Inter; pick one and record in DESIGN.md at finish).
- Landing URL structure (`/` landing + `/markets` app vs markets-first with landing section) — confirm at build kickoff if unset.
- Whether vertical clearing-ledger rail appears in production (default: **omit**).

---

## 12. Artifact index

| Path | Role |
| --- | --- |
| `.impeccable/mocks/ovrflo-direction-comparison.md` | World A/B/C; B selected |
| `.impeccable/mocks/ovrflo-clearing-ledger.png` | Original B probe |
| `.impeccable/mocks/ovrflo-clearing-comp-markets-final.png` | **Approved composition** |
| `.impeccable/mocks/ovrflo-clearing-comp-markets-final.json` | Approval sidecar |
| `.impeccable/mocks/ovrflo-mark-hybrid-b-navy.png` | **Approved mark** |
| `.impeccable/mocks/ovrflo-lockup-wave-o.png` | **Approved lockup** |
| `.impeccable/mocks/ovrflo-clearing-comp-approval.md` | Approval log |
| `.impeccable/surfaces/web-app-page-tsx.md` | Surface brief |
| `docs/plans/2026-07-31-001-capture-clearing-ledger-landing-markets.md` | This capture |

---

## Confirm

Reply **confirm capture** to freeze this as the build brief, or list corrections.  
**Do not implement UI until confirmation.**
