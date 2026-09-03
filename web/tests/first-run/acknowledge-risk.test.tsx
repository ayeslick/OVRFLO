import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Address } from "viem";
import { AcknowledgeRiskStep } from "@/components/first-run/AcknowledgeRiskStep";
import { useAcknowledgeRiskTrace } from "@/components/first-run/useAcknowledgeRiskTrace";
import {
  ACKNOWLEDGE_RISK_STEP_ID,
  needsAcknowledgeRisk,
  withAcknowledgeRiskStep,
} from "@/components/first-run/ackTrace";
import { factoryAddress } from "@/lib/config";
import { RISK_DISCLOSURE_VERSION } from "@/lib/default/policy";
import { acknowledgmentKey } from "@/lib/storage";
import type { TraceStep } from "@/components/kit/SettlementTrace";

const ACCOUNT = "0x00000000000000000000000000000000000000a1" as Address;

vi.mock("wagmi", () => ({
  useConnection: () => ({
    addresses: [ACCOUNT],
    chainId: 1,
    status: "connected",
  }),
}));

const BASE: TraceStep[] = [
  { id: "approve", label: "APPROVE wstETH", state: "active" },
  { id: "supply", label: "SUPPLY", state: "pending" },
];

describe("acknowledge-risk helper (one-shot, writes only)", () => {
  afterEach(() => {
    try {
      window.localStorage.removeItem(
        acknowledgmentKey(1, factoryAddress, ACCOUNT, RISK_DISCLOSURE_VERSION),
      );
    } catch {
      // ignore
    }
  });

  it("inserts ACKNOWLEDGE RISK before the first approval while unacknowledged", () => {
    const steps = withAcknowledgeRiskStep(BASE, { acknowledged: false, ready: true });
    expect(steps[0]?.id).toBe(ACKNOWLEDGE_RISK_STEP_ID);
    expect(steps[0]?.state).toBe("active");
    expect(steps[1]?.state).toBe("pending");
    expect(needsAcknowledgeRisk({ acknowledged: false, ready: true })).toBe(true);
  });

  it("omits the step after acknowledge and never re-prompts", () => {
    expect(withAcknowledgeRiskStep(BASE, { acknowledged: true, ready: true }).map((step) => step.id)).toEqual([
      "approve",
      "supply",
    ]);
    expect(needsAcknowledgeRisk({ acknowledged: true, ready: true })).toBe(false);
  });

  it("does not insert before the store is ready — reads stay ungated", () => {
    expect(withAcknowledgeRiskStep(BASE, { acknowledged: false, ready: false })).toEqual(BASE);
    expect(needsAcknowledgeRisk({ acknowledged: false, ready: false })).toBe(false);
  });

  it("records once via the U6 store and never re-prompts", async () => {
    render(<AcknowledgeRiskStep />);
    const button = await screen.findByRole("button", { name: "I UNDERSTAND" });
    expect(screen.getByRole("link", { name: "VIEW FULL RISKS" })).toHaveAttribute("href", "/risk/");
    fireEvent.click(button);
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "I UNDERSTAND" })).not.toBeInTheDocument();
    });
    expect(
      window.localStorage.getItem(
        acknowledgmentKey(1, factoryAddress, ACCOUNT, RISK_DISCLOSURE_VERSION),
      ),
    ).toBe("1");

    const { result } = renderHook(() => useAcknowledgeRiskTrace(BASE));
    await waitFor(() => expect(result.current.needsAcknowledgment).toBe(false));
    expect(result.current.steps.map((step) => step.id)).toEqual(["approve", "supply"]);
  });
});
