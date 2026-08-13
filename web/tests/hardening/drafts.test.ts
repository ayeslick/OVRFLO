import { afterEach, describe, expect, it } from "vitest";
import type { Address } from "viem";
import { chainId, factoryAddress } from "@/lib/config";
import { parseFlowDraft } from "@/lib/parse";
import {
  clearFlowDraft,
  flowDraftKey,
  readFlowDraft,
  writeFlowDraft,
} from "@/lib/storage";

const ACCOUNT = "0x00000000000000000000000000000000000000a1";
const MARKET = "0x0000000000000000000000000000000000000d44" as Address;

describe("selections-only drafts", () => {
  afterEach(() => {
    try {
      window.localStorage.removeItem(flowDraftKey("supply", factoryAddress, chainId, ACCOUNT));
      window.localStorage.removeItem(flowDraftKey("borrow", factoryAddress, chainId, ACCOUNT));
    } catch {
      // ignore
    }
  });

  it("namespaces by factory + wallet + chain and restores selections without a quote", () => {
    const key = flowDraftKey("supply", factoryAddress, chainId, ACCOUNT);
    expect(key).toContain(factoryAddress.toLowerCase());
    expect(key).toContain(ACCOUNT.toLowerCase());
    writeFlowDraft(key, {
      amountRaw: "1.5",
      selectedAprBps: 500,
      selectedStreamId: null,
      selectedMarket: MARKET,
    });
    const restored = readFlowDraft(key);
    expect(restored).toEqual({
      amountRaw: "1.5",
      selectedAprBps: 500,
      selectedStreamId: null,
      selectedMarket: MARKET,
    });
    expect(restored).not.toHaveProperty("fill");
    expect(restored).not.toHaveProperty("ahead");
    expect(restored).not.toHaveProperty("quote");
  });

  it("keeps borrow and supply drafts independent", () => {
    writeFlowDraft(flowDraftKey("supply", factoryAddress, chainId, ACCOUNT), {
      amountRaw: "2",
      selectedAprBps: 400,
      selectedStreamId: null,
      selectedMarket: MARKET,
    });
    writeFlowDraft(flowDraftKey("borrow", factoryAddress, chainId, ACCOUNT), {
      amountRaw: "3",
      selectedAprBps: 600,
      selectedStreamId: "441",
      selectedMarket: null,
    });
    expect(readFlowDraft(flowDraftKey("supply", factoryAddress, chainId, ACCOUNT))?.amountRaw).toBe("2");
    expect(readFlowDraft(flowDraftKey("borrow", factoryAddress, chainId, ACCOUNT))?.selectedStreamId).toBe("441");
    clearFlowDraft(flowDraftKey("supply", factoryAddress, chainId, ACCOUNT));
    expect(readFlowDraft(flowDraftKey("supply", factoryAddress, chainId, ACCOUNT))).toBeNull();
    expect(readFlowDraft(flowDraftKey("borrow", factoryAddress, chainId, ACCOUNT))?.amountRaw).toBe("3");
  });

  it("refuses a stored quote blob that is not a selections draft", () => {
    expect(parseFlowDraft(JSON.stringify({ fill: "1", net: "2" }))).toBeNull();
  });
});
