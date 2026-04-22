/**
 * Tests: R25 — safe truncation for addresses and tx hashes.
 *
 * Guards against regressions in `truncateAddress` / `truncateTxHash`
 * that could either leak full hex on screen or mangle input that isn't
 * a hex value (ENS names passed through untouched).
 */
import { describe, it, expect } from "vitest";

const { truncateAddress, truncateTxHash, TRUNCATION_ELLIPSIS } = await import(
  "@/lib/format"
);

const ADDR = "0x1234567890abcdef1234567890abcdef12345678";
const HASH =
  "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";

describe("truncateAddress", () => {
  it("produces 0xHEAD…TAIL for a valid 20-byte address", () => {
    const out = truncateAddress(ADDR);
    expect(out).toBe(`0x1234${TRUNCATION_ELLIPSIS}5678`);
    expect(out).toContain(TRUNCATION_ELLIPSIS);
    expect(out.startsWith("0x")).toBe(true);
  });

  it("returns the input unchanged for non-address values (ENS names pass through)", () => {
    expect(truncateAddress("vitalik.eth")).toBe("vitalik.eth");
    expect(truncateAddress("not-a-hex-string")).toBe("not-a-hex-string");
  });

  it("returns the fallback for undefined or empty input", () => {
    expect(truncateAddress(undefined)).toBe("");
    expect(truncateAddress(null)).toBe("");
    expect(truncateAddress("")).toBe("");
    expect(truncateAddress(undefined, { fallback: "—" })).toBe("—");
  });

  it("uses the U+2026 ellipsis (not '...') so screen readers announce it correctly", () => {
    const out = truncateAddress(ADDR);
    expect(out).not.toContain("...");
    expect(TRUNCATION_ELLIPSIS).toBe("\u2026");
  });

  it("honors custom head/tail widths", () => {
    expect(truncateAddress(ADDR, { head: 6, tail: 6 })).toBe(
      `0x123456${TRUNCATION_ELLIPSIS}345678`
    );
  });
});

describe("truncateTxHash", () => {
  it("defaults to 6/6 so tx hashes keep enough fingerprint", () => {
    expect(truncateTxHash(HASH)).toBe(
      `0xabcdef${TRUNCATION_ELLIPSIS}567890`
    );
  });

  it("returns the input unchanged for non-hash values", () => {
    expect(truncateTxHash("not-a-hash")).toBe("not-a-hash");
  });

  it("returns the fallback for empty / undefined input", () => {
    expect(truncateTxHash(undefined)).toBe("");
    expect(truncateTxHash(undefined, { fallback: "pending" })).toBe("pending");
  });
});
