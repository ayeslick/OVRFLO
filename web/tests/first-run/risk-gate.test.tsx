import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AcknowledgeRiskStep, FIXED_RETURN_RISK_SENTENCE } from "@/components/first-run/AcknowledgeRiskStep";
import { factoryAddress } from "@/lib/config";
import { RISK_DISCLOSURE_VERSION } from "@/lib/default/policy";
import { acknowledgmentKey } from "@/lib/storage";

vi.mock("wagmi", () => ({
  useConnection: () => ({
    addresses: ["0x00000000000000000000000000000000000000a1"],
    chainId: 1,
    status: "connected",
  }),
}));

vi.mock("@/hooks/useAcknowledgment", () => ({
  useAcknowledgment: () => ({ acknowledged: false, ready: true, acknowledge: vi.fn() }),
}));

describe("KD17 risk acknowledgment gate", () => {
  it("keys acknowledgment by chain, factory, account, and version", () => {
    expect(acknowledgmentKey(1, factoryAddress, "0xAa", 1)).toBe(
      `ovrflo:ack:1:${factoryAddress.toLowerCase()}:0xaa:1`,
    );
    expect(acknowledgmentKey(1, factoryAddress, "0xAa", 1)).not.toBe(
      acknowledgmentKey(1, factoryAddress, "0xAa", 2),
    );
    expect(acknowledgmentKey(1, factoryAddress, "0xAa", 1)).not.toBe(
      acknowledgmentKey(1, "0x00000000000000000000000000000000000000f2", "0xAa", 1),
    );
    expect(RISK_DISCLOSURE_VERSION).toBe(1);
  });

  it("shows the four owner-pin bullets, VIEW FULL RISKS, and I UNDERSTAND", () => {
    render(<AcknowledgeRiskStep />);
    expect(screen.getByText("Contracts and external protocols can fail.")).toBeInTheDocument();
    expect(screen.getByText("Market conditions can change before confirmation.")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Self-repaying means the pledged stream satisfies the loan and does not remove asset or contract risk.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Unwrap depends on the live 1:1 wrap reserve.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "VIEW FULL RISKS" })).toHaveAttribute("href", "/risk/");
    expect(screen.getByRole("button", { name: "I UNDERSTAND" })).toBeInTheDocument();
    expect(screen.queryByText(FIXED_RETURN_RISK_SENTENCE)).not.toBeInTheDocument();
  });

  it("adds the matched-capital sentence on the Fixed Return path", () => {
    render(<AcknowledgeRiskStep path="fixed" />);
    expect(screen.getByText(FIXED_RETURN_RISK_SENTENCE)).toBeInTheDocument();
  });
});
