import { describe, expect, it } from "vitest";
import { canStartBrowserDiscovery } from "@/lib/browser-runtime";

describe("browser discovery prerender guard", () => {
  it("does not start without browser globals", () => {
    expect(canStartBrowserDiscovery({})).toBe(false);
  });

  it("starts only when both window and document exist", () => {
    expect(
      canStartBrowserDiscovery({
        window: {} as Window & typeof globalThis,
        document: {} as Document,
      }),
    ).toBe(true);
  });
});
