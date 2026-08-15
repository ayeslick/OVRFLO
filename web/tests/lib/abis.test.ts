import { describe, expect, it } from "vitest";
import { erc20Abi as viemErc20Abi } from "viem";
import { erc20Abi, ovrfloLendingAbi, sablierLockupAbi } from "@/lib/abis";

const requiredStreamFunctions = [
  "balanceOf",
  "tokensOfOwnerIn",
  "ownerOf",
  "getStream",
  "withdrawableAmountOf",
  "statusOf",
  "tokenURI",
  "withdrawMax",
  "withdraw",
  "approve",
  "getApproved",
  "isApprovedForAll",
  "transferFrom",
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
  it("exposes Enumerable + hydration reads on the fork OVRFLOStream ABI (KTD8)", () => {
    const functionNames: string[] = sablierLockupAbi
      .filter((e) => e.type === "function")
      .map((e) => e.name);
    for (const name of requiredStreamFunctions) {
      expect(functionNames).toContain(name);
    }
  });

  it("does not include calculateMinFeeWei on Sablier v1.1.2", () => {
    const functionNames: string[] = sablierLockupAbi
      .filter((e) => e.type === "function")
      .map((e) => e.name);
    expect(functionNames).not.toContain("calculateMinFeeWei");
  });

  it("includes the ERC721 Transfer event", () => {
    const local = sablierLockupAbi.find((entry) => entry.type === "event" && entry.name === "Transfer");
    expect(local).toBeTruthy();
  });

  it("includes generated supply and borrow events", () => {
    const eventNames = ovrfloLendingAbi
      .filter((entry) => entry.type === "event")
      .map((entry) => entry.name);
    expect(eventNames).toContain("Supplied");
    expect(eventNames).toContain("Borrowed");
  });

  it("keeps exactly the 8 StreamPricing errors in the generated lending ABI", () => {
    const allErrorNames: string[] = ovrfloLendingAbi
      .filter((entry) => entry.type === "error")
      .map((entry) => entry.name);
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
    (item): item is {
      type: string;
      name: string;
      stateMutability?: string;
      inputs?: AbiParam[];
      outputs?: AbiParam[];
    } =>
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
