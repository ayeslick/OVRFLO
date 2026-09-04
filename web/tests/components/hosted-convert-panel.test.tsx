import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HostedConvertPanel } from "@/components/assets/HostedConvertPanel";
import { HOSTED_LOCAL_UNAVAILABLE_COPY } from "@/lib/hosted-convert";

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
});
