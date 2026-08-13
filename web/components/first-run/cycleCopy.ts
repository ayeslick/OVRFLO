/**
 * Teaching copy for UI-FIRST-RUN-SURFACE / UI-FIRST-RUN-CYCLE.
 * Token names stay market-driven — never a hardcoded ovrflo symbol.
 */

export const TEACHING_SENTENCES = [
  "Eligible collateral is a fixed-schedule non-cancelable stream.",
  "A loan's end is known when it opens.",
  "There are no health factors and no liquidations.",
  "Watching is the home once something exists.",
] as const;

export function ovrfloMintCopy(symbol: string | null | undefined): string {
  const trimmed = symbol?.trim();
  if (trimmed) return `mints ${trimmed}`;
  return "mints the market's ovrflo token";
}

export function depositOutcomeCopy(symbol: string | null | undefined): string {
  const trimmed = symbol?.trim();
  if (trimmed) return `${trimmed} + stream`;
  return "ovrflo token + stream";
}

export const CYCLE_STEPS = [
  { id: "get-pt", label: "GET PT", have: "PT" },
  { id: "deposit", label: "DEPOSIT", have: "deposit" },
  { id: "stream", label: "RECEIVE STREAM", have: "stream" },
  { id: "borrow", label: "BORROW", have: "pledged loan" },
] as const;

export function cycleHaveLabel(
  stepId: (typeof CYCLE_STEPS)[number]["id"],
  ovrfloSymbol: string | null | undefined,
): string {
  if (stepId === "deposit") return depositOutcomeCopy(ovrfloSymbol);
  const step = CYCLE_STEPS.find((entry) => entry.id === stepId);
  return step?.have ?? "";
}
