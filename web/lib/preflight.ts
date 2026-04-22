import type { PublicClient, SimulateContractReturnType } from "viem";

import { classifyUserError, type ClassifiedError } from "@/lib/errors";

// Preflight (R15) — every write path (deposit, claim, withdrawMax) calls
// `simulateContract` at click-time against the current form state *before*
// opening the wallet. On failure we render the classified error in the
// modal's existing StatusPanel slot and suppress `writeContract`, so the
// wallet never prompts for a doomed transaction.
//
// The generics on viem's `SimulateContractParameters` force callers to
// round-trip ABI + functionName + args through matching generic slots, and
// the `value` field is typed as `undefined` when the function isn't
// narrowed as payable. To keep this helper usable across three write paths
// with different ABIs without each caller having to restate every generic
// slot, we accept a deliberately loose input shape here and rely on the
// concrete `writeContract` call site to type-check the returned request.
// The runtime payload is the same — viem only reads the documented fields.

export type PreflightRequest = SimulateContractReturnType["request"];

export type PreflightResult =
  | { ok: true; request: PreflightRequest }
  | { ok: false; error: ClassifiedError };

type SimulateParamsLike = Omit<
  Parameters<PublicClient["simulateContract"]>[0],
  "value"
> & {
  value?: bigint;
};

export async function preflight(
  publicClient: PublicClient,
  params: SimulateParamsLike,
  fallbackMessage = "Transaction would fail"
): Promise<PreflightResult> {
  try {
    const sim = await publicClient.simulateContract(
      params as Parameters<PublicClient["simulateContract"]>[0]
    );
    return { ok: true, request: sim.request as PreflightRequest };
  } catch (error) {
    return { ok: false, error: classifyUserError(error, fallbackMessage) };
  }
}
