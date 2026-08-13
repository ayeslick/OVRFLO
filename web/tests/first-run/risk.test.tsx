import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RiskNote } from "@/app/risk/RiskNote";
import { RISK_SECTIONS } from "@/app/risk/riskCopy";

describe("/risk factual note", () => {
  it("renders the required sections without an invented pass or a score", () => {
    render(<RiskNote />);
    expect(document.querySelector('[data-control="UI-FIRST-RUN-RISK"]')).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "CONTRACT RISK" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "AUDIT STATUS" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "DEPENDENCIES" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "FIXED-SCHEDULE PROJECTIONS" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "NOT FINANCIAL ADVICE" })).toBeInTheDocument();
    expect(screen.getByText(/Smart-contract failure is possible/)).toBeInTheDocument();
    expect(screen.getByText(/does not record a named-firm attestation/)).toBeInTheDocument();
    expect(screen.getByText(/Pendle: approved PT series/)).toBeInTheDocument();
    expect(screen.getByText(/Sablier: linear streams/)).toBeInTheDocument();
    expect(screen.getByText(/Chainlink: the stETH\/USD feed/)).toBeInTheDocument();
    expect(screen.getByText(/not a price forecast/)).toBeInTheDocument();
    expect(screen.getByText(/financial, legal, or tax advice/)).toBeInTheDocument();
    expect(screen.queryByText(/audited badge/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/your funds are safe/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/health factor/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("meter")).not.toBeInTheDocument();
  });

  it("labels audit documents as documents, not guarantees, and stays readable disconnected", () => {
    render(<RiskNote />);
    expect(screen.queryByRole("button", { name: /CONNECT/i })).not.toBeInTheDocument();
    const docs = RISK_SECTIONS.find((section) => section.id === "audit-status")?.documents ?? [];
    expect(docs.length).toBeGreaterThan(0);
    for (const document of docs) {
      const link = screen.getByRole("link", { name: document.label });
      expect(link).toHaveAttribute("href", document.href);
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }
    expect(screen.getAllByText("document — not a guarantee").length).toBe(docs.length);
  });
});
