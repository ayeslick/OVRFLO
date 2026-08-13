# Stack fitness — scorecard

**No stack migration is decided or performed by this document, or by the effort that
produced it.** The incumbent Next/React Markets client stays. This file is a scoring
instrument and a recorded first run of it — nothing here authorises a framework
change, a dependency change, or a rewrite, and no replacement stack is named as
preferred. Plan decision D9 is *build on current Next/React first; score fitness once
the maps exist; set the stack afterwards.* This is the scoring half of D9, not the
setting half.

**A stack change is not an Owner escalation trigger** (`REVIEW.md`). Nothing in this
scorecard should be read as raising one. This file is the scoring instrument, not
Owner-scheduled work; re-run it when the evidence inputs change.

Charter: `README.md`. Schemas: `SCHEMAS.md`. Review contract: `REVIEW.md`.

---

## What this is for

The question a later review has to answer is narrow:

> Does the incumbent client stack meet the **AI-maintainability** bar — can a coding
> agent change this UI with declared blast radius and durable rationale — and would a
> different stack meet it better by enough to justify the move?

This file answers the first half with a repeatable measurement and leaves the second
half open. It scores five dimensions, each with a 0–4 rubric whose anchors are
checkable claims rather than impressions. The test of the instrument is whether a
different reviewer, given only the inputs below, lands within a point of the same
score. If a score cannot be re-derived from the evidence cited, the rubric is broken
and should be fixed before it is argued with.

**Scoring is of the incumbent against an absolute rubric, not against a rival.** There
is no column for Elixir, SolidJS, or anything else, and adding one is a separate,
separate exercise. A rival stack is scored by running the *same* rubric against
it, which requires building enough of it to have evidence — which is exactly the cost
this scorecard exists to make visible before anyone pays it.

## Evidence inputs

Every score below is derived from the maps:

- `docs/maps/state/keys/*.md` — 50 client state keys, each with `trust_domain`,
  `writers`, `readers`, `notes`
- `docs/maps/state/functions/INDEX.md` — generated module→keys index and key→readers
  reverse lookup (46 modules)
- `docs/maps/ui/*.md` — six region briefs, 53 controls
- `web/reviews/testing.md` — test inventory, taken 2026-08-03
- `docs/maps/SCHEMAS.md` §1–§3, `docs/maps/REVIEW.md`

Two dimensions cite **corroborating** files outside the maps — `web/package.json` and
`web/next.config.ts`. They are marked as corroboration wherever they appear. Each
rubric anchor is written so it can be decided from map evidence alone; the outside
files confirm a conclusion the maps already support, and a re-run that skips them
still produces a score.

**Nothing here is edited to reach a target.** Where the incumbent scores badly it is
recorded as scoring badly.

## Scale

| Score | Meaning |
|---|---|
| 0 | The property is absent. |
| 1 | Present in intent only — documented or aspired to, with nothing holding it. |
| 2 | Held by convention, tests, and review. A careless change can still break it. |
| 3 | Held by a mechanical check that fails the build, the gate, or the run. |
| 4 | Held by construction — the failure mode is not expressible. |

A 2 is not a bad score. It is the honest resting state of most properties in a
TypeScript app, and it means *the load is carried by people and tests rather than by
the compiler*. The reason to record it is that this is precisely the load an AI
maintainer either carries reliably or does not.

This table is the general reading of a number. **Each dimension's own anchor table is
what you score against** — D4 and D5 describe capability and cost rather than
enforcement, so their anchors are shaped accordingly. Score the anchors, then sanity-
check the result against the scale above.

---

## D1 — AI reasonability of the state graph

**Question.** Can an agent, before editing, enumerate the state it touches and every
module that depends on it — from the maps, without reading `web/`?

### Rubric

