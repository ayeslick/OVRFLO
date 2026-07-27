import { describe, expect, it } from "vitest";
import { erc20Abi as viemErc20Abi } from "viem";
import sablierVerifiedAbi from "../../../tools/envio/abi/SablierV2LockupLinear.json";
import { erc20Abi, ovrfloLendingAbi, sablierLockupAbi } from "@/lib/abis";

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
    // Widening once at the .map boundary (rather than casting every compare)
    // avoids TS2367: sablierLockupAbi is `as const`, so TS narrows
    // `entry.name` to a literal union of the names actually present, and
    // comparing that union against an absent literal is a real runtime
    // absence check that TS flags as disjoint-literal-types.
    const functionNames: string[] = sablierLockupAbi.filter((e) => e.type === "function").map((e) => e.name);
    expect(functionNames).not.toContain("calculateMinFeeWei");
  });

  it("keeps exactly the 8 StreamPricing errors in the generated lending ABI", () => {
    const allErrorNames: string[] = ovrfloLendingAbi.filter((entry) => entry.type === "error").map((entry) => entry.name);
    const errorNames = allErrorNames.filter((name) => streamPricingErrors.includes(name));
    expect(errorNames.sort()).toEqual([...streamPricingErrors].sort());

    for (const removed of ["SeriesNotApproved", "CoreNotRegistered"]) {
      expect(allErrorNames).not.toContain(removed);
    }
  });

  it("declares exactly the 4 ERC20 functions the approve-then-write flows depend on, matching viem's erc20Abi in mutability and type signature", () => {
    const names = erc20Abi.filter((entry) => entry.type === "function").map((entry) => entry.name);
    expect(names.sort()).toEqual(["allowance", "approve", "balanceOf", "symbol"]);

    for (const name of names) {
      // Compare mutability and parameter/return *types* only — viem names
      // approve's second param "amount" where lib/abis.ts uses "value" (both
      // are the standard ERC20 signature), so a name-inclusive structural
      // compare would flag that harmless difference as drift.
      expect(functionShape(erc20Abi, name)).toEqual(functionShape(viemErc20Abi, name));
    }
  });
});

function functionShape(abi: readonly unknown[], name: string) {
  const entry = findAbiFunction(abi, name);
  return {
    stateMutability: entry.stateMutability,
    inputTypes: entry.inputs?.map((param) => param.type),
    outputTypes: entry.outputs?.map((param) => param.type),
  };
}

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
