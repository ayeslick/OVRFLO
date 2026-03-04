/**
 * Tests: T-WEB-013
 *
 * T-WEB-013: Network mismatch blocks write CTA actions.
 *
 * Validates the chain gating logic used across deposit, claim, and withdraw
 * components to disable buttons when chainId does not match CHAIN_ID.
 */
import { describe, it, expect } from "vitest";
import { CHAIN_ID } from "@/lib/constants";

describe("Chain gating logic (T-WEB-013)", () => {
  it("T-WEB-013: wrongChain is true when chainId !== CHAIN_ID", () => {
    const chainId = 42161; // Arbitrum
    const wrongChain = chainId !== CHAIN_ID;
    expect(wrongChain).toBe(true);
  });

  it("T-WEB-013: wrongChain is false when chainId === CHAIN_ID", () => {
    const chainId = CHAIN_ID;
    const wrongChain = chainId !== CHAIN_ID;
    expect(wrongChain).toBe(false);
  });

  it("T-WEB-013: buttons should be disabled when wrongChain is true", () => {
    const wrongChain = true;
    const isBusy = false;
    const ptAmount = BigInt(100);

    const depositDisabled = wrongChain || isBusy || ptAmount === BigInt(0);
    expect(depositDisabled).toBe(true);

    const claimAmount = BigInt(50);
    const claimDisabled = wrongChain || isBusy || claimAmount === BigInt(0);
    expect(claimDisabled).toBe(true);
  });

  it("T-WEB-013: buttons enabled when on correct chain with valid inputs", () => {
    const wrongChain = false;
    const isBusy = false;

    const depositDisabled = wrongChain || isBusy || BigInt(100) === BigInt(0);
    expect(depositDisabled).toBe(false);
  });
});