| Score | Anchor |
|---|---|
| 0 | No catalog. Blast radius is answerable only by reading source. |
| 1 | A catalog exists but both the key list and any index are hand-maintained; drift between them is undetectable. |
| 2 | Keys are the single source of truth, the index is generated from them, and a `--check` mode fails on drift **between the two** — but catalog↔code fidelity is unverified. |
| 3 | As 2, plus a mechanical gate fails when state added or changed in `web/` has no catalog entry. |
| 4 | The graph is derivable from the runtime or the type system; the document is generated from code rather than mirrored by hand. |

### Evidence

- 50 keys across 5 files, 46 modules, catalogued at `docs/maps/state/keys/`;
  `functions/INDEX.md` carries the generated `Coverage` table reporting the same
  counts, plus per-module trust-domain exposure and a key→readers reverse lookup.
- The generator validates as it parses: an unknown `trust_domain`, an empty `writers`
  or `readers` list, a duplicate key, or an unrecognised field fails the run
  (`state/README.md`). `--check` exits non-zero on drift.
- Locality is real and measurable. 20 of 50 keys touch exactly one module
  (`chrome.copy-value.copied`, `positions.loaded-user`, `claim-all.review-plan`,
  `executor.registry`, …); 29 of 50 touch at most two. Mean module span by domain:
  `pure-client` 2.3, `on-chain` 5.0, `projection` 8.8.
- The widest keys are named and traceable: `projection.market-apr` spans 13 modules
  (4 writers, 9 readers), `chain.connection` spans 12 (2 writers, 10 readers),
  `projection.lender` 10, `projection.stream` 9.

### Score: 2 / 4

It clears 2 outright — keys are source of truth, `INDEX.md` is generated and carries
the `GENERATED FILE — DO NOT EDIT` banner, and `--check` is a real drift gate wired as
`npm run lint:state-index`.

It does not reach 3, and the reason is precise. `--check` verifies the index against
the keys; **nothing verifies the keys against `web/`.** The presence gate
(`tools/scripts/check-maps-presence.sh`) fails a change under `web/components/` or
`web/hooks/` that carries *no* companion under `docs/maps/ui/`,
`docs/maps/state/keys/`, or a numbered `docs/adr/NNNN-*.md`, and that is not
exact-path exempted in `tools/scripts/maps-presence-exemptions.txt` — which is a real
and useful floor, and closes the "changed
the UI, updated nothing" case. It is presence, not fidelity: a change that edits a
region brief satisfies the gate while adding an uncatalogued `useState` in
`BorrowFlow.tsx`. Anchor 3 asks for the second thing. Closing the gap needs a check
that can name client state in source and compare it to the catalog — which brings us
back to why 4 is out of reach here.

### Where it scores badly

- **There is no runtime state registry to derive the graph from.** React local state
  plus a TanStack cache cannot be enumerated by introspection, so the catalog is a
  hand-written mirror. That is the structural ceiling on this dimension for this
  stack — 4 is not reachable by better discipline, only by a different state
  substrate. Recording that is not a recommendation to go get one.
- **A key names meaning, not identity** (`state/keys/README.md`). `action.amount-raw`
  lists five writers, but those are five independent per-flow `useState` values
  sharing one name, not five writers to one cell. An agent reading "5 writers"
  and inferring shared mutable state would be wrong. Neither the catalog nor the
  index says so today — the `action.amount-raw` notes cover string-vs-`bigint`
  representation, not writer independence — which is itself a gap worth closing.
- **`chain.wagmi-reads` is a coarse node.** Six writers spanning four hooks plus
  `invalidate.ts` and `query-resource-registry.ts`, describing a cache surface rather
  than a value. It is the one entry where "who writes this?" does not narrow much.

### Re-run checklist

Run the generator's `--check`; read the `Coverage` table; recompute the span
distribution (appendix). Score 3 only if a gate now fails on uncatalogued state in
`web/`.

---

## D2 — Trust-domain honesty

**Question.** Does the stack keep *on-chain*, *projection*, and *pure-client* apart
where it matters — and specifically, does it keep *empty* and *could not ask* from
collapsing into one rendering?

