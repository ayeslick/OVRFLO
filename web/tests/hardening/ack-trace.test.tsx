import { waitFor } from "@testing-library/react";
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Address } from "viem";
import { useAcknowledgeRiskTrace } from "@/components/first-run/useAcknowledgeRiskTrace";
import { ACKNOWLEDGE_RISK_STEP_ID, withAcknowledgeRiskStep } from "@/components/first-run/ackTrace";
import { chainId, factoryAddress } from "@/lib/config";
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

describe("live SETTLEMENT ack wiring", () => {
  afterEach(() => {
    try {
      window.localStorage.removeItem(
        acknowledgmentKey(chainId, factoryAddress, ACCOUNT, RISK_DISCLOSURE_VERSION),
      );
    } catch {
      // ignore
    }
  });

  it("inserts ACKNOWLEDGE RISK on the first write per wallet without rewriting the executor", async () => {
    const composed = withAcknowledgeRiskStep(BASE, { acknowledged: false, ready: true });
    expect(composed[0]?.id).toBe(ACKNOWLEDGE_RISK_STEP_ID);
    const { result } = renderHook(() => useAcknowledgeRiskTrace(BASE));
    await waitFor(() => expect(result.current.needsAcknowledgment).toBe(true));
    expect(result.current.steps[0]?.id).toBe(ACKNOWLEDGE_RISK_STEP_ID);
  });
});
