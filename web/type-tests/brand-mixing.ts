/**
 * KTD8 helper-layer brand mixing. Checked by `tsc --noEmit`
 * (`@ts-expect-error` must stay unused-error-free). Runtime operators on
 * branded amounts remain legal after erasure — that gate is
 * `web/tests/lib/unit-safety-gate.test.ts`, not the type system.
 */
import { add, bps, min, mulDiv, ovrfloWei, sub, usd8, wei, wstethWei } from "../lib/units";

void add(wei(1n), wei(2n));
void sub(wstethWei(5n), wstethWei(1n));
void min(ovrfloWei(3n), ovrfloWei(1n));
void mulDiv(usd8(100n), 2n, 1n);

// @ts-expect-error KTD8: Wei and WstethWei must not mix at the helper layer
void add(wei(1n), wstethWei(1n));

// @ts-expect-error KTD8: WstethWei and Usd8 must not mix
void add(wstethWei(1n), usd8(1n));

// @ts-expect-error KTD8: OvrfloWei and Wei must not mix
void sub(ovrfloWei(2n), wei(1n));

// @ts-expect-error KTD8: Bps and Wei must not mix
void add(bps(1n), wei(1n));

// @ts-expect-error KTD8: Usd8 and OvrfloWei must not mix
void min(usd8(1n), ovrfloWei(1n));
