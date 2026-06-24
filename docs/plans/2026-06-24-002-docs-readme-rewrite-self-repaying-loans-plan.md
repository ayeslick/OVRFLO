---
title: "docs: Rewrite README for Self-Repaying Loans Focus"
type: docs
date: 2026-06-24
origin: docs/brainstorms/2026-06-24-readme-rewrite-self-repaying-loans-requirements.md
---

# Plan: Rewrite README for Self-Repaying Loans Focus

## Summary

Rewrite `README.md` to lead with the lending platform (OVRFLOBook) as the product and the core vault as the collateral creation mechanism. Document all 5 contracts with updated function signatures, add book user flows (sell, borrow, loan servicing), redraw the architecture diagram, and mention the Pool as roadmap. No code changes.

## Problem Frame

The current README only documents the core vault (deposit, claim, wrap, unwrap). It does not mention OVRFLOBook, StreamPricing, or the lending/borrowing flows. The product has evolved: the lending platform is the headline value proposition ("Self-Repaying Loans"), and the core is the enabling layer that creates the deterministic streaming collateral. The README needs to reflect this hierarchy. (See origin: `docs/brainstorms/2026-06-24-readme-rewrite-self-repaying-loans-requirements.md`)

---

## Requirements

- R1. README headline leads with "Self-Repaying Loans," not "Fixed Yield Collateral"
- R2. Two-layer narrative: Layer 1 (Core) creates collateral, Layer 2 (Book) facilitates lending
- R3. All 5 contracts documented with function tables: OVRFLOBook, StreamPricing, OVRFLOFactory, OVRFLO, OVRFLOToken
- R4. All function signatures match current source (post-immutables-hoist, post-oracle-hoist, post-ceiling-constants)
- R5. Book user flows documented: selling a stream, borrowing against a stream, loan servicing
- R6. Core user flows preserved: depositing, claiming, wrap/unwrap, withdrawing from stream
- R7. Admin flows updated for new constructor signatures (factory takes oracle, book takes 3 params)
- R8. Architecture diagram redrawn to show OVRFLOBook + StreamPricing alongside the core
- R9. Pool mentioned as a one-line roadmap item
- R10. Security section updated: APR ceiling hardcoded at 100% on book, core deposit fee capped at 1% on factory, StreamPricing math link, no-liquidations property
- R11. Preserved sections kept as-is: External Dependencies, Deployments, Development, Integration Guide, License
- R12. Integration Guide updated for 8-tuple `series()` destructuring

---

## Key Technical Decisions

- KTD1. Two-layer narrative structure: The lending platform is the product; the core is the collateral creation mechanism. This matches the user's framing and positions the product correctly for external readers. (See origin: Section 2)
- KTD2. ASCII art diagrams preserved: The current README uses ASCII diagrams for architecture and flows. Keep this style for consistency rather than switching to mermaid — README is viewed in raw markdown on GitHub and terminals.
- KTD3. Function table format preserved: The current README uses markdown tables for contract APIs. Keep this format for all 5 contracts for visual consistency.
- KTD4. StreamPricing documented as a library, not a contract: It's a pure library with no storage or external calls (except `requireEligible` which reads Sablier/factory). Frame it as "shared pricing primitives" rather than a deployable contract.

---

## Implementation Units

### U1. Rewrite README.md

**Goal:** Replace the current README with the new product-led structure covering all 5 contracts and the full user flow set.

**Dependencies:** None

**Files:**
- `README.md` (rewrite)

**Approach:**

Rewrite `README.md` following the section structure from the origin document (Section 3.1 through 3.10). The rewrite is a full replacement, not a patch — the narrative structure changes fundamentally.

Section order:
1. Headline + value prop ("OVRFLO enables Self-Repaying Loans")
2. How It Works (two-layer explanation + ASCII flow diagram)
3. Architecture (redrawn ASCII diagram showing all 5 contracts + externals)
4. Contracts (5 subsections with function tables, updated signatures)
5. User Flows (Creating Collateral, Selling a Stream, Borrowing Against a Stream, Loan Servicing)
6. Admin Flows (updated constructor signatures, addMarket/prepareOracle without oracle param)
7. Fee Structure (core deposit fee capped at 1% via `FEE_MAX_BPS = 100` on factory, book protocol fee capped at 100% via `MAX_FEE_BPS = 10_000` on book)
8. Security (access control, APR ceiling 100% on book, core fee cap 1% on factory, StreamPricing math, no-liquidations, slippage, two-step ownership, design notes)
9. Roadmap (Pool — one paragraph)
10. Preserved sections (External Dependencies, Deployments, Development, Integration Guide, License)

