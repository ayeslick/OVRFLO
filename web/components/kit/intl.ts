// Memoized Intl.NumberFormat per (locale, options) — B7. Do not allocate a
// formatter per RollingNumber frame.

type CacheKey = string;

const numberFormats = new Map<CacheKey, Intl.NumberFormat>();

function optionsKey(options: Intl.NumberFormatOptions | undefined) {
  if (!options) return "";
  const keys = Object.keys(options).sort() as (keyof Intl.NumberFormatOptions)[];
  return keys.map((key) => `${key}:${String(options[key])}`).join(",");
}

export function getNumberFormat(locale: string, options?: Intl.NumberFormatOptions) {
  const key = `${locale}|${optionsKey(options)}`;
  const cached = numberFormats.get(key);
  if (cached) return cached;
  const formatter = new Intl.NumberFormat(locale, options);
  numberFormats.set(key, formatter);
  return formatter;
}

export function formatGroupedInteger(value: bigint, locale: string): string {
  if (value < 0n) return `-${formatGroupedInteger(-value, locale)}`;
  if (value <= BigInt(Number.MAX_SAFE_INTEGER)) {
    return getNumberFormat(locale, { maximumFractionDigits: 0, useGrouping: true }).format(
      Number(value),
    );
  }
  return value.toString();
}

/** Test seam: cache size, to prove we reuse formatters. */
export function numberFormatCacheSize() {
  return numberFormats.size;
}
