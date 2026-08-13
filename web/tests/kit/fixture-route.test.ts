import { describe, expect, it } from "vitest";
import { isKitFixtureAllowed } from "@/app/dev/kit/page";

describe("kit fixture route gate", () => {
  it("renders only on the local runtime profile", () => {
    expect(isKitFixtureAllowed("local", "development")).toBe(true);
    expect(isKitFixtureAllowed("local", "production")).toBe(true);
    expect(isKitFixtureAllowed("production", "production")).toBe(false);
    expect(isKitFixtureAllowed(undefined, "production")).toBe(false);
    expect(isKitFixtureAllowed(undefined, "development")).toBe(true);
  });
});
