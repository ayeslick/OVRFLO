---
date: 2026-06-26
topic: ai-auditor-methodology-overlay
---

# AI Auditor Methodology Overlay for OVRFLO

## Summary

Build a methodology-overlay companion doc that tells an AI auditor *how* to audit OVRFLO: the conceptual lens (incentives / CROPS / hyperstructure), an OVRFLO-mapped security-pattern checklist, and a multi-agent audit pipeline with a domain-routing table and finding format. Only OVRFLO-applicable content is inlined and mapped to concrete surfaces and invariant IDs; full external checklists and the evmresearch knowledge graph are linked for depth. The overlay links from `AUDIT.md`'s reading order as a companion, positioned so the auditor internalizes the method before the protocol-specific context.

## Problem Frame

The auditor context package (`AUDIT.md` + `docs/audit/` + `x-ray/`) gives an external auditor *what* OVRFLO is and *where* the risk concentrates, but not *how* to run the audit as an AI agent. The five external resources (ethskills concepts, security, audit, standards; evmresearch) collectively define a competent AI-auditor operating model: the mental models to internalize, the defensive patterns to check, a 20-domain parallel sub-agent pipeline, and a 400+-note knowledge graph for drill-down. None of that methodology is currently married to OVRFLO's surfaces. An AI auditor given only the existing package must self-assemble the audit process, decide which of the 20 domains apply, and re-derive which security patterns matter for a Pendle-wrapper vault with Sablier-stream-collateralized lending. The overlay closes that gap by curating the applicable methodology and mapping each element to a concrete OVRFLO surface or invariant.

## Key Decisions

- KD1. **Methodology overlay, not a section merge.** The overlay is a standalone companion under `docs/audit/`, linked from `AUDIT.md`, so it can be consumed independently and updated without touching the context spine.
- KD2. **Curated inlining over full reproduction.** Only OVRFLO-applicable patterns and the applicable domain subset are inlined and mapped; full external checklists and the evmresearch graph are linked for depth. The trade-off is that the overlay is self-contained for the applicable set but the auditor fetches external content for anything outside it.
- KD3. **Multi-agent pipeline as the prescribed execution model.** The overlay prescribes spawning parallel domain sub-agents per the routing table. A single-process auditor can fall back to the routing table as a linear checklist.
- KD4. **Recon stage is a pointer, not a re-specification.** The `x-ray/` package and `AUDIT.md` spine already generated this session serve as the recon stage; the overlay starts at the routing table rather than re-describing recon.
- KD5. **ERC-4626 domain included despite OVRFLO not being ERC-4626.** The vault-inflation / reserve-donation attack pattern still applies via the wrap reserve, so the domain is routed with that framing rather than excluded.
- KD6. **Baseline diff built into the finding format.** Every new finding must diff against the rejected-findings record and prior multi-agent audit report to avoid re-litigating settled conclusions (H-2, M-5, L-1, M-4 and the audit-report invariant findings).

## Requirements

**Conceptual lens (from ethskills/concepts)**

- R1. The overlay inlines the three ethskills conceptual models — nothing-is-automatic (state machine + incentives), CROPS (censorship-resistance, open source, privacy, security), and the hyperstructure test — each mapped to a concrete OVRFLO surface: no on-chain timelock or pause as a centralization vector under CROPS, `closeLoan()` liveness as an incentive-aligned automatic state transition under nothing-is-automatic, and OVRFLO as a service (not a hyperstructure) because of its multisig admin.

**Security-pattern checklist (from ethskills/security)**

- R2. The overlay inlines a curated table of the security patterns from ethskills/security that apply to OVRFLO, each row mapping pattern to OVRFLO surface to status-or-probe to invariant ID. Applicable patterns include: 18-decimal PT assumption, CEI/reentrancy (Book `nonReentrant` vs vault deposit no guard), SafeERC20 usage, fee-on-transfer absence of balance-delta check, oracle TWAP freshness (onboarding-only), vault inflation via wrap-reserve donation, access control (multisig with no on-chain timelock), MEV/sandwich on time-dependent pricing, input validation, and infinite approvals to Sablier.
- R3. Patterns that do not apply to OVRFLO (delegatecall, UUPS proxies, standard ERC-4626 share inflation) are listed as "not applicable, here's why" rather than omitted, so the auditor knows they were considered.

