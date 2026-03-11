import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PreviewStreamCard } from "@/components/PreviewStreamCard";

describe("PreviewStreamCard", () => {
  it("renders the non-negotiable single-page card structure", () => {
    render(
      <PreviewStreamCard
        tokenId="101"
        label="PT-sUSDe Sep 2026"
        preview={{
          seriesLabel: "PT-sUSDe Sep 2026",
          withdrawableLabel: "24,480 OVRUSDC",
          endDateLabel: "30 Sep 2026",
          progressPct: 62,
          claimable: true,
        }}
      />,
    );

    expect(screen.getByRole("heading", { name: "OVRFLO #101 · PT-sUSDe Sep 2026" })).toBeInTheDocument();
    expect(screen.getByText("62% streamed")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "OVRFLO 101 streamed progress" })).toBeInTheDocument();
    expect(screen.getByText("Withdrawable:")).toBeInTheDocument();
    expect(screen.getByText("24,480 OVRUSDC")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Withdraw" })).toBeInTheDocument();
    expect(screen.getByText("Ends:")).toBeInTheDocument();
    expect(screen.getByText("30 Sep 2026")).toBeInTheDocument();
  });
});