### Rubric

| Score | Anchor |
|---|---|
| 0 | No trust-domain concept. Displayed facts are undifferentiated. |
| 1 | Domains are documented but there is one loading/empty representation; a failed read renders as a confident zero. |
| 2 | Every key carries a domain the tooling validates; reads resolve to a multi-status outcome; every `projection` key carries fail-closed guidance — enforcement is convention, tests, and review. |
| 3 | As 2, plus the type system or a mechanical check makes ignoring unavailability an error on the paths that display or gate. |
| 4 | As 3, plus a `projection` value cannot reach an `if (…) allow` by construction, not by review. |

### Evidence

- All 50 keys carry `trust_domain`; the generator rejects any value outside
  `on-chain` · `projection` · `pure-client`. Distribution: 9 `on-chain`,
  5 `projection`, 36 `pure-client`.
- Reads resolve to `ReadOutcome` (`web/lib/read-outcome.ts`) with four statuses —
  `loading` · `ready` · `partial` · `unavailable` — and `freshness` on the two that
  carry data.
- All five `projection` keys carry fail-closed guidance in `notes`; four open with a
  literal **Fail-closed contract** paragraph. The fifth,
  `projection.claim-verifier`, carries the strongest rule in the catalog: when two
  independent RPC providers disagree the outcome is `blocked` with reason
  `provider-disagreement` — not a merge, not the primary's answer, and not a warning
  the user can click past. `getProjectionClient("verifier")` throws rather than
  corroborate a projection against itself, and `staleTime` is `0` so a cached
  agreement cannot authorise a later batch.
- `projection.demand` is the worked example: `demandCellCopy` renders three distinct
  answers — `DEMAND —` (loading), `DEMAND: NO DATA` (unavailable),
  `NO LOANS IN 30 DAYS` (genuinely empty) — because the first and third point a lender
  in opposite directions.
- The briefs carry the same discipline at the control level:
  `UI-POSITIONS-CLAIM-ALL` documents `projection` for the candidate set and treats it
  as blocking, and `UI-POSITIONS-STREAMS-UNAVAILABLE` exists as a control in its own
  right rather than as an empty state.

### Score: 2 / 4

### Where it scores badly

- **TypeScript permits the exact mistake the catalog warns about.** `useHeldStreams`
  returns `streams` and `unavailable` as sibling fields, and `projection.stream`'s own
  note says a consumer reading `streams` while ignoring `unavailable` "will render a
  confident empty portfolio during a transport failure." `projection.lender` carries
  the identical warning for `pools` / `loans`. The hazard is live, documented, and
  compiles.
- That gap is **an app design choice, not a limit of the stack.** Returning a
  discriminated union that cannot be destructured into a bare list would move this to
  3 in TypeScript today. A later reviewer must not charge this to the framework — it
  is a seam the incumbent stack can close and has not.
- **The riskiest domain has the widest blast radius.** Mean module span: `projection`
  8.8 versus `pure-client` 2.3. All five `projection` keys sit in the top fourteen by
  span. The gradient runs the wrong way, and any change to a projection hook is by
  construction a wide change.

### Re-run checklist

Confirm the domain counts from `INDEX.md`'s `Coverage` table. Confirm every
`projection` key still carries fail-closed guidance naming which consumer
distinguishes empty from unavailable. Score 3 only when ignoring unavailability
becomes an error — via the type system **or** a mechanical check, as anchor 3 allows —
on **every** consumer named in a `projection` key's `readers` list. Partial coverage
scores 2.

---

## D3 — Testability

**Question.** How much of the correctness of this app is provable cheaply, without a
browser and without a chain — and how much of that survives a stack change?

### Rubric

