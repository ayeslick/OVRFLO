# Schedule

Clock, interpolation inputs, payoff derivations, and event freshness.

Mechanism-map kind: **derived from on-chain schedule × clock**. Parser
`trust_domain` is `on-chain` for the immutable schedule params and `pure-client`
for the clock, the interpolations, the payoff dates, and the freshness class
(`README.md` mapping table).

KTD6 load-bearing rules, also in `docs/solutions/patterns/ovrflo-web-standard.md`
(browser-runtime pathology):

- Every displayed live value is a **pure function of absolute time and the
  schedule**. Accumulating per-tick deltas is banned.
- Interpolation is computed in render (or in a rAF callback that reads the
  clock). It is **never stored per-tick in React state or the query cache**.
- Interpolated values clamp to Sablier's deterministic formula and the stream
  end time — a fast local clock never displays more than `streamedAmountOf`
  would return.
- Lender-earnings interpolation additionally clamps at the position's pro-rata
  obligation share: accrual freezes at the loan's cover date. The supplied
  ribbon's terminal is the cover date, not stream maturity.
- None of these keys reach an `if (…) allow`. Gates re-read chain.

Entry format and rules: `README.md`.

---

### `schedule.clock`

The shared 1 Hz interpolation clock: skew-adjusted Unix seconds.

- **trust_domain:** `pure-client`
- **writers:**
  - `web/hooks/useClock.ts` — landing U6: `useSyncExternalStore` (eager and hydration-safe variants)
- **readers:**
  - `web/components/kit/RollingNumber.tsx` — landing U4: formats from bigint every frame
  - `web/components/kit/Ribbon.tsx` — landing U4: gold edge at now (via the shared rAF driver)
  - `web/lib/payoff.ts` — landing U5: cover-date / countdown inputs
  - `web/components/watch/SuppliedDetail.tsx` — landing U7: earnings hero
  - `web/components/watch/BorrowedDetail.tsx` — landing U7: outstanding hero
  - `web/components/watch/StreamDetail.tsx` — landing U7: vested hero
- **notes:** Client clock plus `schedule.skew-offset`, not `block.timestamp` and
  not a stored per-tick value. Display only. Anything that decides whether an
  action is permitted uses a chain re-read. The hydration-safe variant returns
  `null` before hydration so static-export HTML and the client agree. StrictMode
  double-invocation must leave the store single-armed. `useNowSeconds` is
  superseded and must not drive watch surfaces. Rows subscribe only when a
  schedule-backed value is visible.

### `schedule.skew-offset`

Estimated local-clock minus `block.timestamp` offset, in seconds.

- **trust_domain:** `pure-client`
- **writers:**
  - `web/lib/payoff.ts` — landing U5: skew estimator from `chain.block-timestamp`
  - `web/hooks/useClock.ts` — landing U6: applies the offset to the store
- **readers:**
  - `web/hooks/useClock.ts` — landing U6: skew-adjusted tick
  - `web/lib/payoff.ts` — landing U5: clamp interpolations to the deterministic formula
- **notes:** Derived from on-chain block time, stored only as an offset — not as
  a second clock. Slow client clocks otherwise lag the chain: countdowns lie
  late, close-ready flips late. When `chain.block-timestamp` is unavailable the
  offset is unknown; interpolation continues from the last known offset and
  `schedule.freshness` degrades. Never a gate.

### `schedule.stream-params`

Immutable interpolation inputs per stream: start, end, deposited
(`cancelable: false`).

- **trust_domain:** `on-chain`
- **writers:**
  - `web/hooks/useStreams.ts` — landing U6: slice of `getStream` from `chain.stream-truth`
- **readers:**
  - `web/lib/payoff.ts` — landing U5: vested / remaining / cover-date
  - `web/components/kit/Ribbon.tsx` — landing U4: origin → terminal geometry
  - `web/components/kit/RollingNumber.tsx` — landing U4: schedule × clock
- **notes:** Not a second RPC. The interpolation slice of `chain.stream-truth`.
  Read once per entity; the values are immutable for the stream's life. Do not
  copy them into the query cache on every tick. Sablier three-bucket vocabulary
  (remaining / claimable / locked) lives in `web/lib/lending-math.ts` (U5).

### `schedule.interpolated-earnings`

Lender claimable accrual displayed on supplied rows and the earnings hero.

- **trust_domain:** `pure-client`
- **writers:**
  - `web/lib/payoff.ts` — landing U5: schedule × clock, clamped at cover-date obligation share
- **readers:**
  - `web/components/kit/RollingNumber.tsx` — landing U4: gold hero
  - `web/components/watch/Wall.tsx` — landing U7: supplied-row decisive number
  - `web/components/watch/SuppliedDetail.tsx` — landing U7: `UI-WATCH-HERO-EARNINGS`
