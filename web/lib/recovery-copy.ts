import type { GraphSemanticId } from "./action-graph";

const FORBIDDEN =
  /\b(approv(?:e|al|ing)|allowance|calldata|router|protocol|PT|simulation|permission)\b/i;

export type RecoveryCopy = {
  completed: string;
  remaining: string;
  next: string;
};

const USER_STEPS = new Set<GraphSemanticId>(["deposit", "borrow", "supply"]);

const COMPLETED: Record<"deposit" | "borrow" | "supply", string> = {
  deposit: "You received the immediate tokens.",
  borrow: "The loan is open.",
  supply: "Your capital is resting.",
};

const REMAINING: Record<"deposit" | "borrow" | "supply", string> = {
  deposit: "Immediate tokens are not received yet.",
  borrow: "The loan is not open yet.",
  supply: "Capital is not resting yet.",
};

function userOutcomes(ids: readonly GraphSemanticId[]): Array<"deposit" | "borrow" | "supply"> {
  return ids.filter((id): id is "deposit" | "borrow" | "supply" => USER_STEPS.has(id));
}

/**
 * Default recovery names completed and remaining user outcomes.
 * It does not name protocol or approval mechanics.
 */
export function defaultRecoveryCopy(args: {
  confirmed: readonly GraphSemanticId[];
  remaining: readonly GraphSemanticId[];
}): RecoveryCopy {
  const confirmed = userOutcomes(args.confirmed);
  const remaining = userOutcomes(args.remaining);
  const completed =
    confirmed.length === 0 ? "Nothing has finished yet." : confirmed.map((id) => COMPLETED[id]).join(" ");
  const remainingCopy =
    remaining.length === 0 ? "Nothing remains." : remaining.map((id) => REMAINING[id]).join(" ");
  const next = args.remaining.length === 0 ? "Done." : "Continue.";
  const copy = { completed, remaining: remainingCopy, next };
  assertDefaultRecoveryCopy(copy);
  return copy;
}

export function assertDefaultRecoveryCopy(copy: RecoveryCopy): void {
  const text = `${copy.completed} ${copy.remaining} ${copy.next}`;
  if (FORBIDDEN.test(text)) {
    throw new Error("Default recovery copy must not name protocol or approval mechanics");
  }
}

export function recoveryCopyIsDefaultSafe(text: string): boolean {
  return !FORBIDDEN.test(text);
}