| Score | Anchor |
|---|---|
| 0 | No test inventory; coverage claims unverifiable. |
| 1 | Tests exist; the catalog is stale or file-keyed, so it goes wrong on the first refactor. |
| 2 | Catalog is current and behavior-keyed; the majority of correctness sits in pure functions and mechanical checks; the default unit suite runs with no external service. |
| 3 | As 2, plus the suite is green and every mapped control is traceable to a covering test. |
| 4 | As 3, plus the end-to-end loop runs without a bespoke local chain. |

### Evidence (`web/reviews/testing.md`, inventory 2026-08-03)

- 66 vitest files, 714 cases, partitioned into eight areas that sum exactly to 714.
  6 Gherkin features, 31 scenarios. Catalog is explicitly area-keyed, not file-keyed,
  "because a catalog that lists individual filenames goes stale on the first refactor
  and then quietly lies."
- Stack-portable share: action planning and validation 176, discovery and projection
  trust 96, configuration/packaging/mechanical bans 70, state honesty and read
  outcomes 63 — **405 of 714 cases (57%)** are pure-function or mechanical and would
  survive a UI-layer change largely intact.
- The two highest-risk areas are the two best covered relative to their surface:
  transaction execution and finality (71 cases — simulate-then-submit identity,
  success only on a confirmed receipt, mined-revert classification) and discovery and
  projection trust (96).

### Score: 2 / 4

### Where it scores badly

- **The suite is not green.** 713 passed, 1 failed on 2026-08-03 —
  `tests/components/markets-table.test.tsx`, disconnected expanded row, `DEPOSIT PT`
  button lookup. Reproduces deterministically on a clean tree, undiagnosed. Anchor 3
  requires green; this fails it on the plainest reading.
- **Brief→test traceability does not exist yet.** Control-ID tags are the target shape
  (charter authority order, plan D6), but `ui/README.md` records that **no `.feature`
  file carries one** — all six of `adjust-rate`, `borrow`, `claim-all`,
  `deposit-wrap-unwrap`, `repay-close`, `supply` are untagged. 31 scenarios against 53
  mapped controls, with no mechanical link between them. An agent asking "is this
  control covered?" cannot answer from the maps.
- **200 cases — 28% of the suite — are React component tests** (`Markets UI regions`).
  This is the executable half of the region briefs and it is the most stack-coupled
  asset in the repo. A migration forfeits it; the briefs themselves would survive,
  which is part of why they exist.
- **The e2e loop needs a seeded local Anvil mainnet fork** (`bootstrap:local`). That
  is the expensive part of the cycle and it caps this dimension at 3 regardless of the
  other clauses.

### Re-run checklist

Re-run the inventory commands in *Refreshing this catalog* in `web/reviews/testing.md`
rather than trusting these numbers. Score 3 only on a green suite **and** a mechanical
link from every mapped control to at least one covering test — a tagged Gherkin
scenario or a tagged unit test both count; anchor 3 says "covering test", not
"scenario". No test file references a `UI-` id today, so neither route is started.

---

## D4 — Wallet / EVM ecosystem fit

**Question.** How well does this stack serve the work that is actually hard here —
connector lifecycle, typed contract reads, simulate-then-submit, and post-write cache
reconciliation — and is that layer confined to a seam?

### Rubric

| Score | Anchor |
|---|---|
| 0 | No maintained wallet/EVM libraries for the stack; JSON-RPC is hand-rolled. |
| 1 | Libraries exist, but no maintained multi-wallet connector story and no typed ABI surface. |
| 2 | First-class typed client and connector stack, but chain reads sit outside the app's caching and invalidation layer. |
| 3 | As 2, plus reads, caching, and post-write invalidation are one integrated layer used across the app. |
| 4 | As 3, plus that layer is confined to a seam — `on-chain` keys are written by hooks and lib modules, not by feature components. |

### Evidence

- The wallet/EVM layer is not decoration; the state map shows it *is* the read layer.
  `chain.wagmi-reads` has six writers — `useOvrflos`, `useAllMarkets`,
  `useMarketSymbols`, `useLending`, `web/lib/invalidate.ts`,
  `web/lib/query-resource-registry.ts` — and three readers including `useWriteFlow`.
  Reads, cache identity, and post-write reconciliation are the same layer, which is
  anchor 3 satisfied directly from the catalog.