**Multi-agent audit pipeline (from ethskills/audit)**

- R4. The overlay prescribes the ethskills audit pipeline: recon (pointer to existing `x-ray/` + `AUDIT.md` package) then spawn parallel domain sub-agents per the routing table then synthesize findings then file Medium-and-above as GitHub issues using the prescribed finding format.
- R5. The finding format is inlined: title, severity (High / Medium / Low / Gas / Informational), affected contract and entry point, violated invariant ID, precondition and attack path, recommendation, and a diff-against-prior-review field referencing `docs/audit/rejected-findings-record.md` to avoid re-litigating settled findings.

**Domain routing table**

- R6. The overlay includes an OVRFLO routing table listing which of the 20 ethskills audit domains to spawn, with per-domain OVRFLO focus and the x-ray invariant or entry-point IDs to hand each agent. Applicable domains: general, precision-math, erc20, defi-lending, erc4626 (vault-inflation angle via wrap reserve), oracles, erc721 (Sablier stream NFTs), access-control, flashloans, dos, and governance (multisig plus two-step ownership, no on-chain timelock).
- R7. The inapplicable domains (signatures, proxies, bridges, ERC-4337, AMM, staking, assembly, chain-specific) are listed as excluded with a one-line reason each, so the auditor can confirm the cut rather than wonder whether a domain was missed.

**Knowledge graph and standards context**

- R8. The overlay links the evmresearch.io knowledge graph as a drill-down reference, flagging the areas most relevant to OVRFLO (vulnerability-patterns, exploit-analyses for lending/oracle/NFT exploits, economic-security for self-repaying-loan economics, protocol-mechanics for lending and vaults) rather than reproducing its notes.
- R9. The overlay includes a light standards-context note covering ERC-20 (`ovrfloToken`), ERC-721 (Sablier stream NFTs), and ERC-4626 (not used, with an explanation of why the vault-inflation pattern still applies via the wrap reserve), linking ethskills/standards for live EIP awareness.

**Integration with AUDIT.md**

- R10. The overlay is linked from `AUDIT.md`'s reading order as a companion, positioned after the scope snapshot and before the dependency interface contracts, so the auditor internalizes the methodology before reading the protocol-specific context.
- R11. The overlay uses the existing stable IDs (`G-/I-/X-/E-` codes and entry-point names from the regenerated `x-ray/`) in all its OVRFLO mappings, consistent with the citation graph already established in `AUDIT.md`.

## Scope Boundaries

**Deferred for later**

- A reusable cross-protocol AI-auditor `SKILL.md` operating manual. This overlay is OVRFLO-specific; generalizing it is a separate effort.

**Outside this overlay's identity**

- The inapplicable audit domains (signatures, proxies, bridges, ERC-4337, AMM, staking, assembly, chain-specific) are not routed and not inlined.
- Frontend, deployment/operational, and gas-optimization audits are out of scope; the overlay covers smart-contract security only.
- Full reproduction of the 20-domain checklists or the evmresearch knowledge graph is explicitly excluded; those are linked for depth.

## Sources / Research

- `ethskills.com/concepts/SKILL.md` — conceptual lens: nothing-is-automatic, CROPS, hyperstructure test.
- `ethskills.com/security/SKILL.md` — defensive security pattern catalog with code (decimals, CEI, SafeERC20, oracle safety, vault inflation, access control, MEV, UUPS, EIP-712/delegatecall, pre-deploy checklist).
- `ethskills.com/audit/SKILL.md` — 20-domain checklist system, parallel sub-agent methodology, routing table, finding format and severity definitions.
- `ethskills.com/standards/SKILL.md` — live ERC/EIP awareness (ERC-20, ERC-721, ERC-4626, EIP-7702, ERC-4337).
- `evmresearch.io/index` — 400+-note linked knowledge graph across seven areas (evm-internals, solidity-behaviors, vulnerability-patterns, exploit-analyses, security-patterns, protocol-mechanics, economic-security).
