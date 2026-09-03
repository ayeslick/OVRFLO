import { describe, expect, it } from "vitest";
import { defaultRecoveryCopy, recoveryCopyIsDefaultSafe } from "@/lib/recovery-copy";

describe("Default recovery copy", () => {
  it("names completed and remaining user outcomes without protocol mechanics", () => {
    const copy = defaultRecoveryCopy({
      confirmed: ["deposit"],
      remaining: ["borrow"],
    });
    expect(copy.completed).toBe("You received the immediate tokens.");
    expect(copy.remaining).toBe("The loan is not open yet.");
    expect(copy.next).toBe("Continue.");
    expect(recoveryCopyIsDefaultSafe(`${copy.completed} ${copy.remaining} ${copy.next}`)).toBe(true);
  });

  it("omits approval step names from Default copy", () => {
    const copy = defaultRecoveryCopy({
      confirmed: ["auth-clear-to-zero", "auth-set-allowance"],
      remaining: ["deposit", "borrow"],
    });
    expect(copy.completed).toBe("Nothing has finished yet.");
    expect(copy.remaining).toContain("Immediate tokens");
    expect(`${copy.completed} ${copy.remaining}`).not.toMatch(
      /\b(approv|allowance|calldata|router|protocol|PT|permission)\b/i,
    );
  });
});
