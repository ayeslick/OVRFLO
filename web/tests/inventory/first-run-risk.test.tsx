import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { getAddress } from "viem";
import { Surface } from "@/components/first-run/Surface";
import { RiskNote } from "@/app/risk/RiskNote";
import { TEACHING_SENTENCES } from "@/components/first-run/cycleCopy";
import { AcknowledgeRiskStep } from "@/components/first-run/AcknowledgeRiskStep";

const MARKET = getAddress("0xcFD848b9f6fEf552204014ac67901223AD6bf679");
const PT = getAddress("0x9cE6478EF45bB1BAAC69EFd8A3eA0ed110a43042");
const OVR = getAddress("0x1111111111111111111111111111111111111111");
const UND = getAddress("0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0");

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

const market = {
  market: MARKET,
  ptToken: PT,
  ovrfloToken: OVR,
  underlying: UND,
  expiryCached: 1_800_000_000n,
};

describe("inventory — D first-run, E risk, F acknowledgment", () => {
  it("D first-run guided path — four teaching sentences; cycle; no meter wall", () => {
    render(
      <Surface
        markets={[market]}
        selectedMarket={market}
        onSelectMarket={() => undefined}
        ovrfloSymbol={null}
        underlyingSymbol={null}
        ptBalance={{ status: "ready", value: 0n }}
        underlyingBalance={{ status: "ready", value: 0n }}
        onDismiss={() => undefined}
      />,
    );
    for (const sentence of TEACHING_SENTENCES) {
      expect(screen.getByText(sentence)).toBeInTheDocument();
    }
    expect(document.querySelector('[data-step="get-pt"]')).toHaveTextContent("GET PT");
    expect(screen.getByText("mints the market's ovrflo token")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /I ALREADY HOLD PT/i })).toHaveAttribute("href", "/assets");
    expect(screen.queryByRole("meter")).not.toBeInTheDocument();
    expect(screen.queryByText(/demonstration/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/TVL/i)).not.toBeInTheDocument();
  });

  it("E /risk factual sections; readable disconnected; no health-factor gauge", () => {
    render(<RiskNote />);
    expect(document.querySelector('[data-control="UI-FIRST-RUN-RISK"]')).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "CONTRACT RISK" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "AUDIT STATUS" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "DEPENDENCIES" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "FIXED-SCHEDULE PROJECTIONS" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "NOT FINANCIAL ADVICE" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /CONNECT/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("meter")).not.toBeInTheDocument();
    expect(screen.queryByText(/your funds are safe/i)).not.toBeInTheDocument();
  });

  it("F risk gate copy points at /risk/ and never gates reads", () => {
    render(<AcknowledgeRiskStep />);
    expect(screen.getByRole("button", { name: "I UNDERSTAND" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "VIEW FULL RISKS" })).toHaveAttribute("href", "/risk/");
    expect(screen.queryByText(/I accept liquidation/i)).not.toBeInTheDocument();
  });
});
