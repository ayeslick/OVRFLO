/**
 * Factual /risk copy. Sourced from PRODUCT.md, AUDIT.md, and docs/audit/.
 * No live safety score. No invented pass certificate.
 */

export type RiskSection = {
  id: string;
  heading: string;
  paragraphs: readonly string[];
  documents?: readonly { href: string; label: string }[];
};

const REPO = "https://github.com/ayeslick/OVRFLO/blob/main";

export const RISK_SECTIONS: readonly RiskSection[] = [
  {
    id: "contract-risk",
    heading: "CONTRACT RISK",
    paragraphs: [
      "Smart-contract failure is possible. A bug, an unexpected interaction, or a dependency failure can lock, lose, or mis-account for tokens.",
      "OVRFLO does not promise that funds are safe. This page is not a score and not a badge.",
    ],
  },
  {
    id: "audit-status",
    heading: "AUDIT STATUS",
    paragraphs: [
      "The repository records reviews. It does not record a named-firm attestation that the current contracts passed a clean audit.",
      "An internal 10-persona review produced findings. Five of those (M-01 through L-02) are marked fixed in docs/audit/audit-findings.md. Other claims were rejected and live in docs/audit/rejected-findings-record.md, including an active Low on unchecked narrowing (internal L-1), which is not the 2026-07-28 audit's L-1.",
      "An application audit dated 2026-07-28 (docs/dogfood-reports/audit-2026-07-28.md) reported High, Medium, Low, and Informational findings. Some were remediated. Some were rejected, including a Sablier-withdraw claim that does not apply to the pinned v1.1 deployment. That review is not a pass certificate.",
      "The lending market was later rewritten to a loan-only tick book. Reviews that analysed sale listings and loan pools describe a design that no longer ships. AUDIT.md documents finding-ID collisions across reviews. Treat each ID as audit-local.",
    ],
    documents: [
      { href: `${REPO}/AUDIT.md`, label: "AUDIT.md" },
      { href: `${REPO}/docs/audit/audit-findings.md`, label: "docs/audit/audit-findings.md" },
      {
        href: `${REPO}/docs/audit/rejected-findings-record.md`,
        label: "docs/audit/rejected-findings-record.md",
      },
      {
        href: `${REPO}/docs/dogfood-reports/audit-2026-07-28.md`,
        label: "docs/dogfood-reports/audit-2026-07-28.md",
      },
    ],
  },
  {
    id: "dependencies",
    heading: "DEPENDENCIES",
    paragraphs: [
      "Pendle: approved PT series and the factory TWAP oracle. OVRFLO does not trade YT or the Pendle AMM. A rotten or unverified Pendle URL is never load-bearing.",
      "Sablier: linear streams use OVRFLO Streams, a GPL fork of Sablier V2 Lockup Linear v1.1.2. Newer Sablier Lockup docs describe a different version.",
      "Chainlink: the stETH/USD feed is display-only. It never enters receipts or transaction parameters. A missing or stale feed disables USD display; it does not invent a dollar figure.",
    ],
  },
  {
    id: "projections",
    heading: "FIXED-SCHEDULE PROJECTIONS",
    paragraphs: [
      "Displayed vesting, repayment, and claimable figures interpolate immutable stream parameters — start, end, and deposited — against a local clock with a chain-time skew offset.",
      "That interpolation is not a price forecast and not a promise of token market value. Event-derived amounts change only when a chain read succeeds.",
    ],
  },
  {
    id: "not-advice",
    heading: "NOT FINANCIAL ADVICE",
    paragraphs: [
      "Nothing on this page or in the Markets app is financial, legal, or tax advice. You can lose funds.",
    ],
  },
];
