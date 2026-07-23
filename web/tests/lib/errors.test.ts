import { describe, expect, it } from "vitest";
import { userFacingError } from "@/lib/errors";

describe("userFacingError", () => {
  it("maps the current lending stale-liquidity string to refresh copy", () => {
    expect(userFacingError(new Error("execution reverted: OVRFLOLending: liquidity inactive"))).toContain(
      "Liquidity changed since your quote",
    );
  });

  it("does not include deleted custom errors in user copy", () => {
    const source = userFacingError.toString();
    expect(source).not.toContain("SeriesNotApproved");
    expect(source).not.toContain("CoreNotRegistered");
  });
});
