# 05 — Pure lib layer

**What to build:** Every computation the app performs exists as a React-free, unit-tested module: branded units, boundary parsers, ladder windowing, payoff/cover-date math, StreamPricing mirror, ABI-enumerated errors, formatting, USD product, and split-truth freshness. The mechanism map's "derived" rows are code.

**Blocked by:** 03 — State-key catalog + standards

**Status:** resolved

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-08-11-003-feat-watch-surface-markets-experience-plan.md

Scope: U5 only (= this ticket). Stop when this ticket's acceptance criteria are met.
Ticket: .scratch/watch-surface-markets-experience/issues/05-pure-lib-layer.md
Spec: .scratch/watch-surface-markets-experience/spec.md
Do not edit the plan. Do not import React. Do not write hooks or UI. Prefer test-first fixture tables.
Before any writes, read Required reading below and the plan sections: Goal Capsule, mechanism map, KTD4, KTD8, KTD10, KTD14, ### U5.
Honor stop conditions. After verification, mark ticket checkboxes done and set Status: resolved.
```

**Required reading:**

- `.scratch/watch-surface-markets-experience/spec.md`
- Plan mechanism map, KTD4, KTD8, KTD10, KTD14, ### U5, AE6
- Web engineering standard from ticket 03
- StreamPricing math fixtures (cross-check obligation/net)
- this ticket's acceptance criteria

- [x] Branded types and parsers exist; malformed URL/localStorage input is rejected at the boundary
- [x] Amount arithmetic helpers reject cross-brand mixing at the helper layer; type-level test exists; no React import under these modules
- [x] Payoff date for the seeded 180-day loan matches hand computation; repay preview shifts cover date for partial and full repayment (AE6)
- [x] Obligation/net math agrees with StreamPricing fixture values; display truncates toward zero
- [x] Ladder window centers on best depth; bounds and single-live-tick cases work
- [x] Every ABI error decodes to copy plus one recovery action; `BelowMinimum` disambiguates fill-floor vs stream-face
- [x] USD product uses stETH/USD × `stEthPerToken`; unavailable on non-positive, heartbeat+grace, and 24h cutoff
- [x] Split-truth freshness classification exists
- [x] Clock-skew interpolation clamps to the deterministic formula and stream end — never exceeding `streamedAmountOf`
- [x] Lib unit tests green; unit-safety operator gate holds outside the units module

## Plan unit

U5 in `docs/plans/2026-08-11-003-feat-watch-surface-markets-experience-plan.md`