- **The seam holds for 8 of 9 `on-chain` keys.** `chain.vault-registry`,
  `chain.markets`, `chain.market-symbols`, `chain.lending-config`,
  `chain.block-timestamp`, `chain.wagmi-reads`, `query.streams.held`, and
  `query.demand.market` are all written only from `web/hooks/` or `web/lib/`. No
  feature component writes a chain read.
- Corroboration (`web/package.json`): 9 runtime dependencies, of which 6 are the
  EVM/wallet layer — `wagmi` 3.7.3, `viem` 2.55.5, `@reown/appkit` and
  `@reown/appkit-adapter-wagmi` 1.8.23, `@tanstack/react-query` and
  `@tanstack/query-core` 5.90.12 (required by wagmi). All exact-pinned; no ranges.

### Score: 4 / 4 — with a recorded judgment call

The one exception to the seam is `chain.connection`, written by
`web/components/Providers.tsx` and `web/components/WalletRuntime.tsx`. Those are the
provider shell — they *are* the seam — so this reads as 4. **A re-runner who treats
them as ordinary components scores this a 3.** That difference is a judgment call, not
a measurement, and it should be recorded either way rather than smoothed over.

### What a high score here means for a migration

This is the incumbent's strongest dimension and therefore the most expensive one to
leave. `chain.connection` has **10 readers**, so connector lifecycle is load-bearing
across the app; a replacement must reimplement it, plus the simulate-then-submit
executor behind 71 test cases, plus scoped invalidation. A high score is not an
argument for staying — it is the price tag on going, stated plainly.

### Caveats a later review should carry

- **Single-vendor concentration** on Reown AppKit for wallet connection. Two of nine
  runtime dependencies, at one version, on the path every user takes.
- **Two distinct RPC providers are a hard requirement**, not a nicety —
  `getProjectionClient("verifier")` throws when no second provider is configured
  (`projection.claim-verifier`). Any stack inherits this; it is a deployment
  constraint, not a framework property.

### Re-run checklist

Recount the `on-chain` key writers from `INDEX.md`. Score 4 only if every writer
outside the provider shell sits under `web/hooks/` or `web/lib/` — and record the
provider-shell judgment call either way, because the score depends on it. Re-derive
the dependency split from `web/package.json` rather than trusting the count above.

---

## D5 — Operational cost

**Question.** What has to be running for this UI to work, and what does a change cost
to ship and to verify?

### Rubric

| Score | Anchor |
|---|---|
| 0 | Multiple backend services must be running for the UI to render. |
| 1 | One always-on backend service — indexer, API, or session tier — is required. |
| 2 | Client is static, but a privileged tier (secret-bearing build, server middleware, or hosted gate) still has to be operated. |
| 3 | No server participates in UI state; external runtime dependency is limited to RPC providers. |
| 4 | As 3, plus per-user read load is bounded and the end-to-end loop needs no bespoke local chain. |

### Evidence

- **The entire state graph is browser-side.** All 46 modules in `INDEX.md` sit under
  `web/components/`, `web/hooks/`, or `web/lib/`. No server module appears as a writer
  or reader of any of the 50 keys — the catalog itself is the proof that no server
  tier participates in UI state.
- Indexers are gone and their absence is a **guarded invariant**, not an accident: the
  discovery and projection area's 96 cases include holding that "the deleted indexer
  stack stays deleted across every source tree" (`web/reviews/testing.md`).
- **One vendor-operated service sits on the connection path.** Wallet connection
  depends on Reown/WalletConnect's hosted infrastructure (`reownProjectId` in
  `web/lib/wagmi.ts`, passed to both `WagmiAdapter` and `createAppKit`; the file's own
  comment notes construction "performs Reown/WalletConnect setup at module scope").
  Anchor 3's "limited to RPC providers" is read as excluding vendor-operated services
  this project does not run — which is why this scores 3 rather than 2. A re-runner
  who reads the anchor as covering any third-party runtime dependency scores 2.
