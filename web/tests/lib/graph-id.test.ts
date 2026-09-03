import { describe, expect, it } from "vitest";
import { allocateGraphId } from "@/lib/graph-id";

describe("allocateGraphId", () => {
  it("returns a collision-resistant UUID from 16 bytes", () => {
    const bytes = new Uint8Array(16).map((_, index) => index + 1);
    const id = allocateGraphId(() => bytes);
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(allocateGraphId(() => bytes)).toBe(id);
  });
});