- **notes:** Derived in render. **Never stored per-tick.** Resting (unfilled)
  capital must compute to a constant — animating it is a product defect (R5,
  `UI-WATCH-ROW-SUPPLIED`). Accrual freezes at the cover date; naive
  vesting-follows-the-stream interpolation invents earnings every second past
  cover. Display may preview; `UI-WATCH-CLAIM` authorises from
  `chain.loans-of-position` / `loanState` only. `role="timer"`. Truncate toward
  zero — never round up past what `streamedAmountOf` would yield.

### `schedule.interpolated-outstanding`

Borrower outstanding counting down toward the done-date.

- **trust_domain:** `pure-client`
- **writers:**
  - `web/lib/payoff.ts` — landing U5: last-read outstanding minus schedule-backed stream draw since that read
- **readers:**
  - `web/components/kit/RollingNumber.tsx` — landing U4: outstanding hero
  - `web/components/watch/Wall.tsx` — landing U7: borrowed-row decisive number
  - `web/components/watch/BorrowedDetail.tsx` — landing U7: `UI-WATCH-HERO-OUTSTANDING`
- **notes:** Derived in render. Event-derived outstanding (after repay/close)
  changes only on a chain read; this key interpolates the stream-repayment
  slice between reads. Countdowns clamp at zero and hand off to event truth.
  Close-ready is **not** this key reaching zero — it is
  `chain.borrower-loans` outstanding covered by `withdrawableAmountOf`,
  re-read. Never colour the countdown as liquidation risk.

### `schedule.interpolated-vested`

Stream vested amount on Streams-lens rows and the vested hero.

- **trust_domain:** `pure-client`
- **writers:**
  - `web/lib/payoff.ts` — landing U5: Sablier streamed amount from schedule × clock
- **readers:**
  - `web/components/kit/RollingNumber.tsx` — landing U4: vested hero
  - `web/components/watch/Wall.tsx` — landing U7: stream-row decisive number
  - `web/components/watch/StreamDetail.tsx` — landing U7: `UI-WATCH-HERO-VESTED`
- **notes:** Derived in render. Clamped at stream end. Does not authorise
  borrow — `UI-WATCH-BORROW-ROUTE` uses the borrow-route predicate on
  `chain.stream-truth`. Pledged streams link to their loan; they do not keep
  interpolating as if unpledged collateral at risk.

### `schedule.cover-date`

Approximate done-date for an open loan, `~` day precision.

- **trust_domain:** `pure-client`
- **writers:**
  - `web/lib/payoff.ts` — landing U5: pure over `(schedule, outstanding, now)`
- **readers:**
  - `web/components/watch/BorrowedDetail.tsx` — landing U7: done-date + live countdown
  - `web/components/watch/Wall.tsx` — landing U7: borrowed-row state line
  - `web/components/kit/Receipt.tsx` — landing U4: review shows current `~` date (token-exact elsewhere)
- **notes:** Derived, not a quote. Prefix `~`. Recomputed each read and each
  tick from the last-read outstanding plus schedule. Never a gate. No health
  factor sits beside it.

### `schedule.repay-preview`

The cover date a typed repay amount would produce, before signing.

- **trust_domain:** `pure-client`
- **writers:**
  - `web/lib/payoff.ts` — landing U5: same function as `schedule.cover-date` with reduced outstanding
- **readers:**
  - `web/components/kit/Receipt.tsx` — landing U4: `UI-REVIEW-REPAY` current vs new date
  - `web/components/watch/BorrowedDetail.tsx` — landing U7: preview inside the repay flow
- **notes:** AE6. Display of a typed amount (`action.amount-raw`) against
  on-chain outstanding. The signed repay is rebuilt from live values at submit.
  Never presented as a guaranteed new date if the fill can clamp.

### `schedule.freshness`

Split-truth classification: events as-of vs schedule still moving.

- **trust_domain:** `pure-client`
- **writers:**
  - `web/lib/freshness.ts` — landing U5: SYNCED / RECONNECTING / DEGRADED / UNAVAILABLE from query status + last successful event read
  - `web/hooks/useFreshness.ts` — landing U6: exposes the class
- **readers:**
  - `web/components/kit/StatusLine.tsx` — landing U4: `UI-SHELL-STATUS`
  - `web/components/watch/SuppliedDetail.tsx` — landing U7: `UI-WATCH-FRESHNESS`
  - `web/components/watch/BorrowedDetail.tsx` — landing U7: entity as-of caption
  - `web/hooks/useWriteFlow.ts` — STALE rules disable signing when degraded
- **notes:** Derived from on-chain read status, not a chain fact of its own.
  AE1: when RPC is unreachable the ribbon edge and schedule numbers keep
  moving, this key shows events as-of, and signing is disabled. `unavailable`
  (no successful event read yet) is not `degraded` (had a read, now failing)
  and not empty. USD unavailability is `usd.staleness`, a sibling class on
  `UI-SHELL-STATUS`, not this key.
