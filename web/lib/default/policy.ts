/**
 * Versioned product-policy module (KD17).
 * Ticket 17 owns RISK_DISCLOSURE_VERSION.
 * Ticket 18 owns Hosted Convert slippage constants in this same file.
 */

export const POLICY_MODULE_VERSION = 1;

/** Bump when risk copy or the acknowledgment contract changes. */
export const RISK_DISCLOSURE_VERSION = 1;

/** Default Hosted Convert slippage. Advanced may set 10–500 bps. */
export const PENDLE_SLIPPAGE_BPS = 50n;

/** Default rejects a candidate above this impact. Advanced shows and does not block. */
export const MAX_PENDLE_PRICE_IMPACT_BPS = 100n;