- No hosted CI tier is operated today — the repository has no `.github/` directory.
  Gates are the mechanical checks in `REVIEW.md` plus the review skills, run locally:
  `check-banned-patterns.sh`, `check-maps-presence.sh`, and the state-index
  `--check`. They cost a shell invocation and no infrastructure.
- Corroboration: `web/next.config.ts` sets `output: "export"`, and `web/app/` contains
  no route handlers, so the build artifact is static. CSP ships as deploy-target
  config generated by `scripts/build-csp.mjs` precisely because Next's `headers()` is
  a no-op under export.

### Score: 3 / 4

### Where it scores badly

- **The browser inherited the indexer's job.** Log scanning moved client-side
  (`web/lib/discovery/log-scanner`, `lending-projection.ts`, `live-projection.ts`), so
  RPC egress scales per user rather than per deployment. Deleting the indexer removed
  an operated service and converted its cost into a variable one.
- **The claim path deliberately doubles reads** across two distinct providers, because
  corroboration is the mechanism that makes `projection.claim-verifier` safe. That is
  a correctness decision with a standing cost, and it should never be optimised away
  on cost grounds without reopening the trust argument.
- **The e2e loop needs a seeded local Anvil mainnet fork.** This is the single largest
  cost in the change cycle and it caps this dimension at 3.
- Any migration to a server-rendered or server-stateful stack would **add an
  operational tier that does not currently exist.** That is the incumbent's strongest
  standing argument and a later review should weigh it explicitly — as a cost of
  moving, not as a verdict against moving.

### Re-run checklist

Confirm no module in `INDEX.md` sits outside `web/components/`, `web/hooks/`, or
`web/lib/`. Confirm `web/next.config.ts` still sets `output: "export"` and that no
`.github/` directory exists. Score 4 only when per-user RPC read load is bounded and
the **end-to-end** loop needs no bespoke local chain — the default vitest loop needs
no chain today, so read the anchor against e2e, which is what actually costs.

---

## Summary — incumbent Next/React client, scored 2026-08-03

| # | Dimension | Score | The one-line reason |
|---|---|---|---|
| D1 | AI reasonability of the state graph | 2 / 4 | Keys are source of truth and the index is generated and drift-checked; nothing checks the catalog against `web/`. |
| D2 | Trust-domain honesty | 2 / 4 | Domains, four-status outcomes, and fail-closed rules are thorough — and held by tests and review, not by the compiler. |
| D3 | Testability | 2 / 4 | 714 cases, 57% stack-portable; but one known failure, and no control-ID→scenario link. |
| D4 | Wallet / EVM ecosystem fit | 4 / 4 \* | Reads, caching, and invalidation are one layer behind a seam 8 of 9 `on-chain` keys respect. |
| D5 | Operational cost | 3 / 4 † | Static artifact, no server in the state graph, no indexer; RPC load is per-user and e2e needs a local fork. |
| | **Total** | **13 / 20** | |

\* **D4 carries a recorded judgment call.** The 4 depends on treating the provider
shell (`Providers.tsx`, `WalletRuntime.tsx`) as part of the seam rather than as
feature components. A re-runner who treats them as ordinary components scores 3. See
D4; do not read the 4 without it.

† **D5 depends on how anchor 3 reads "external runtime dependency."** Wallet
connection uses Reown/WalletConnect's hosted service. Counting a vendor-operated
service scores 2; counting only tiers this project operates scores 3. See D5.

**The total is a summary, not a verdict.** The dimensions are not equally weighted and
this scorecard deliberately does not weight them — weighting is the Owner's judgment
at review time, and pre-weighting would be deciding the thing this file is forbidden
to decide.

## What this scorecard does not say

