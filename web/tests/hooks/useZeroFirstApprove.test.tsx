import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useZeroFirstApprove } from "@/hooks/useZeroFirstApprove";

// R28/L-3. Some ERC-20s revert when a non-zero allowance is changed to another
// non-zero value. Clearing to zero unconditionally would cost an extra
// transaction and signature on every re-approve — real gas on every deposit and
// repay — to defend against a revert wstETH cannot produce. So: approve
// directly, and pay for the second step only when the first one actually fails
// that way.

const TOKEN = "0x0000000000000000000000000000000000000001" as const;
const SPENDER = "0x0000000000000000000000000000000000000002" as const;

// useWriteFlow returns a fresh object every render, which is what lets the
// hook's effect observe a state change. Mutating one object in place would
// leave the reference stable and the effect would never re-run — an artifact of
// the harness, not of the hook.
const state = { writeContract: vi.fn(), isConfirmed: false, hasFailed: false };

function flow() {
  return { ...state, writeContract: state.writeContract };
}

function argsOf(mock: ReturnType<typeof vi.fn>, call: number) {
  return mock.mock.calls[call][0].args;
}

describe("useZeroFirstApprove (R28)", () => {
  beforeEach(() => {
    state.writeContract = vi.fn();
    state.isConfirmed = false;
    state.hasFailed = false;
  });

  it("approves directly in one transaction — the common path costs nothing extra", () => {
    const { result } = renderHook(() => useZeroFirstApprove(flow()));
    act(() => result.current.submit(TOKEN, SPENDER, 100n, 50n));

    expect(state.writeContract).toHaveBeenCalledTimes(1);
    expect(argsOf(state.writeContract, 0)).toEqual([SPENDER, 100n]);
    expect(result.current.clearing).toBe(false);
  });

  it("does not pre-clear even when the allowance is non-zero and different", () => {
    // The whole point: this is the shape that *might* revert, and it still gets
    // one optimistic attempt rather than an automatic two-step.
    const { result } = renderHook(() => useZeroFirstApprove(flow()));
    act(() => result.current.submit(TOKEN, SPENDER, 100n, 75n));

    expect(state.writeContract).toHaveBeenCalledTimes(1);
    expect(argsOf(state.writeContract, 0)).toEqual([SPENDER, 100n]);
  });

  it("falls back to zero-first after a failure with the revert's shape", () => {
    const { result, rerender } = renderHook(() => useZeroFirstApprove(flow()));
    act(() => result.current.submit(TOKEN, SPENDER, 100n, 75n));

    state.hasFailed = true;
    rerender();

    expect(state.writeContract).toHaveBeenCalledTimes(2);
    expect(argsOf(state.writeContract, 1)).toEqual([SPENDER, 0n]);
    expect(result.current.clearing).toBe(true);
    expect(result.current.usedFallback).toBe(true);
  });

  it("sets the real amount once the clearing approve confirms", () => {
    const { result, rerender } = renderHook(() => useZeroFirstApprove(flow()));
    act(() => result.current.submit(TOKEN, SPENDER, 100n, 75n));

    state.hasFailed = true;
    rerender();
    // The write flow resets when the clearing approve goes out...
    state.hasFailed = false;
    rerender();
    // ...and then that approve confirms.
    state.isConfirmed = true;
    rerender();

    expect(state.writeContract).toHaveBeenCalledTimes(3);
    expect(argsOf(state.writeContract, 2)).toEqual([SPENDER, 100n]);
    expect(result.current.clearing).toBe(false);
  });

  it("does not retry when the allowance was already zero", () => {
    // Nothing to clear, so a failure here is a genuine error — surface it.
    const { result, rerender } = renderHook(() => useZeroFirstApprove(flow()));
    act(() => result.current.submit(TOKEN, SPENDER, 100n, 0n));

    state.hasFailed = true;
    rerender();

    expect(state.writeContract).toHaveBeenCalledTimes(1);
    expect(result.current.usedFallback).toBe(false);
  });

  it("does not retry when the target is zero", () => {
    const { result, rerender } = renderHook(() => useZeroFirstApprove(flow()));
    act(() => result.current.submit(TOKEN, SPENDER, 0n, 75n));

    state.hasFailed = true;
    rerender();

    expect(state.writeContract).toHaveBeenCalledTimes(1);
  });

  it("retries at most once, so a token failing for another reason cannot loop", () => {
    const { result, rerender } = renderHook(() => useZeroFirstApprove(flow()));
    act(() => result.current.submit(TOKEN, SPENDER, 100n, 75n));

    state.hasFailed = true;
    rerender();
    // Flow resets, then the clearing approve fails on its own account.
    state.hasFailed = false;
    rerender();
    state.hasFailed = true;
    rerender();
    rerender();

    expect(state.writeContract).toHaveBeenCalledTimes(2);
    expect(result.current.clearing).toBe(false);
  });
});

describe("useZeroFirstApprove — stale attempt (regression)", () => {
  beforeEach(() => {
    state.writeContract = vi.fn();
    state.isConfirmed = false;
    state.hasFailed = false;
  });

  it("does not re-fire for an approve that already succeeded", () => {
    // The attempt used to linger for the life of the form, so any later approve
    // failure re-fired a zero-approve against an allowance that was already
    // correct — an extra transaction that moved chain state. The E2E suite
    // caught it as a stream surviving into a later scenario.
    const { result, rerender } = renderHook(() => useZeroFirstApprove(flow()));
    act(() => result.current.submit(TOKEN, SPENDER, 100n, 75n));
    expect(state.writeContract).toHaveBeenCalledTimes(1);

    state.isConfirmed = true;
    rerender();

    // Some later, unrelated approve failure in the same form.
    state.isConfirmed = false;
    state.hasFailed = true;
    rerender();

    expect(state.writeContract).toHaveBeenCalledTimes(1);
    expect(result.current.usedFallback).toBe(false);
  });
});
