/**
 * Tests: T-WEB-ERRORS-1..7
 *
 * classifyUserError is the single classification surface for all write
 * paths (preflight + writeContract) and for the Sablier streams banner.
 * Each kind must route to the correct message even when the underlying
 * error is wrapped in viem's ContractFunctionExecutionError, because
 * that's the shape every wagmi `writeContract` rejection actually uses.
 */
import { describe, it, expect } from "vitest";
import {
  ChainMismatchError,
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  HttpRequestError,
  UserRejectedRequestError,
} from "viem";

import {
  classifyUserError,
  getErrorMessage,
  isFrontendConfigError,
} from "@/lib/errors";
import { StreamScanError } from "@/lib/sablier";

describe("getErrorMessage", () => {
  it("extracts Error.message", () => {
    expect(getErrorMessage(new Error("boom"))).toBe("boom");
  });

  it("falls back to shortMessage on plain objects", () => {
    expect(getErrorMessage({ shortMessage: "short" })).toBe("short");
  });

  it("returns the fallback when nothing matches", () => {
    expect(getErrorMessage(null, "fallback")).toBe("fallback");
  });
});

describe("isFrontendConfigError", () => {
  it("flags NEXT_PUBLIC_* diagnostics", () => {
    expect(
      isFrontendConfigError(new Error("NEXT_PUBLIC_OVRFLO_FACTORY is not set"))
    ).toBe(true);
  });
  it("ignores unrelated errors", () => {
    expect(isFrontendConfigError(new Error("boom"))).toBe(false);
  });
});

describe("classifyUserError", () => {
  it("routes StreamScanError to indexer-down", () => {
    const result = classifyUserError(
      new StreamScanError("HTTP 503 from hyperindex")
    );
    expect(result.kind).toBe("indexer-down");
    expect(result.message).toMatch(/indexer is unavailable|streams may be out of date/i);
  });

  it("routes UserRejectedRequestError (nested) to user-rejected", () => {
    // Mirror the shape wagmi v2 actually returns: outer
    // ContractFunctionExecutionError wrapping the inner
    // UserRejectedRequestError on its cause chain.
    const inner = new UserRejectedRequestError(new Error("User rejected the request."));
    const outer = new ContractFunctionExecutionError(inner, {
      abi: [],
      functionName: "deposit",
    });
    const result = classifyUserError(outer);
    expect(result.kind).toBe("user-rejected");
  });

  it("routes ChainMismatchError to wrong-network", () => {
    const chain = new ChainMismatchError({
      chain: { id: 1, name: "mainnet", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [""] } } } as never,
      currentChainId: 11155111,
    });
    expect(classifyUserError(chain).kind).toBe("wrong-network");
  });

  it("routes ContractFunctionRevertedError with ovrflo: slippage reason to slippage", () => {
    const reverted = new ContractFunctionRevertedError({
      abi: [],
      data: undefined,
      functionName: "deposit",
      message: "ovrflo: slippage",
    });
    // ContractFunctionRevertedError captures reason via the viem ctor; if it
    // didn't, shortMessage still contains the revert string and SIGNALS will
    // match off that.
    const outer = new ContractFunctionExecutionError(reverted, {
      abi: [],
      functionName: "deposit",
    });
    const result = classifyUserError(outer);
    expect(result.kind).toBe("slippage");
  });

  it("routes HttpRequestError to rpc-down", () => {
    const http = new HttpRequestError({
      url: "http://127.0.0.1:8545",
      details: "connect ECONNREFUSED",
    });
    expect(classifyUserError(http).kind).toBe("rpc-down");
  });

  it("falls through substring matching on plain Errors (insufficient funds → insufficient-gas)", () => {
    const result = classifyUserError(
      new Error("insufficient funds for gas * price + value")
    );
    expect(result.kind).toBe("insufficient-gas");
  });

  it("returns { kind: 'unknown' } when no signal matches", () => {
    const result = classifyUserError(new Error("something weird happened"));
    expect(result.kind).toBe("unknown");
    expect(result.message).toContain("something weird");
  });

  it("returns { kind: 'unknown' } with fallback when error is null", () => {
    expect(classifyUserError(null, "fell back").message).toBe("fell back");
  });
});
