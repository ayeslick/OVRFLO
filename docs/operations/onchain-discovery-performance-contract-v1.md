# On-chain discovery performance contract v1

This is the pre-U3 performance authority for R39, R49, R50, and R58. The
machine-readable source is
`web/fixtures/discovery/performance-contract-v1.json`. Scanner implementation
may measure against this contract; it may not derive easier ceilings from its
own completed behavior.

## Frozen user-task ceilings

| Task | Complete/ready condition | p95 ceiling |
|---|---|---:|
| Initial market depth | Every configured market aggregate read completes | 2 seconds |
| Typical cold Borrow route | Indexed scope is complete, same-block conservation passes, and selected candidates are hydrated | 5 seconds |
| First verified portfolio row | One row has direct ownership/contribution and live-state verification | 5 seconds |
| “Claim all discovered” plan | Two independent candidate sets agree at one block/hash and action-critical hydration completes | 15 seconds |

Thirty runs are required per cache/client combination. Cold means a new browser
context with empty query/application cache. Warm means the same context after
one complete synchronization. The timing clock is the browser Performance API.

The frozen desktop profile is Chromium 151.0.7922.34, four logical cores, 8 GiB
memory, no CPU throttle, 40 ms latency, 10 Mbps download, and 5 Mbps upload.
The constrained mobile-class profile uses the same browser, four logical cores,
2 GiB memory, 4x CPU throttle, 150 ms latency, 1.6 Mbps download, and 750 Kbps
upload. Missing a ceiling on the constrained profile is a failure even when the
desktop profile passes.

The production-like fixture has 24 markets, 101 APR ticks per market, 1,200
typical liquidity positions, a 600-position fragmented route, 25 typical wallet
streams, 5,000 high-volume wallet streams, 10,000 valid unrelated-origin
streams, and three clean reloads. Evidence names the historical provider tier
and `us-east` region, records cold/warm state and exact event/candidate counts,
and identifies the transport as provider name plus a SHA-256 origin digest.
Full RPC URLs never enter evidence.

## Current/Ponder baseline

The baseline captured on 2026-07-30 is a semantic failure, not a fabricated
latency number. The current hooks cap global enumeration at 500, while Claim All
depends on one uncorroborated Ponder projection. None can produce the complete
ready states defined above. Measuring time to that false-ready state would
reward incompleteness, so the baseline remains “no valid ready result.” U3 must
improve that baseline by reaching complete states under the frozen ceilings.

## Valid-history churn stop decision

The attack horizon is 90 days at a fixed 10 gwei. Ten ETH equals
1,000,000,000 gas at that price. The benchmark grows two valid histories:

- repeated dust supply/withdraw cycles whose ending availability is zero; and
- high-volume valid OVRFLO-origin streams unrelated to the target wallet.

If the least-cost valid history that pushes any constrained-mobile first-client
task beyond its ceiling costs less than 10 ETH, scanner implementation stops.
The next decision must add an economic floor or revise the architecture.
Browser persistence is not accepted as mitigation for a new client.

Changing a ceiling, client profile, fixture shape, gas assumption, horizon, or
stop decision requires an explicit plan/release decision and a new version.
