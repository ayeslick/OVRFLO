/**
 * Allocate a collision-resistant graph ID once per accepted action attempt.
 * Reuse only when resuming that stored attempt (ticket 17).
 */

export function allocateGraphId(random = defaultRandom): string {
  const bytes = random(16);
  if (bytes.length < 16) {
    throw new Error("graph id entropy must be 16 bytes");
  }
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    ((Number.parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, "0") +
      hex.slice(18, 20),
    hex.slice(20, 32),
  ].join("-");
}

function defaultRandom(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
    return bytes;
  }
  throw new Error("crypto.getRandomValues is required to allocate a graph ID");
}
