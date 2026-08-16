# OVRFLO Web Standard

> The micro-decision guide for Markets frontend work (`web/`). Every rule cites
> its source and carries a MUST or SHOULD force. UI meaning still lives in
> `docs/maps/ui/` (briefs win; this file does not invent product behaviour).
> Client-state blast radius lives in `docs/maps/state/keys/`. Solidity rules
> live in `ovrflo-coding-standard.md` — this file does not repeat them.
>
> Compiled 2026-08-12 (watch-surface U3) from: ponytail (ladder, platform-native
> preference, ceiling comments, hard floors, one-runnable-check floor);
> react.dev; TkDodo's React Query series; Ousterhout, *A Philosophy of Software
> Design*; Vercel Web Interface Guidelines (WIG); WAI-ARIA APG; ethskills
> `frontend-ux`; lexi-lambda parse-don't-validate; Total TypeScript branded
> types / tsconfig.

Walk the matching section before writing. A later unit that invents a parallel
rule is a defect in that unit, not an amendment here.

---

## Force

- **MUST** — review-blocking. A diff that violates it does not merge.
- **SHOULD** — default. Deviating needs a recorded reason (comment or scratch
  decision), not silence.

**Hard floors are never simplifiable.** Ponytail's exception, adopted as a
floor on every section below:

> Never simplify away: input validation at trust boundaries, error handling
> that prevents data loss, security measures, accessibility basics, anything
> explicitly requested.

(Source: ponytail, "When NOT to be lazy".) Accessibility, trust-boundary
validation, error handling, and security are MUST even when the lazier diff
would drop them.

---

## Ponytail conventions (adopted verbatim)

**Ceiling comments.** Deliberate simplifications that cut a real corner with a
known ceiling (global lock, O(n²) scan, naive heuristic) are marked with a
`ponytail:` comment naming the ceiling and upgrade path
(`# ponytail: global lock, per-account locks if throughput matters`).
MUST. (Source: ponytail, Rules.)

**One-runnable-check floor.** Lazy code without its check is unfinished.
Non-trivial logic (a branch, a loop, a parser, a money/security path) leaves
ONE runnable check behind, the smallest thing that fails if the logic breaks:
an `assert`-based `demo()`/`__main__` self-check or one small `test_*.py`. No
frameworks, no fixtures, no per-function suites unless asked. Trivial
one-liners need no test, YAGNI applies to tests too.

In this repo that maps to: one Vitest file under `web/tests/` that fails if the
logic breaks — not a suite per helper, not a Playwright scenario for a pure
function. MUST for money, parsing, payoff, eligibility, and error-decoding
paths (U5+). (Source: ponytail, "When NOT to be lazy".)

**The ladder.** Stop at the first rung that holds: does this need to exist;
already in this codebase; stdlib; native platform; already-installed
dependency; one line; only then the minimum that works. SHOULD, then MUST
once the problem has been read end to end — laziness that skips comprehension
is banned. (Source: ponytail, The ladder.)

---

## 1. Where does state live

Walk this ladder before `useState`. Stop at the first home that fits. MUST.
(Source: `docs/maps/state/README.md` "Where does the value belong?"; react.dev
"Choosing the State Structure" / "Sharing State"; ponytail-fullstack-web3
`frontend-state`; WIG: URL reflects state.)

1. the URL (`?lens=`, `?lending=`, `?position=`, `?loan=`, `?stream=`);
2. browser/platform state (focus, `matchMedia`, native `<dialog>` / `<details>`);
3. server or chain state — read it, don't copy it (KTD9: TanStack Query is the
   only chain-state store);
4. the query cache (wagmi/TanStack already dedupe by query key);
5. derived render state — compute it, don't store it (schedule interpolation);
6. a persisted operation (the execution registry, the tx queue);
7. genuinely client-owned application state — only now a new key in
   `docs/maps/state/keys/`.

- **W1.** A new client key arrives with trust domain, writers, and readers
  declared. MUST. (Source: `docs/maps/SCHEMAS.md` §3.)
- **W2.** Do not mirror chain state into Zustand, Redux, or a context cache.
  MUST. (Source: KTD9; TkDodo "React Query as a State Manager".)
- **W3.** Query keys are factories colocated in `web/lib/query-keys.ts`, treated
  as dependency arrays. No inline key literals at `useQuery(` call sites. MUST.
  (Source: TkDodo "Effective React Query Keys"; KTD9.)