Key signature updates to apply:
- `OVRFLOFactory` constructor: `(owner, oracle)` — 2 params
- `OVRFLOFactory.addMarket`: `(ovrflo, market, twapDuration, feeBps)` — 4 params, no oracle
- `OVRFLOFactory.prepareOracle`: `(market, twapDuration)` — 2 params, no oracle
- `OVRFLOBook` constructor: `(factory, core, sablier)` — 3 params, no APR/fee ceiling
- `OVRFLOBook.APR_MAX_CEILING`: constant 10_000, not constructor param
- `OVRFLOBook.MAX_FEE_BPS`: constant 10_000, not constructor param
- `OVRFLO.setSeriesApproved`: `(market, pt, twapDuration, expiry, feeBps)` — 5 params, no oracle/underlying/ovrfloToken (requirements doc Section 3.4 says 6; actual source has 5 — plan follows source)
- `OVRFLO.series()`: 8-tuple return (synthesized from immutables)
- `OVRFLO` vault immutables: `underlying`, `ovrfloToken`, `oracle`
- StreamPricing library functions to document: `factor`, `grossPrice`, `obligation`, `obligationForFill`, `fee`, `marketActive`, `requireEligible`

**Patterns to follow:**
- Current README's ASCII diagram style (box-drawing characters)
- Current README's function table format (Function | Description)
- Current README's code example style (Solidity snippets in fenced blocks)
- `CONCEPTS.md` vocabulary: "Self-repaying loan," "Offer," "Listing," "Loan," "ovrfloToken," "PT deposit," "Claim," "Wrap," "Unwrap," "Sablier stream"

**Test scenarios:**
Test expectation: none — documentation rewrite, no behavioral change.

**Verification:**
- README renders correctly on GitHub (check markdown formatting)
- All 5 contracts have function tables
- All function signatures match source (cross-check against `src/*.sol`)
- No references to removed params (oracle in addMarket/prepareOracle, APR_MAX_CEILING/MAX_FEE_BPS as constructor params)
- Pool mentioned in roadmap
- Integration Guide uses 8-tuple `series()` destructuring

---

### U2. Verify signatures and cross-references

**Goal:** Cross-check every function signature, constructor param, and constant in the rewritten README against the actual source code.

**Dependencies:** U1

**Files:**
- `README.md` (verify, fix if needed)
- `src/OVRFLO.sol` (reference)
- `src/OVRFLOFactory.sol` (reference)
- `src/OVRFLOBook.sol` (reference)
- `src/StreamPricing.sol` (reference)
- `src/OVRFLOToken.sol` (reference)

**Approach:**

After the rewrite, systematically verify:
1. Every function in every table matches the actual function signature in source (param names, param count, return values)
2. Constructor signatures match (factory: 2 params, book: 3 params, vault: 5 params)
3. Constants match (`APR_MAX_CEILING = 10_000` on book, `MAX_FEE_BPS = 10_000` on book, `FEE_MAX_BPS = 100` on factory)
4. The `series()` 8-tuple return order matches the synthesized getter
5. The deploy script examples match `script/OVRFLO.s.sol` and `script/OVRFLOBook.s.sol`
6. The integration guide's `series()` destructuring matches the actual return order
7. External dependency addresses match (Pendle Oracle, Sablier V2 LL)

**Test scenarios:**
Test expectation: none — verification pass, no behavioral change.

**Verification:**
- Zero signature mismatches between README and source
- Zero stale references to removed constructor params
- Deploy examples match script signatures

---

## Scope Boundaries

### Deferred to Follow-Up Work

- NatSpec-level API documentation (beyond function tables) — link to source
- Frontend documentation updates — separate concern
- `CONCEPTS.md` updates beyond the "Self-repaying loan" entry already added
- StreamPricing math deep-dive — link to `plans/streampricing-math-analysis.md`
- Deployment addresses — kept as-is from current README (TBD)

### Non-goals

- No code changes to any `.sol` file
- No changes to test files
- No changes to deployment scripts
- No new documentation files beyond the README itself
