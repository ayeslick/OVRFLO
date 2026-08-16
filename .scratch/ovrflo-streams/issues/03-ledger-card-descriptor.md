# 03 — Ledger-card descriptor

**What to build:** New contract `OVRFLOStreamDescriptor` renders the locked ledger card fully on-chain. Delete the upstream descriptor and its SVG libraries. After that deletion, bake ERC721 `name`/`symbol` to `"OVRFLO Stream"` / `"OVRFLOStream"` on Linear only. Promote solady to a runtime dependency.

**Repo:** sibling `OVRFLO-Streams`. May run in parallel with ticket 02 after 01.

**Blocked by:** 01 (resolved). Not blocked by 02.

**Status:** resolved

**Labels:** ready-for-agent

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-08-13-001-feat-ovrflo-streams-plan.md

Scope: U3 only (= this ticket). Stop when this ticket's acceptance criteria are met.
Ticket: .scratch/ovrflo-streams/issues/03-ledger-card-descriptor.md
Spec/harness: .scratch/ovrflo-streams/spec.md — follow its per-session rules.
Repo: sibling OVRFLO-Streams. Do not compile the fork inside OVRFLO.
Do not edit the plan. Do not start Enumerable/mint-gate (02) or deploy wiring (04)
unless this chat already owns 02 — still do not merge the units.
Before any code, read Required reading and the plan sections: Goal Capsule,
Product Contract (R1, R4, R5, R7, R14 wallet-SVG half), KTD5, SC8, SC9, SC22,
and ### U3.
Delete SablierV2NFTDescriptor.sol; do not edit it. Change Linear ERC721 name/symbol
in this unit, not earlier. Leave LockupDynamic's ERC721 strings untouched.
No <animate> in any status variant. Status mapping is total (unexpected status
renders a fallback, never reverts tokenURI).
Honor EIP-170 stop condition on the descriptor.
INTENT RECORD (before the first code write): post assumptions, predicted
blast radius, and the verification that will prove this ticket. Log plan
deviations on this ticket with why; do not edit the plan. Before Status:
resolved, fill Final diff from git diff --stat vs that prediction. Do not
reconstruct the record afterward. See spec.md Intent record and
docs/agents/onboarding.md Before writing code.
After verification, mark ticket checkboxes done and set Status: resolved.
Commit with write-tree / commit-tree / update-ref. Never git commit.
```

**Required reading:**

- `.scratch/ovrflo-streams/spec.md` (Intent record)
- `docs/agents/onboarding.md` § Before writing code
- `docs/solutions/patterns/solidity-implementation-discipline.md` Sequence 6–9
- Plan R1 (descriptor is the one new Solidity name), R4, R5, R7, R14 (wallet SVG is still; Markets HTML is ticket 09), KTD5, SC8, SC9, SC22, ### U3
- `.scratch/design/ovrflo-stream-ledger-card.html` (layout lock)
- https://ethskills.com/SKILL.md
- this ticket's acceptance criteria

## Settled decisions this ticket must not reopen

- **R1 naming.** The descriptor's Solidity name **is** `OVRFLOStreamDescriptor`. Every other fork contract keeps its upstream name. Do not rename `SablierV2LockupLinear`. `OVRFLOStream` is the deployed ERC721 identity (KTD5 strings), not a Solidity type.
- **KTD5 in this unit, not 02.** Once the upstream descriptor is gone, change Linear to `ERC721("OVRFLO Stream", "OVRFLOStream")`. There is no setter. A wrong value survives to mainnet. Do this in the same unit as the descriptor replacement. Doing it earlier reverts `tokenURI` (upstream descriptor dispatches on symbol at `src/SablierV2NFTDescriptor.sol:290-296`). Leave LockupDynamic at `"Sablier V2 Lockup Dynamic NFT"` / `"SAB-V2-LOCKUP-DYN"` — it is never deployed; KTD5 does not supply a second identity.
- **R4 card contents.** Streamed percentage, 24-segment bar, streamed and remaining amounts, rate per day, days remaining, calendar end date, asset symbol, stream id, status, OVRFLO Streams branding. No external assets or URLs. No `external_url` envelope.
- **Wallet SVG is still.** No SMIL, no CSS animation, no `<animate>` in any variant. Gold frontier on a streaming bar (last filled cell gold, ink elsewhere). Settled and depleted bars are ink. Depleted swaps "Days left" for "Withdrawn". Markets CSS band is ticket 09, not this SVG.
- **Bar fill is a snapshot** from `streamedAmountOf`, never from a render-time timestamp. Canceled and depleted streamed amounts are frozen.
- **SC8.** Treat `cliffTime == startTime` as no cliff. Render no cliff row. v1.1 stores `cliff: 0` that way. Do not use newer Sablier's `cliffTime = 0` encoding.
- **Three production variants:** streaming, settled, depleted. Vault create params (`cancelable: false`, `cliff: 0`, start at current block) make PENDING and CANCELED unreachable in production. R2b restricts the caller, not the parameters. SC9: still build PENDING and CANCELED fixtures with `createWithRange` / `cancelable: true` in the fork so the status matrix is total. Unexpected status → fallback variant, never revert `tokenURI`.
- **SC22.** `DateTimeLib.timestampToDate` (solady) is runtime code. Move solady from `devDependencies` to `dependencies`. Do not remove solady.
- **OQ5 / R17 / R19** are not this ticket. Do not change `supportsInterface`. Do not implement lending burn or factory forwarders.
- **Fixed-point renderer.** Neither OZ 4.9 `Strings` nor PRB-Math renders decimals. Upstream integer division would print `0` for a realistic ~0.027/day rate. Split integer/fraction, zero-pad to `decimals`, truncate to 4 significant digits.

## This ticket owns / does not own

**Owns:** `OVRFLOStreamDescriptor.sol`; deletion of `SablierV2NFTDescriptor.sol`, `libraries/NFTSVG.sol`, `libraries/SVGElements.sol`; drop `SablierV2NFTDescriptor_UnknownNFT` from `Errors.sol`; Linear `ERC721(...)` string change; solady runtime move; descriptor tests + golden SVG/JSON exports per status; size gate for `OVRFLOStreamDescriptor`; deviations table rows for the descriptor replacement.

**Does not own:** Enumerable / mint gate (02); deploy script (04); committing goldens into this OVRFLO repo (05 copies them); Markets HTML card (09); DOMParser well-formedness gate (09 parses the goldens 05 stages).

## Do not

- Edit `SablierV2NFTDescriptor.sol` in place — delete it
- Change LockupDynamic's ERC721 strings
- Emit `<animate>` or name a font face that lives under `web/public/fonts/`
- Revert `tokenURI` on an unexpected status
- Treat `StreamPricing.sol:209` as create-side math (consume-side; ticket 07)
- Compile the fork inside this OVRFLO repo
- Edit the plan file

## Implementation (binding)

1. Delete `src/SablierV2NFTDescriptor.sol`, `src/libraries/NFTSVG.sol`, `src/libraries/SVGElements.sol`. Drop orphaned `SablierV2NFTDescriptor_UnknownNFT` from `Errors.sol`.
2. Add `src/OVRFLOStreamDescriptor.sol` implementing the descriptor `tokenURI` view: JSON metadata with embedded data-URI SVG.
3. Root SVG: `xmlns`, numeric `width`/`height`, matching `viewBox`, `preserveAspectRatio`. First painted child is an opaque full-viewBox rect (readable on white, print, forced-colors).
4. Font stack ends in generic `monospace`. Name no face the app loads.
5. Sanitize asset symbol and any external-contract string: length cap, character whitelist, safe fallback (R4). Descriptor is hot-swappable, so sanitization still runs.
6. Implement the fixed-point renderer (4 significant digits). Sub-1-token/day and sub-1-token streamed amounts must print real digits, not `0` or `< 1`.
7. Render days remaining and calendar end date. Depleted: "Withdrawn" instead of "Days left". Use solady `DateTimeLib.timestampToDate`. Move solady to `dependencies`.
8. Every row: explicit character budget, upstream-style clamps, `textLength`/`lengthAdjust`, calibrated against the widest plausible fallback font. SVG text neither wraps nor shrinks.
9. Change Linear `ERC721(...)` to `ERC721("OVRFLO Stream", "OVRFLOStream")` in this same unit.
10. Size-gate the descriptor (mirror `test/DeploySize.t.sol` cap-loop, including temporarily lowering the cap).
11. Tests: one `tokenURI` validity test per status (JSON decodes; values match seeded state). Totality test: every status value maps to a variant. Hostile-symbol mock ERC20. No `<animate>`. Root attributes. Fonts. Formatting. Overflow. Burned id reverts (construct depleted without burning). Zero-streamed and fully-streamed bars. PENDING/CANCELED fixtures via SC9.
12. Export golden outputs per status for ticket 09's `DOMParser` check. Ticket 05 commits copies into this OVRFLO repo; produce them here.
13. Update the deviations table (AE5 expected set includes deleted descriptor + orphaned libs + new descriptor file).
14. Replace the upstream descriptor test tree (14 unit files, integration token-uri tests, `NFTDescriptorMock`) per R7. New tests use a standalone harness (R7b).

## Intent record

Binding. See `.scratch/ovrflo-streams/spec.md` (Intent record) and `docs/agents/onboarding.md` (Before writing code).

1. Post the record in this chat **before the first code write**.
2. Fill **Deviations from the plan** as they happen, with why. Do not edit the plan.
3. Fill **Final diff** before `Status: resolved`.

## Deviations from the plan

1. **Vendored `ds-test`.** The `forge-std` GitHub tarball omits the `ds-test` submodule, so `forge test` cannot resolve `ds-test/test.sol`. This ticket vendors `vendor/ds-test/src/test.sol` (GPL-3.0-or-later) and remaps `ds-test/` to it. The plan assumed the inherited toolchain already compiled.
2. **Split `_svg` into `_svgHead` / `_svgRows` / `_svgFoot`.** A single `string.concat` hit stack-too-deep under solc 0.8.23. The card layout is unchanged. The plan did not name this split.
3. **Compile wiring after the deletion.** `test/Base.t.sol`, `test/utils/DeployOptimized.sol`, `test/utils/Precompiles.sol`, `setNFTDescriptor.t.sol`, and the NFT-descriptor deploy scripts now construct `OVRFLOStreamDescriptor`. Ticket 04 still owns the deploy-order rewrite. The tree cannot compile if those call sites keep the deleted type.
4. **Deleted `script/GenerateSVG.s.sol`.** That script inherited the deleted SVG internals. Ticket 04 still owns deploy scripts.
5. **Artifact shell paths.** `shell/prepare-artifacts.sh` and `shell/update-precompiles.sh` copy `OVRFLOStreamDescriptor` instead of the deleted artifact. Precompiles hex bytecode is left for ticket 02.
6. **`_upper` copies the string.** An in-place uppercase mutated `vars.statusLabel` before `_json` ran, so metadata wrote `PENDING` instead of `Pending`. The SVG title stays uppercase. The plan did not name this copy.
7. **PENDING and CANCELED fixtures stay.** Plan U3 says those fixtures go. SC9 and this ticket require `createWithRange` / `cancelable: true` fixtures so the status matrix is total. This ticket follows SC9.

The plan file was not edited.

## Final diff

- Predicted blast radius: delete `SablierV2NFTDescriptor.sol` + `NFTSVG.sol` + `SVGElements.sol` + upstream descriptor tests + `NFTDescriptorMock`; add `OVRFLOStreamDescriptor.sol` + standalone tests + size gate + goldens; edit Linear `ERC721` strings, `Errors.sol`, `package.json` (solady → `dependencies`), `foundry.toml`, README deviations, `CHANGES.md`; compile wiring in Base/scripts/Precompiles/DeployOptimized/`setNFTDescriptor`.
- Actual (`git diff --stat fork/bring-up`): 68 files changed, 1780 insertions, 1948 deletions. Head `a9db0461`. Extra vs prediction: `vendor/ds-test/src/test.sol`, `remappings.txt`, `script/GenerateSVG.s.sol` deletion, `shell/prepare-artifacts.sh`, `shell/update-precompiles.sh`, `codecov.yml`.
- Misses: none relative to U3 acceptance. Enumerable / mint-gate / Precompiles deletion / deploy-order rewrite were left for tickets 02 and 04.

## Acceptance criteria

- [x] Intent record posted in the session before the first code write
- [x] Deviations from the plan (if any) recorded on this ticket with why; plan file not edited
- [x] Final diff filled from `git diff --stat` vs the predicted blast radius
- [x] `tokenURI` validity per status; values match seeded stream state (Covers AE3 at fork level)
- [x] Totality: every status value maps to a variant; no revert on unexpected status
- [x] PENDING and CANCELED fixtures exist via `createWithRange` / `cancelable: true` (SC9)
- [x] `cliffTime == startTime` renders no cliff row (SC8)
- [x] Hostile symbol (quotes, angle brackets, oversize) yields valid inert JSON/SVG
- [x] No status variant emits `<animate>`
- [x] Root carries `xmlns`, `width`, `height`, `viewBox`, `preserveAspectRatio`; first painted child is opaque full-viewBox fill
- [x] No emitted `font-family` names a face under `web/public/fonts/`
- [x] Sub-1-token/day rate and sub-1-token streamed amount render real digits
- [x] Maximum-length values in every row stay inside the card
- [x] Burned id: `tokenURI` reverts; depleted-without-burn still renders
- [x] Zero-streamed and fully-streamed bars are sane
- [x] Linear `name()` / `symbol()` are `"OVRFLO Stream"` / `"OVRFLOStream"`; LockupDynamic strings unchanged
- [x] solady is a runtime `dependencies` entry
- [x] Descriptor runtime and initcode under EIP-170/EIP-3860; mutation-tested by temporarily lowering the cap
- [x] Golden outputs exported per status
- [x] Deviations table accounts for descriptor files (AE5)
- [x] New tests do not import UNLICENSED Base/Defaults
- [x] `forge build --sizes` shows headroom

## Plan unit

U3 in `docs/plans/2026-08-13-001-feat-ovrflo-streams-plan.md`
