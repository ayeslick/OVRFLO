import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HostedConvertPanel, hostedImpactPreview } from "@/components/assets/HostedConvertPanel";
import { HOSTED_IMPACT_COPY, HOSTED_LOCAL_UNAVAILABLE_COPY } from "@/lib/hosted-convert";

vi.mock("wagmi", () => ({
  useConnection: () => ({ addresses: [], chainId: 1 }),
}));

vi.mock("@/hooks/useWriteFlow", () => ({
  useWriteFlow: () => ({ writeContract: vi.fn() }),
}));

vi.mock("@/hooks/useAcknowledgment", () => ({
  useAcknowledgment: () => ({ acknowledged: false }),
}));

describe("HostedConvertPanel", () => {
  it("shows the local-fork unavailable copy and does not offer convert", () => {
    render(<HostedConvertPanel market={null} signingAllowed />);
    expect(screen.getByText(HOSTED_LOCAL_UNAVAILABLE_COPY)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "CONVERT" })).toBeNull();
  });

  it("rejects 101 bps Default impact with the two named actions and passes 100", () => {
    expect(hostedImpactPreview(0.0101, "default")).toEqual({
      status: "reject-impact",
      copy: HOSTED_IMPACT_COPY,
      actions: ["smaller-amount", "open-advanced"],
    });
    expect(hostedImpactPreview(0.01, "default").status).toBe("pass");
    expect(hostedImpactPreview(0.0101, "advanced").status).toBe("pass");
  });
});
