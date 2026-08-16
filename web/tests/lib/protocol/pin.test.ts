import { describe, expect, it } from "vitest";
import { callPin, hashPin, hostIsLoopback, numberPin, pinModeForRpcUrls } from "@/lib/protocol/pin";
import type { Hash } from "viem";

const pin = {
  blockNumber: 10n,
  blockHash: `0x${"ab".repeat(32)}` as Hash,
};

describe("enumeration pin selectors", () => {
  it("never sends hash and number on the same call", () => {
    const hashed = hashPin(pin);
    const numbered = numberPin(pin);
    expect("blockNumber" in hashed).toBe(false);
    expect("blockHash" in numbered).toBe(false);
    expect(hashed.requireCanonical).toBe(true);
    expect(callPin(pin, "hash")).toEqual(hashed);
    expect(callPin(pin, "number")).toEqual(numbered);
  });

  it("uses hash pin only when every RPC host is loopback", () => {
    expect(hostIsLoopback("http://127.0.0.1:8545")).toBe(true);
    expect(hostIsLoopback("http://localhost:8545")).toBe(true);
    expect(pinModeForRpcUrls(["http://127.0.0.1:8545"])).toBe("hash");
    expect(pinModeForRpcUrls(["https://eth.example"])).toBe("number");
    expect(pinModeForRpcUrls(["http://127.0.0.1:8545", "https://eth.example"])).toBe("number");
  });
});
