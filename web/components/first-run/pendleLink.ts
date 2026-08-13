import { isAddress, isAddressEqual, type Address } from "viem";

/** Pendle app host. Any other host is unverified and degrades the intent. */
export const PENDLE_APP_HOST = "app.pendle.finance";

const MARKET_IN_PATH = /\/markets\/(0x[a-fA-F0-9]{40})\b/i;

export type PendleLink =
  | { kind: "linked"; href: string }
  | { kind: "degraded"; reason: "missing" | "unusable" };

/**
 * Address-verified Pendle deep link. A configured URL that does not name the
 * on-chain market degrades — it does not invent a different market (Risk 8).
 */
export function pendleMarketUrlTemplate(market: Address): string {
  return `https://${PENDLE_APP_HOST}/trade/markets/${market}/swap?view=pt&chain=ethereum`;
}

export function resolvePendleLink(
  market: Address | null | undefined,
  configuredUrl?: string | null,
): PendleLink {
  if (!market || !isAddress(market)) return { kind: "degraded", reason: "missing" };
  const trimmed = configuredUrl?.trim();
  const candidate = trimmed
    ? trimmed.includes("{market}")
      ? trimmed.replaceAll("{market}", market)
      : trimmed
    : pendleMarketUrlTemplate(market);
  return verifyPendleMarketUrl(candidate, market);
}

export function verifyPendleMarketUrl(url: string, market: Address): PendleLink {
  if (!isAddress(market)) return { kind: "degraded", reason: "missing" };
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return { kind: "degraded", reason: "unusable" };
    if (parsed.hostname !== PENDLE_APP_HOST) return { kind: "degraded", reason: "unusable" };
    const match = parsed.pathname.match(MARKET_IN_PATH);
    const inPath = match?.[1];
    if (!inPath || !isAddress(inPath) || !isAddressEqual(inPath, market)) {
      return { kind: "degraded", reason: "unusable" };
    }
    return { kind: "linked", href: parsed.toString() };
  } catch {
    return { kind: "degraded", reason: "unusable" };
  }
}
