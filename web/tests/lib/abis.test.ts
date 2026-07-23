import { describe, expect, it } from "vitest";
import sablierVerifiedAbi from "../../../tools/envio/abi/SablierV2LockupLinear.json";
import { ovrfloLendingAbi, sablierLockupAbi } from "@/lib/abis";

const sablierFunctions = [
  "withdrawMax",
  "withdraw",
  "getRecipient",
  "withdrawableAmountOf",
  "getDepositedAmount",
  "getWithdrawnAmount",
  "approve",
  "getApproved",
  "isApprovedForAll",
  "transferFrom",
  "ownerOf",
];

const streamPricingErrors = [
  "MarketNotApproved",
  "WrongSender",
  "WrongAsset",
  "WrongEndTime",
  "SeriesMatured",
  "CliffPresent",
  "CancelableStream",
  "RemainingZero",
];

describe("ABI drift checks", () => {
  it("keeps the hand-written Sablier ABI in sync with the vendored verified ABI", () => {
    for (const name of sablierFunctions) {
      const local = findAbiFunction(sablierLockupAbi, name);
      const verified = findAbiFunction(sablierVerifiedAbi, name);
      expect(local).toEqual({
        type: verified.type,
        name: verified.name,
        stateMutability: verified.stateMutability,
        inputs: verified.inputs?.map(({ name: inputName, type }) => ({ name: inputName, type })),
        outputs: verified.outputs?.map(({ name: outputName, type }) => ({ name: outputName, type })),
      });
    }
  });

  it("does not include calculateMinFeeWei on Sablier v1.1.2", () => {
    expect(sablierLockupAbi.some((entry) => entry.type === "function" && entry.name === "calculateMinFeeWei")).toBe(
      false,
    );
  });

  it("keeps exactly the 8 StreamPricing errors in the generated lending ABI", () => {
    const errorNames = ovrfloLendingAbi
      .filter((entry) => entry.type === "error")
      .map((entry) => entry.name)
      .filter((name) => streamPricingErrors.includes(name));

    expect(errorNames.sort()).toEqual([...streamPricingErrors].sort());
    expect(ovrfloLendingAbi.some((entry) => entry.type === "error" && entry.name === "SeriesNotApproved")).toBe(false);
    expect(ovrfloLendingAbi.some((entry) => entry.type === "error" && entry.name === "CoreNotRegistered")).toBe(false);
  });
});

function findAbiFunction(abi: readonly unknown[], name: string) {
  const entry = abi.find(
    (item): item is { type: string; name: string; stateMutability?: string; inputs?: AbiParam[]; outputs?: AbiParam[] } =>
      Boolean(
        item &&
          typeof item === "object" &&
          "type" in item &&
          item.type === "function" &&
          "name" in item &&
          item.name === name,
      ),
  );
  if (!entry) throw new Error(`Missing ABI function ${name}`);
  return {
    type: entry.type,
    name: entry.name,
    stateMutability: entry.stateMutability,
    inputs: entry.inputs?.map(({ name: inputName, type }) => ({ name: inputName, type })),
    outputs: entry.outputs?.map(({ name: outputName, type }) => ({ name: outputName, type })),
  };
}

type AbiParam = { name: string; type: string };
