# 12 — Build & deploy config hardening

**Category:** bug (security + build hygiene)

**Covers:** R29, R30, R31, R32, R34 (Tranche 4). Findings: M-17, L-6, L-8, L-4, L-9.

**What to build:** The production CSP is enforced with no dev fallbacks and no inline script, dead style/config surfaces are cleaned up, the live RPC credential is relocated out of the repo root, and social unfurls resolve from the configured production origin.

**Details:**
- R29/M-17: the shipped CSP carries no dev fallbacks and permits no inline script — achieved by hashing the exported HTML's inline scripts into `script-src` in a post-build step. The build fails when production origins are missing (today `build-csp.mjs` silently substitutes `rpc.ankr.com`/`localhost` rather than failing, which means the deployed app can ship a CSP that blocks its own indexer and RPC).
- R30/L-6: styles defined but referenced nowhere are removed; styles referenced but never defined are written.
- R31/L-8: `NEXT_PUBLIC_PRICE_API_URL` and the CoinGecko CSP origin are removed — nothing in `web/` fetches a price (`PositionSummary.tsx` already records the deliberate "no USD" decision); record the absence of USD context as a deliberate deviation from ETHSKILLS `/frontend-ux` Rule 4, not left implicit.
- R32/L-4: page metadata includes a 1200×630 Open Graph image referenced by an absolute production URL, with the production origin supplied by configuration rather than inferred, so social unfurls resolve correctly from the deployed domain.
- R34/L-9: the live Alchemy RPC key in `/.env` is relocated outside the repository root. It's gitignored and not in git history — this is hygiene, not an active leak — but ETHSKILLS closes with "never commit secrets to Git; AI agents are the primary source of leaked credentials," and one `git add -f` would change that. Rotate the key only if there's reason to believe the file has ever been shared outside this machine.

**Acceptance criteria:**
- [x] Production build fails when a required CSP origin is missing, rather than silently substituting a fallback
- [x] Shipped CSP has no dev fallbacks and permits no inline script (hashed inline scripts only)
- [x] `forge fmt`-equivalent CSS audit: no dead styles, no referenced-but-undefined styles
- [x] `NEXT_PUBLIC_PRICE_API_URL` and the CoinGecko CSP origin removed from config and CSP
- [x] OG image (1200×630) present, referenced by absolute URL built from a configured production origin
- [x] `.env` (or equivalent) relocated outside the repo root; documented in local dev setup instructions
- [x] Production build succeeds with dev fallbacks removed (per the plan's tranche 4 gate)

**Out of scope:**
- Implementing USD price display (explicitly rejected — the config surface is removed, not built out)
- Rotating the RPC key unless there's specific reason to believe it was shared

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

**Plan:** `docs/plans/2026-07-28-002-fix-audit-2026-07-28-remediation-plan.md` (Tranche 4, gate: production build fails when a required CSP origin is missing and succeeds with dev fallbacks removed).

## Comments

**2026-07-28 (to-tickets):** Generated via `/to-tickets`. Grouped as "build/deploy config" since all five requirements are about what ships in the production bundle/CSP rather than component behavior.

**2026-07-29 (implemented):** Landed as U12 on branch `fix/audit-2026-07-28-tranche-1`.

*CSP fails closed (R29/M-17).* `build-csp.mjs` substituted `rpc.ankr.com` and `localhost` when origins were missing, so a deploy could ship a CSP blocking its own RPC and indexer — silently, because the build stayed green. Missing origins now throw. Local builds opt into the fallbacks with `CSP_ALLOW_FALLBACKS=1`; forgetting the flag fails loudly instead of shipping something broken. Verified in all three directions: missing origins fail, supplied origins pass, opt-out passes.

*Inline-script hashing had to be a second script.* `build-csp.mjs` runs before `next build` and writes `public/_headers`, which Next copies into `out/` during export — a hash computed there could never match HTML that does not exist yet, and writing to `public/_headers` afterwards would only take effect on the *next* build. `scripts/csp-hash-inline.mjs` runs after the build and rewrites `out/_headers` and `vercel.json` in place. It hashes 12 inline scripts and fails if it finds zero, since Next always emits hydration scripts inline — zero would mean the matcher had gone stale and the CSP was about to block hydration.

`script-src` is now `'self'` plus hashes: no `'unsafe-inline'`, and the WalletConnect/Reown wildcards are gone — nothing in `web/` loads a remote script, and three wildcard domains only widened the post-XSS blast radius. Wallet connectivity rides on `connect-src` and `frame-src`, untouched. The remaining `'unsafe-inline'` is on `style-src`, which Next requires.

*Dead price surface removed (R31/L-8).* CoinGecko origin and `NEXT_PUBLIC_PRICE_API_URL` gone. The no-USD deviation from ETHSKILLS `/frontend-ux` Rule 4 is recorded at `PositionSummary` where the decision already lived: a price feed is a third-party runtime dependency whose staleness is its own hazard, and a wrong USD figure beside a correct token amount is worse than none.

*OG image generated, not blocked (R32/L-4).* No 1200×630 asset existed — only square brand marks — so this was flagged as needing a maintainer-supplied file. Generating it at build time via `next/og` removes that dependency and keeps it in step with the wordmark automatically. Needed `export const dynamic = "force-static"` under `output: "export"`. `metadataBase` comes from `NEXT_PUBLIC_SITE_ORIGIN`, so the URL is absolute from configuration rather than inferred; card upgraded to `summary_large_image`. Verified in the export: `og:image` resolves to `https://app.example.com/opengraph-image`.

*CSS swept both directions (R30/L-6).* Three rules had no referencing markup anywhere (`.market-detail-meta`, `.market-detail-section`, `.position-summary`) and are removed. One class was applied but never defined — `.summary-strip` in `PositionSummary` — and is now written. A crude first pass flagged ten more as dead; all were false positives applied through template literals and conditionals, so each was verified individually before removal.

*R34 is split.* Agent's share done: `/.env` moved to `~/.config/ovrflo/env` with mode 600, out of the repository where Foundry auto-loaded it and one `git add -f` from being committed. `docs/agents/testing.md` documents the explicit export now required, including for `forge` fork tests. **The rotation itself remains the maintainer's** — and is now more than hygiene: a forked Anvil carries the credential on its own command line, so it is readable via `ps` by any local process, and it was surfaced that way during this session.

Verification: production build green end to end (OG prerendered, 12 scripts hashed, static export clean), 417 unit tests, 31 E2E scenarios, lint, `tsc --noEmit`, and the a11y sweep clean.
