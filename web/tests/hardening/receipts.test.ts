import { afterEach, describe, expect, it } from "vitest";
import type { Hash } from "viem";
import { factoryAddress } from "@/lib/config";
import {
  applyBalanceGuard,
  balancesMatchPreTx,
  clearReceipt,
  guardConfirmedBalances,
  readReceipt,
  RECEIPT_CONFIRMATIONS,
  reconcileReceipt,
  writeReceipt,
  type RecoverableReceipt,
} from "@/lib/receipts";

const HASH = `0x${"ab".repeat(32)}` as Hash;
const TOKEN = "0x00000000000000000000000000000000000000aa";

const stored: RecoverableReceipt = {
  hash: HASH,
  status: "confirmed",
  entityKind: "position",
  entityId: "41",
  preTxBalances: { [TOKEN]: (10n * 10n ** 18n).toString() },
};

describe("receipt recovery and anti-resurrect", () => {
  afterEach(() => {
    clearReceipt(factoryAddress, HASH);
  });

  it("requires two confirmations so a 1-block reorg cannot pin CONFIRMED", () => {
    expect(RECEIPT_CONFIRMATIONS).toBe(2);
  });

  it("recovers a stored receipt by factory-namespaced tx hash", () => {
    expect(writeReceipt(factoryAddress, stored)).toBe(true);
    expect(readReceipt(factoryAddress, HASH)).toEqual(stored);
    expect(clearReceipt(factoryAddress, HASH)).toBe(true);
    expect(readReceipt(factoryAddress, HASH)).toBeNull();
  });

  it("keeps the receipt until reads reflect the entity, then drops it", () => {
    expect(reconcileReceipt(stored, false)).toEqual(stored);
    expect(reconcileReceipt(stored, true)).toBeNull();
  });

  it("suppresses pre-transaction balances when a confirmed receipt still exists", async () => {
    const live = { [TOKEN]: 10n * 10n ** 18n };
    expect(balancesMatchPreTx(live, stored.preTxBalances)).toBe(true);
    const verdict = await guardConfirmedBalances({
      hash: HASH,
      liveBalances: live,
      preTxBalances: stored.preTxBalances,
      getTransactionReceipt: async () => ({ status: "success" }),
    });
    expect(verdict).toBe("suppress-pre-tx");
    const post = { [TOKEN]: 8n * 10n ** 18n };
    expect(applyBalanceGuard(verdict, live, post).balances).toEqual(post);
    expect(applyBalanceGuard(verdict, live, post).status).toBe("confirmed");
  });

  it("regresses to PENDING when getTransactionReceipt returns null (reorged out)", async () => {
    const live = { [TOKEN]: 10n * 10n ** 18n };
    const verdict = await guardConfirmedBalances({
      hash: HASH,
      liveBalances: live,
      preTxBalances: stored.preTxBalances,
      getTransactionReceipt: async () => null,
    });
    expect(verdict).toBe("regress-pending");
    const applied = applyBalanceGuard(verdict, live, { [TOKEN]: 8n * 10n ** 18n });
    expect(applied.status).toBe("pending");
    expect(applied.balances).not.toEqual(live);
  });

  it("accepts live balances that have moved past the pre-tx snapshot", async () => {
    const live = { [TOKEN]: 8n * 10n ** 18n };
    const verdict = await guardConfirmedBalances({
      hash: HASH,
      liveBalances: live,
      preTxBalances: stored.preTxBalances,
      getTransactionReceipt: async () => {
        throw new Error("must not re-fetch when live already moved");
      },
    });
    expect(verdict).toBe("accept-live");
  });
});