- **W4.** Invalidation after receipts is the declared `touchedResources` set,
  at the broadest sensible level. MUST. (Source: KTD9; TkDodo "Invalidations".)
- **W5.** Reads batch only when `enabled` predicates match character-for-character.
  MUST. (Source: `docs/solutions/integration-issues/wagmi-read-batching-requires-matching-enabled-predicates.md`.)
- **W6.** Client-only persisted state (lens, USD mode, acknowledgment, drafts,
  scan checkpoint) applies in an effect after first paint, never as a
  render-read of `localStorage`. MUST. (Source: react.dev "You Might Not Need
  an Effect" — hydration mismatch; Next.js static export.)
- **W7.** Tick state stays inside `RollingNumber` / canvas subscribers. Rows
  subscribe to the clock only when a schedule-backed value is visible. SHOULD.
  (Source: react.dev "Keeping Components Pure"; KTD6 re-render containment.)

---

## 2. Is this an effect

- **E1.** If it can be computed during render from existing state and props, it
  is not an effect. MUST. (Source: react.dev "You Might Not Need an Effect".)
- **E2.** Synchronizing with an external system (wallet, Query, `matchMedia`,
  the clock store, `localStorage`) is a legitimate effect. MUST use
  `useSyncExternalStore` for the clock and for any store that can update
  outside React. (Source: react.dev `useSyncExternalStore`; KTD6;
  `docs/solutions/design-patterns/shared-hook-safety-depends-on-render-tree-position.md`.)
- **E3.** Transforming data for display is render work, not an effect. Schedule
  interpolation is a pure function of schedule params × clock. MUST.
  (Source: react.dev "You Might Not Need an Effect"; KTD6.)
- **E4.** Effects that subscribe (clock, rAF, storage, media) are
  StrictMode-idempotent: double-invocation leaves one subscription. MUST.
  (Source: react.dev Strict Mode; KTD6.)
- **E5.** One pending state per on-chain button; never one shared `isLoading`
  across Approve and Action. MUST. (Source: ethskills `frontend-ux` Rule 1.)
- **E6.** Resetting state because a prop changed is usually a `key` remount or
  derived state, not an effect. SHOULD. (Source: react.dev "You Might Not Need
  an Effect" — storing derived data; `review.reload-key`.)

---

## 3. How is money typed

- **M1.** `Wei`, token amounts, `Usd`, `Bps`, and tick indices are branded
  types minted only by validating constructors in the parsing module. MUST.
  (Source: lexi-lambda "Parse, don't validate"; Total TypeScript branded types;
  KTD8.)
- **M2.** RPC responses, URL params, and `localStorage` are parsed into precise
  types at entry. Bare `as`-casts to a brand outside the boundary module are
  banned. MUST. (Source: lexi-lambda; KTD8.)
- **M3.** All amount arithmetic goes through `web/lib/units.ts` helpers whose
  signatures reject cross-brand mixing. Raw arithmetic operators on branded
  amount values outside that file are banned. MUST. (Source: KTD8; the helper
  layer is the web's SafeCast.)
- **M4.** Ratio and percentage math stays in bigint (mulDiv-style: scale,
  divide, then narrow). `Number(bigint)` is banned on token amounts. MUST.
  (Source: ECMA-262 `Number.MAX_SAFE_INTEGER`; `web/scripts/check-banned-patterns.sh`.)
- **M5.** Conversion to `number` happens only after scaling to display
  magnitude. `Intl` formatters consume the scaled display value, never the raw
  wei bigint via `Number`. MUST. (Source: M4; `Intl.NumberFormat`.)
- **M6.** Display formatting truncates toward zero — claimable never rounds up
  past what `streamedAmountOf` yields. MUST. (Source: KTD6 clamp; U5 approach.)
- **M7.** Persistence uses a bigint-safe serializer. `JSON.stringify` throws on
  bigint; drafts and cached state must round-trip. MUST. (Source: U5 approach;
  MDN `JSON.stringify`.)

---

## 4. When do I add a dependency

- **D1.** No new runtime dependencies. A new dependency requires a KTD
  amendment with the ponytail-ladder justification written down. MUST.
  (Source: KTD11; ponytail ladder rungs 3–5; mcfunley "Choose Boring
  Technology".)
- **D2.** Ribbons are hand-drawn canvas; formatting is `Intl.*`; dialogs are
  native `<dialog>` where a modal is needed. MUST. (Source: KTD11; WIG;
  ponytail platform-native.)
- **D3.** Already-installed stack (Next.js, wagmi, viem, TanStack Query) is
  used before a helper package that overlaps it. SHOULD. (Source: ponytail
  ladder rung 5.)

---

## 5. When do I abstract

Ousterhout's two questions, applied before a new module, hook, or kit wrapper:

1. Does this hide a complexity that callers would otherwise repeat?
2. Is the interface smaller than the implementation it replaces?

If both are not yes, do not extract. SHOULD, MUST when the extraction would
cross a trust boundary (a "convenient" helper that accepts projection fields
and returns a boolean gate is a defect, not an abstraction).

- **A1.** Information hiding beats shallow wrappers. A one-line pass-through
  function is not a module. SHOULD. (Source: Ousterhout, deep modules.)
- **A2.** Altitude is lib first, hooks second, components last. Book math,
  payoff, units, parsing, and error decoding live in `web/lib/` and are
  testable without React. MUST. (Source: KTD4;
  `docs/solutions/architecture-patterns/web-markets-outcome-first-planners-and-tx-queue.md`.)
- **A3.** Do not invent a parallel catalog (hand-maintained function index,
  second key map, shadow brief). MUST. (Source: `docs/maps/SCHEMAS.md` §3;
  ponytail YAGNI.)
- **A4.** Define errors and empty out of existence where the type system can
  (discriminated `ReadOutcome`, branded constructors that throw at the
  boundary). SHOULD. (Source: Ousterhout "define errors out of existence";
  lexi-lambda.)

---

## 6. Platform before package

Ponytail platform-native preference, bound to this stack. MUST unless a KTD
already named the exception.

| Job | Platform | Not |
|---|---|---|
| Modal | `<dialog>` | overlay kit |
| Disclosure | `<details>` or `<button aria-expanded>` | accordion kit |
| Tabs | APG tablist (roving tabindex, arrows, Home/End, automatic activation) | tabs kit |
| Number / date / currency format | `Intl.*` | numeral / date-fns / bignumber display libs |
| Decimal input | `<input inputmode="decimal">`, ≥16px on mobile, paste allowed | masked-input kit |
| Fonts | `next/font/local` | runtime font loader |
| Motion preference | `prefers-reduced-motion` `change` events | motion library |
| URL state | `searchParams` (`?lens=` `?position=` `?loan=` `?stream=`) | extra router store |
| Focus | `:focus-visible` 2px ink outline | focus-trap package unless already in tree |

(Source: ponytail ladder rungs 3–4; WIG; APG tabs / spinbutton / disclosure /
meter; web.dev `prefers-reduced-motion`; Next.js font docs; KTD7, KTD11, KTD13.)

- **P1.** Stepper paddles are plain labeled buttons, not `spinbutton` — they
  page a window, they do not edit a value. MUST. (Source: KTD7; APG.)
- **P2.** Ticking regions are `role="timer"` (implicit `aria-live="off"`).
  `aria-live="polite"` is reserved for discrete milestones. MUST.
  (Source: KTD7; ARIA 1.2 `timer`; `UI-WATCH-MILESTONE`.)
- **P3.** Repayment / capital bands are `role="meter"` with `aria-valuetext`.
  MUST. (Source: KTD7; APG meter.)
- **P4.** Decorative canvas motion stops on `prefers-reduced-motion`; numeric
  text keeps updating. MUST. (Source: web.dev; KTD6.)
- **P5.** `ActionButton` requires a reason when disabled. SHOULD.
  (Source: WIG; ethskills `frontend-ux`; `docs/maps/ui/CODING_STANDARD.md`
  CS-S9.)

---

## 7. Browser-runtime pathology

The rules the canon does not write down. All MUST. They exist because the
watch surface interpolates money against a local clock in a real browser.

- **B1. Absolute-time derivation.** Every displayed live value is a pure
  function of absolute time and the schedule. Accumulating per-tick deltas is
  banned. Background tabs throttle timers; a returning tab must be instantly
  correct. (Source: KTD6; HTML/event-loop timer throttling.)
- **B2. Clock-skew offset.** The interpolation clock carries a skew offset
  estimated from `block.timestamp` on each read. Slow client clocks otherwise
  lag the chain — countdowns lie late, close-ready flips late. Countdowns
  clamp at zero and hand off to event truth. (Source: KTD6.)
- **B3. Bigint-only ratio math.** `Number(bigint)` silently corrupts above
  2^53, which every 18-decimal amount exceeds. Scale, divide, then narrow.
  Conversion to `number` happens only after scaling to display magnitude.
  (Source: ECMA-262 `Number.MAX_SAFE_INTEGER`; M4.)
- **B4. Bigint-safe serialization.** `JSON.stringify` throws on bigint. Drafts
  and cached state round-trip through an explicit serializer. (Source: MDN;
  M7.)
- **B5. One shared rAF driver.** Every animated surface subscribes to one
  driver. Never one loop per component. The driver is StrictMode-idempotent.
  (Source: KTD6.)
- **B6. `devicePixelRatio` canvas scaling.** Canvases size at
  `width × devicePixelRatio` with context scaling, and re-size on dPR change
  (zoom, monitor drag — `matchMedia`) so dots stay crisp. (Source: U4
  approach; MDN `devicePixelRatio`.)
- **B7. Memoized `Intl` formatters.** Construct per `(locale, options)` once;
  do not allocate a formatter per frame. `RollingNumber` formats from the
  bigint every frame, never from a cached float (a float cache ticks
  backwards). (Source: U4 approach; `Intl.NumberFormat`.)
- **B8. Throw-tolerant storage with max-merge checkpoints.** Every
  `localStorage` touch goes through one wrapper. Safari private mode throws;
  degraded storage falls back to defaults / cold-scan, never errors. The
  stream-scan checkpoint write takes `max(existing, new)` so a stale tab
  cannot regress a fresher tab. Multi-tab. (Source: U6 approach.)
- **B9. Effects-only client state on static export.** Lens, USD mode, and
  acknowledgment apply in effects after first paint. A render-read of
  `localStorage` is a hydration mismatch. (Source: Next.js static export;
  react.dev hydration; W6.)
- **B10. StrictMode idempotency.** Clock store, rAF driver, and executor
  latches remain single-armed under double-invocation. (Source: react.dev
  Strict Mode; E4; KTD6.)
- **B11. Locale-aware decimal input parsing.** A German keyboard types `1,5`.
  Parse decimal strings with the locale's separators at the form boundary;
  do not assume `.` is the radix. Paste is never blocked. (Source: WIG;
  `Intl.NumberFormat`; ECMA-402.)

---

## 8. Trust, errors, and copy (floors)

These are MUST and are not simplifiable under the ponytail hard-floor rule.

- **F1.** A field that reaches `if (…) allow` is re-read from the on-chain
  authority. Projection never gates. (Source: `docs/maps/SCHEMAS.md` §2;
  `docs/solutions/security-issues/indexer-is-a-discovery-hint-not-an-authority.md`;
  ethskills `frontend-ux`.)
- **F2.** Loading, empty, unavailable, failed, and stale stay distinguishable.
  Empty and could-not-ask never share a representation. (Source: SCHEMAS.md §1;
  PRODUCT.md principle 5.)
- **F3.** Error decoding enumerates the generated ABI; raw selectors never
  reach the user. Every contract error has human copy plus one recovery
  action. (Source: KTD10; ethskills `frontend-ux` Rule 7.)
- **F4.** See-equals-sign: reviewed calldata is submitted calldata. Drift
  returns to review. (Source: ethskills `frontend-ux`;
  `docs/maps/ui/CODING_STANDARD.md` CS-M8.)
- **F5.** No health-factor, liquidation, or engagement mechanic in copy or
  identifiers. (Source: PRODUCT.md; `docs/maps/ui/CODING_STANDARD.md` CS-P1.)
- **F6.** USD is display-only. Never on receipts, never in tx params.
  (Source: KTD14; `UI-SHELL-TOKEN-USD`.)

---

## How to cite

Review findings cite a rule id (`W2`, `B3`, `F1`) plus the source. Product
meaning still cites `docs/maps/ui/CODING_STANDARD.md` (`CS-S2`) and the brief
entry. When this file and a brief disagree on meaning, the brief wins; when
they disagree on engineering, this file wins.