- It does **not** recommend a replacement stack. None is named as preferred, and no
  rival has been scored against this rubric.
- It does **not** conclude that the incumbent should be replaced, or kept. Three
  dimensions at 2 describe an app whose correctness rests on tests and review — which
  is normal, and which is exactly the load worth examining before adding to it.
- It does **not** license dependency or framework changes. The effort that produced it
  changed no `web/` dependency and no framework — the only `web/` edits in the maps
  fill were gate scripts and their tests (plan R10, AE4).
- It does **not** raise an Owner escalation. Per `REVIEW.md`, a stack change is not a
  standing trigger.
- **D3 would move on work already identified and owned elsewhere** — the known-red
  `markets-table` test and the control-ID tags. Fixing both is necessary but may not
  be sufficient: anchor 3 asks that *every* mapped control be traceable, and 31
  flow-level scenarios against 53 controls will leave chrome and header controls
  (`UI-HEADER-BRAND`, `UI-CHROME-ROUTE-ERROR`) with no plausible scenario to tag —
  plan D6 fixes Gherkin as flow-level, not one scenario per control. Re-score after
  the tags land rather than assuming the move. **Re-run this before arguing from
  it**; scoring a stack against numbers that
  a scheduled piece of work is about to change is how a review reaches a confident
  wrong answer.

## Re-running this scorecard

1. Regenerate and verify the state index —
   `node tools/scripts/generate-state-function-index.mjs --check`. If it fails, fix
   the keys before scoring; a stale graph scores nothing.
2. Refresh the test inventory using *Refreshing this catalog* in
   `web/reviews/testing.md`. Do not carry these numbers forward.
3. Re-derive the counts in the appendix rather than trusting the ones above.
4. Score each dimension against its rubric, recording the anchor that fails. A score
   without a named failing anchor is an opinion.
5. Record judgment calls explicitly — D4's seam exception is the known one.
6. Note the date and the branch. This run: **2026-08-03**, branch
   `feat/ai-maps-system-fill`, maps at 50 keys / 46 modules / 53 controls / 714 cases.

To score a rival stack, run the same rubric against it. Anchors requiring evidence
that does not exist for an unbuilt stack are scored `n/a` and named — not estimated.

## Appendix — deriving the numbers

```sh
# Keys per catalog file, and trust-domain distribution.
# Skip keys/README.md — it carries one entry as a format example, not a key.
grep -c '^### `' docs/maps/state/keys/*.md | grep -v '/README.md'
grep -h '^- \*\*trust_domain:\*\*' \
  docs/maps/state/keys/{view,form,execution,chain-reads,projection}*.md |
  sort | uniq -c

# Controls per region brief (53 total across the six regions)
for f in header positions markets-table settlement action chrome; do
  echo "$f $(grep -c '^## `UI-' "docs/maps/ui/$f.md")"
done

# Module span per key, and mean span by trust domain
node -e '
const fs = require("fs");
const rows = fs.readFileSync("docs/maps/state/functions/INDEX.md", "utf8")
  .split("## Keys")[1].split("\n").filter((l) => l.startsWith("| `"));
const byDomain = {};
for (const r of rows) {
  const c = r.split("|").map((s) => s.trim());
  const span = new Set([...c[3].split("<br>"), ...c[4].split("<br>")]).size;
  (byDomain[c[2].replace(/`/g, "")] ||= []).push(span);
}
for (const [d, a] of Object.entries(byDomain))
  console.log(d, "n=" + a.length,
    "mean=" + (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1),
    "max=" + Math.max(...a));
'
```

Counts as of this run: 50 keys (9 `on-chain`, 5 `projection`, 36 `pure-client`) across
46 modules; 20 keys single-module, 29 at two or fewer; mean span `pure-client` 2.3,
`on-chain` 5.0, `projection` 8.8; 53 controls across six region briefs; 66 vitest
files / 714 cases / 6 features / 31 scenarios.
