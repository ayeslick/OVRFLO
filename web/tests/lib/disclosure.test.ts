import { afterEach, describe, expect, it } from "vitest";
import { getDisclosure, resetDisclosure, setDisclosure, toggleDisclosure } from "@/lib/disclosure";

describe("disclosure store", () => {
  afterEach(() => {
    resetDisclosure();
  });

  it("starts in Default and never encodes Advanced in a query key", () => {
    expect(getDisclosure()).toBe("default");
    toggleDisclosure();
    expect(getDisclosure()).toBe("advanced");
    setDisclosure("default");
    expect(getDisclosure()).toBe("default");
  });
});
