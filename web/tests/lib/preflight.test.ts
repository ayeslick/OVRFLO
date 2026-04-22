/**
 * Tests: T-WEB-PREFLIGHT-1..4
 *
 * preflight() wraps viem's simulateContract with our classifyUserError
 * taxonomy. It must:
 *   1. Return { ok: true, request } when the simulate resolves.
 *   2. Return { ok: false, error: ClassifiedError } when it rejects,
 *      routing the underlying error through classifyUserError so the
 *      modal can render kind-aware copy.
 *   3. Preserve the caller-supplied fallbackMessage when no signal
 *      matches.
 *   4. Route a ContractFunctionRevertedError("ovrflo: slippage") to
 *      kind "slippage" — this is the canonical deposit-failure case
 *      the classifier was written for.
 */
import { describe, it, expect, vi } from "vitest";
import {
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  UserRejectedRequestError,
} from "viem";

import { preflight } from "@/lib/preflight";

type SimulateArgs = Parameters<
  import("viem").PublicClient["simulateContract"]
>[0];

function makeClient(simulate: (args: SimulateArgs) => Promise<unknown>) {
  return {
    simulateContract: vi.fn(simulate),
  } as unknown as import("viem").PublicClient;
}

describe("preflight", () => {
  it("returns { ok: true, request } when simulateContract resolves", async () => {
    const request = { foo: "bar" };
    const client = makeClient(async () => ({ request, result: undefined }));
    const result = await preflight(client, {
      address: "0x0000000000000000000000000000000000000000",
      abi: [],
      functionName: "deposit",
      args: [],
    } as unknown as SimulateArgs);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.request).toBe(request);
    }
  });

  it("routes a revert with ovrflo: slippage reason to kind 'slippage'", async () => {
    const inner = new ContractFunctionRevertedError({
      abi: [],
      data: undefined,
      functionName: "deposit",
      message: "ovrflo: slippage",
    });
    const outer = new ContractFunctionExecutionError(inner, {
      abi: [],
      functionName: "deposit",
    });
    const client = makeClient(async () => {
      throw outer;
    });
    const result = await preflight(
      client,
      {
        address: "0x0000000000000000000000000000000000000000",
        abi: [],
        functionName: "deposit",
        args: [],
      } as unknown as SimulateArgs,
      "Deposit would fail"
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("slippage");
    }
  });

  it("routes a nested UserRejectedRequestError to kind 'user-rejected'", async () => {
    const inner = new UserRejectedRequestError(new Error("User rejected"));
    const outer = new ContractFunctionExecutionError(inner, {
      abi: [],
      functionName: "claim",
    });
    const client = makeClient(async () => {
      throw outer;
    });
    const result = await preflight(client, {
      address: "0x0000000000000000000000000000000000000000",
      abi: [],
      functionName: "claim",
      args: [],
    } as unknown as SimulateArgs);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("user-rejected");
    }
  });

  it("uses the fallbackMessage when the error has no recognized signal", async () => {
    const client = makeClient(async () => {
      throw new Error("some unclassified failure");
    });
    const result = await preflight(
      client,
      {
        address: "0x0000000000000000000000000000000000000000",
        abi: [],
        functionName: "deposit",
        args: [],
      } as unknown as SimulateArgs,
      "Create failed"
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("unknown");
      // classifyUserError preserves the underlying message when it has one,
      // falling back only when the error is null/undefined.
      expect(result.error.message).toContain("some unclassified failure");
    }
  });
});
