---
title: "Denomination switch, border module, and per-underlying columns — reconciliation plan"
type: refactor
date: 2026-08-22
topic: denomination-border-column
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready — swept 2026-08-24 (ignorance-lens sweep complete; dry-run pass folded)
product_contract_source: ovrflo implementation handoff (2026-08-22 design session, PDF at ~/Library/Mobile Documents/com~apple~CloudDocs/Downloads/OVRFLO/ovrflo implementation handoff.pdf)
execution: code
deepened: 2026-08-24
---

# Denomination switch, border module, and per-underlying columns — reconciliation plan

## Goal Capsule

**Objective.** Reconcile the 2026-08-22 implementation handoff against the live repo, decide every point where the two disagree, and sequence the result into changesets that can each be swept, implemented, and audited as a unit. Changeset 1 (CS1) is the coherent core change: ovrfloToken denomination everywhere, border extraction via nested constructors, two-minter token with ERC20Permit, factory registration plus `replaceLending`, PT flash-loan removal, lending asset switch plus a factory-set router/`onBehalfOf` hook, FREI-PI checks on wrap and deposit, and the full test/script/web/docs sync.

**Product authority.** The handoff PDF is the dated user decision record for this architecture (it authorizes event/error catalog changes per critical pattern #21). Where the handoff conflicts with `src/`, the handoff's own preamble governs: raise, do not silently resolve — every such conflict is decided in § Key Decisions. Session decisions that override the handoff (nested constructors, `onBehalfOf` in the core, Permit, `replaceLending`) are recorded here with the rejected option. Trust ranking otherwise per `docs/agents/onboarding.md` §0.

**Execution profile.** Solidity/Foundry, shell seed tooling, Next.js frontend. Verify with `forge build` then `forge test`, `FOUNDRY_PROFILE=invariant` for invariant campaigns, `bash script/seed-local.sh` for the seed smoke, `npm --prefix web run test` for the web sync.

**Stop conditions.** Stop and surface if: (a) any live mainnet deployment must be preserved in place (KD11 — this plan assumes fresh-generation deployment); (b) the OVRFLO-Streams fork cannot be redeployed against a new factory (its mint gate reads the factory registry positionally — `src/OVRFLOFactory.sol:87-91`); (c) the two-minter registration checks cannot be expressed without touching the 3-field `OvrfloInfo` tuple; (d) the lending asset switch turns out to touch `_fillTick`/`StreamPricing` math (it must not — the math is already ovrfloToken-denominated); (e) `test/DeploySize.t.sol` fails after the vault constructor embeds border+token creation code; (f) the lending runtime canary fails after the asset switch plus the router hook (drop the hook and surface — do not weaken the canary).

**Open blockers.** None structural. Calibration numbers for CS2 (flash fee ceiling, supply cap) are open by design and do not gate CS1.

---

## Problem Frame

The handoff describes a target architecture. The repo implements a different one. Both are internally consistent; the work is a migration, not a patch. The deltas, grounded in `src/`:

1. **Fee/escrow denomination.** Today the deposit fee is charged in underlying via a second approval (`src/OVRFLO.sol:462-467`), and the lending book escrows and pays out underlying: `supply` pulls `IERC20(underlying)` (`src/OVRFLOLending.sol:436`), `withdraw` refunds underlying (`:467`), `borrow` pays net and fee in underlying via `_payUnderlying` (`:527-528`, `:1231-1235`). Obligations, `repay`, and `claim` are already ovrfloToken-denominated (`:645`, `:741-743`), and `StreamPricing` is asset-agnostic (`src/StreamPricing.sol:109-160`). The switch changes escrow/payout plumbing, not pricing math.
2. **Wrap/unwrap location.** The vault owns `wrappedUnderlying`, `wrap`, `unwrap`, `sweepExcessUnderlying` (`src/OVRFLO.sol:111`, `:363-407`). The handoff moves all of it to one border contract per underlying.
3. **Mint authority.** `OVRFLOToken` has a single immutable `owner` set to the constructing vault (`src/OVRFLOToken.sol:19-28`; construction at `src/OVRFLO.sol:297`). The handoff requires two immutable minters (vault + border) fixed at token construction, with no admin path ever.
4. **PT flash loan exists.** The handoff says "Do not build: PT flash loans. Never" — but the repo ships one (`src/OVRFLO.sol:526-566`), with tests across unit/fuzz/attack/invariant/fork suites.
5. **Registration.** `registerOvrflo` currently relies on the vault constructing its token: "Token ownership needs no check … holds by construction" (`src/OVRFLOFactory.sol:166-167`). After CS1 the vault still constructs the column children (KD5); registration grows explicit minter and border binding checks anyway.
6. **Constructor cycle in the handoff.** The handoff says the token needs both minter addresses at construction, so the vault can no longer construct its own token, and offers "CREATE2 prediction or deploy-token-first." That cycle exists only if all three contracts are deployed from the outside. Nested constructors remove the cycle (KD5).

**Discrepancies between the handoff and the repo, resolved in this plan:**

| # | Handoff claim | Repo / session reality | Resolution |
|---|---|---|---|
| D1 | "Do not build: PT flash loans. Never" | PT flash facility exists (`src/OVRFLO.sol:526-566`) | Remove it in CS1, first commit (KD1) |
| D2 | `quote()` returns grossPrice, obligation, fee, net, residual in one call | `previewBorrow` returns `(actualBorrow, feeAmount, obligation)` (`src/OVRFLOLending.sol:561-564`) | No contract change; frontend composes (KD12) |
| D3 | Vault can no longer construct its token; CREATE2 or token-first | Vault already constructs its token (`src/OVRFLO.sol:297`) | Vault creates the border; the border creates the token (KD5). CREATE2 and nonce-precomputed CREATE are rejected |
| D4 | "delete sweepExcessUnderlying from the vault (or repoint…, admin decision)" | `sweepExcessUnderlying` exists on vault + factory forwarder (`src/OVRFLO.sol:363`, `src/OVRFLOFactory.sol:282`) | Move the body to the border; delete it from the vault; keep the factory forwarder name (KD3) |
| D5 | Request book is `loan.borrower`; core unchanged | `borrow` sets `loan.borrower = msg.sender` and `_disposeStream` returns to that address (`src/OVRFLOLending.sol:508`, `:1248-1259`) | Factory-set `router` plus `onBehalfOf` in CS1 (KD10). Request book does not keep a routing table |

---

## Alternatives considered (architecture level)

- **Keep the PT flash loan, frozen, remove later.** Rejected: the denomination switch outlaws its underlying-denominated fee path, and keeping it means the vault keeps an underlying fee leg. "Never" is the handoff's settled word; CS1 is the cheapest moment to honor it.
- **Denominate lending in underlying, switch only the deposit fee.** Rejected: leaves two assets in the lending book and forfeits single-asset accounting.
- **Token-first under nonce-precomputed plain-CREATE addresses** (GLM draft KD5). Rejected: the cycle exists only under all-external construction. Nonce discipline is a silent footgun until `registerOvrflo` reverts. Nested constructors keep today's deploy shape: one `new OVRFLO(...)`, then register.
- **CREATE2 prediction of vault/border/token.** Rejected: a CREATE2 address depends on initcode content, and each side's initcode would embed the other's address. No computable fixed point. Unnecessary once constructors nest.
- **Vault constructs the token and takes a predicted border address.** Rejected: still needs prediction. The winning chain predicts nothing: the border is `msg.sender` at token construction.
- **All-external children for factory-philosophy purity.** Rejected by user sign-off. The vault already constructs its token. Nesting the border extends that exception by one level. Registration remains the admission gate.
- **Per-user operator mapping on the lending market** (`isOperator[account][operator]`). Rejected: the router cannot spend the human's assets. The stream comes from the router's own escrow. A mapping doubles the byte cost for a harm that cannot occur.
- **Request book as `loan.borrower` plus permissionless `settle`.** Rejected: the stream returns to the book and sits there until someone sweeps. The CS1 hook deletes that table and that failure. Fallback if the lending canary fails: drop the hook and use this design; do not weaken the canary.
- **A second lending contract that mirrors the book for borrowers.** Rejected: a request carries one indivisible stream NFT and dies on first fill. Tick-tape/epoch machinery exists for lazy pro-rata across partial fills. A mirror book is the full audit surface with none of that reason.
- **In-place migration of a live deployment.** Rejected as impossible: fee asset, escrow asset, token mint authority, and factory checks are constructor-level. The unit of migration is a fresh column (KD11).

---

## Key Decisions

### KD1 — PT flash loan is removed in CS1, as the first commit

Delete from `OVRFLO.sol`: `flashLoan`, `flashFeeBps`, `flashLoanPaused`, `setFlashFeeBps`, `setFlashLoanPaused`, `FLASH_FEE_MAX_BPS`, `FLASH_CALLBACK_SUCCESS`, events `FlashLoaned`/`FlashFeeBpsSet`/`FlashLoanPausedSet`, errors `FlashPaused`/`ExceedsDeposited`/`FlashCallbackFailed` (the `src/OVRFLO.sol:526-566` block). Delete factory forwarders `setFlashFeeBps`/`setFlashLoanPaused` (`src/OVRFLOFactory.sol:290-301`) and `interfaces/IFlashBorrower.sol`. The vault drops `ReentrancyGuard` inheritance: `flashLoan` is its only `nonReentrant` user (`src/OVRFLO.sol:20`, `:526`). Test deletions: `test/OVRFLOFlashLoan.t.sol`, `test/fork/OVRFLOFlashLoanFork.t.sol`, the flash members of `test/OVRFLOFuzz.t.sol`, `test/OVRFLOAttackScenarios.t.sol`, `test/OVRFLOInvariant.t.sol`, `test/fizz/` (flash handlers, `MockFlashBorrower`, GL-06's `mockFlashBorrowerAddr` holder). This commit is pure removal and must land before border extraction so later diffs do not mix deletion with the structural move. ERC-3156 ovrfloToken flash mint in the border is CS2.

### KD2 — Deposit fee comes out of the minted ovrfloToken; events and slippage use the net

In `deposit`: compute `feeAmount = StreamPricing.fee(toUser, info.feeBps)` as today, then mint `toUser - feeAmount` to the depositor and `feeAmount` to `TREASURY_ADDR` (skip the zero-fee mint), instead of the underlying `safeTransferFrom` at `src/OVRFLO.sol:464-467`. Implementation shape, stated so the dry run cannot pick the other leg: depositor receives one mint of `toUser - feeAmount`, treasury receives one mint of `feeAmount`; no post-mint transfer; `FeeTaken` fires once alongside the split. `feeBps` stays ceiling-capped by the factory (`FEE_MAX_BPS = 100`), so `toUser - feeAmount` cannot underflow.

One rule: the event, the slippage guard, and the preview describe what the user received.

- `minToUser` bounds the net mint (`toUser - feeAmount`).
- `Deposited.toUser` is that net amount.
- `FeeTaken` is kept; its `token` field value changes from `underlying` to `ovrfloToken` (catalog change authorized by the handoff as the dated decision, pattern #21). The fee is paid in minted ovrfloToken, so KD13's equality holds by construction: treasury gain equals depositor deduction, and no ovrfloToken ever exists outside the mint split.
- `previewDeposit` returns net `toUser` and `feeAmount` in ovrfloTokens. NatSpec today says "Fee amount in underlying tokens user must pay" (`src/OVRFLO.sol:627`) — rewrite that sentence.

The deposit flow needs exactly one approval (PT).

### KD3 — The border is `OVRFLOBorder`, factory-administered, reserve-holder

One border per underlying. CS1 creates it from the vault constructor (KD5). CS1 surface:

- Immutables: `factory` (admin), `underlying`, `vault`, `ovrfloToken` (set after the border constructs the token).
- Storage: `wrappedUnderlying`.
- `wrap(amount)` — port of `src/OVRFLO.sol:379-392` verbatim (reserve increment before `transferFrom`, strict balance-delta check), then KD8's FREI-PI assert.
- `unwrap(amount)` — port of `:396-407` verbatim (reserve-bounded, burn before transfer), then KD8's FREI-PI assert.
- `sweepExcessUnderlying(to)` `onlyAdmin` — port of `:363-371`: balance minus reserve, `NoExcess` when zero. Same dust case as today (a direct underlying transfer). Delete the function from the vault.
- Events `Wrapped`/`Unwrapped`/`ExcessUnderlyingSwept` move with the code.
- No reentrancy guard on `wrap`/`unwrap` — parity with the vault's current posture. Port `test_ReentrantUnderlyingCannotDoubleSpendReserveDuringUnwrap` (`test/OVRFLOWrapUnwrap.t.sol:229`).
- ERC-3156 flash mint lands here in CS2; the CS1 contract is shaped so that addition is additive (no reserve interaction, per handoff §4).

The vault deletes `wrappedUnderlying`, `wrap`, `unwrap`, `sweepExcessUnderlying`. The vault **keeps** the `underlying` immutable — it remains the column's identity asset (Pendle SY binding in `addMarket` at `src/OVRFLOFactory.sol:251`, duplicate-underlying registration at `:180`). Post-CS1 the vault holds no underlying balances; the reference is identity, not custody. `sweepExcessPt` stays on the vault (PT backing is a vault concern; its `UnknownPT` guard is unchanged, pattern #11).

Known accepted stranding window, documented so it is not re-raised: a direct underlying transfer to the border lands outside `wrappedUnderlying` and is recoverable only by multisig `sweepExcessUnderlying`. This is identical to today's dust case on the vault (`:363-371`) and moves with the code; it is not a new exposure.

The factory forwarder `sweepExcessUnderlying(ovrflo, to)` keeps its name and retargets `OVRFLOBorder(ovrfloToBorder[ovrflo]).sweepExcessUnderlying(to)`.

### KD4 — `OVRFLOToken` gets two named immutable authorities and ERC20Permit

Replace the single `owner` (`src/OVRFLOToken.sol:19-28`) with:

- `address public immutable vault`
- `address public immutable border`

Constructor: `OVRFLOToken(string name_, string symbol_, address vault_)` plus OZ `ERC20Permit(name_)`. `vault = vault_`. `border = msg.sender` (the constructing border). The modifier admits either; error renamed `NotMinter()`. No setter, no gate, no timelock, no transfer. Both authorities get both `mint` and `burn` (the vault burns on `claim`; the border burns on `unwrap` and, in CS2, on flash-mint repay).

Rejected naming: `minter0`/`minter1`. Named getters match the roles. The handoff forbids a third minter, so numbered slots buy nothing.

**Permit.** OZ `ERC20Permit` is constructor-only. After the denomination switch, `supply` and `repay` both pull ovrfloTokens; permit turns those into a signature plus one pull. Do **not** add `supplyWithPermit` or `repayWithPermit` on `OVRFLOLending` (canary headroom; permit-in-contract has a known griefing wrinkle). The frontend submits `permit` and the action as two calls or a wallet batch.

Record in `VAULT_SECURITY.md`: two contracts can burn any holder's balance. The border only burns `msg.sender` in `unwrap`. That is the same trust shape as today's vault, now split across two contracts.

### KD5 — Deploy recipe: vault creates the border; the border creates the token

No CREATE2. No nonce prediction. One transaction from the deployer:

```
EOA/script
  |  new OVRFLO(admin, treasury, underlying, name, symbol, oracle, stream)
  v
OVRFLO constructor
  1. border = new OVRFLOBorder(admin, underlying, name, symbol, address(this))
       |
       v
     OVRFLOBorder constructor
       2. token = new OVRFLOToken(name, symbol, vault)
            vault  = vault_          (arg)
            border = msg.sender      (the border)
       3. ovrfloToken = token        (immutable)
  4. ovrfloToken = border.ovrfloToken()
  5. IERC20(ovrfloToken).approve(stream, type(uint256).max)   // keep src/OVRFLO.sol:301
```

The token↔border cycle never appears: the border learns the token by creating it, and the token learns the border because the border is `msg.sender`. The token is constructed with the OZ `ERC20Permit(name_)` base per KD4 — the `ERC20` and `ERC20Permit` constructors must receive the same `name_` string (EIP-712 domain).

The deploy runbook in `script/OVRFLO.s.sol` (steps 6–7) stays "deploy `OVRFLO`, then `registerOvrflo(vault)`." Step 6 gains reads: `vault.border()`, `border.ovrfloToken() == vault.ovrfloToken()`, `token.vault() == vault`, `token.border() == border`. The artifact gains `border`.

**Border provenance for clients is factory discovery, not env.** The web derives `border` from a third bootstrap multicall leg — `factory.ovrfloToBorder(vault)` next to `ovrfloToLending` (`web/lib/protocol-bootstrap.ts:193-206`; the result-pairing arithmetic at `:217-224` becomes `* 3`), feeding a `border` field on `VaultInfo`. This preserves the settled factory-only-anchor rule (the `OBSOLETE_ENV_VARS` posture at `web/lib/config.ts:28-34` and `:203-212`); a second static anchor would reintroduce the pattern that rule killed and silently mis-target under multi-vault. The deployment-artifact `border` field and seed-time echoes are tooling convenience only; **do not add `NEXT_PUBLIC_OVRFLO_BORDER`** to the client env contract — add it to the obsolete list instead. The E2E harness keeps reading `deployments/local.json` as today.

`test/DeploySize.t.sol` `_artifacts()` gains `OVRFLOBorder`. The vault's initcode now embeds border+token creation code; the vault's runtime shrinks (wrap/unwrap/flash deleted). Both caps have large margins. A cap failure is a stop condition, not a silent absorb.

### KD6 — Factory registration stays one-argument; `OvrfloInfo` stays frozen

`registerOvrflo(address ovrflo)` keeps its arity. After the existing checks (`src/OVRFLOFactory.sol:169-191`) the factory reads `border = vault.border()` and `token = vault.ovrfloToken()`, then:

- token and border carry runtime code (`code.length > 0`) — else `NoCode`. Without this, staticcalls against an EOA revert as a generic ABI-decode error instead of a catalog error (same pattern as `setOvrfloStream`, `src/OVRFLOFactory.sol:370-372`).
- `border != address(0)` — else `BorderMismatch`.
- `OVRFLOToken(token).vault() == ovrflo` and `.border() == border` — else `TokenMinterMismatch`.
- `OVRFLOBorder(border).ovrfloToken() == token`, `.underlying() == underlying`, `.factory() == address(this)`, `.vault() == ovrflo` — else `BorderMismatch`.

Record the border in a **separate** `mapping(address => address) public ovrfloToBorder`. Do **not** extend `OvrfloInfo`: field 0 (`treasury`) is read positionally by the off-repo OVRFLO Streams mint gate (`src/OVRFLOFactory.sol:87-91`; the fork destructures `(treasury,,)` at its `_requireKnownOvrflo`). A tuple-length change would break that cross-repo ABI. The mapping is deliberately **write-once**, like `ovrfloStream` and per-series approval: a flawed border is a fresh-column-plus-migration problem under pattern #9, not an in-place replace — the border custodies the wrap reserve, and migrating that reserve through a broken border defeats the point of replacement. Accepted consequence, documented here so the implementer does not "fix" it. KD9's tuple-comment instruction exists for this same compatibility reason, not custody.

`registerLending` is unchanged. The lending constructor keeps reading the frozen `ovrfloInfo` tuple, including the `underlying_` nonzero check (`src/OVRFLOLending.sol:333-336`), and stops storing `underlying`. Comment why the tuple still carries `underlying`: compatibility with the off-repo mint gate's positional read, not custody.

The on-chain binding checks prove wiring at admission; they do not prove code identity. The multisig creation-code checklist stays the code-identity gate: rewrite the `registerOvrflo` NatSpec checklist for three creation transactions (vault embeds border+token), delete the stale "Token ownership needs no check" sentence, replace it with the minter/border binding list above, and extend the audited-artifact item to cover the border and token creation txs explicitly. Do not add on-chain bytecode-identity checks (factory size; multisig already validates).

Flash forwarders are deleted (KD1).

### KD7 — `replaceLending` on the factory; the border is deliberately not replaceable

A registered vault cannot admit a second lending market (`LendingExists`, `src/OVRFLOFactory.sol:210`). A flawed lending market would otherwise brick that column's lending forever, and pattern #9 (`underlyingToOvrflo`) also blocks a full-column redeploy.

Add `replaceLending(address newLending)` `onlyOwner`:

1. Run the same on-chain verification as `registerLending` (`src/OVRFLOFactory.sol:204-215`) against the candidate.
2. Require the vault already has a lending market; otherwise this is a first registration — use `registerLending`.
3. Repoint `ovrfloToLending[vault] = newLending`.
4. Set `lendingToOvrflo[newLending] = vault`.
5. **Keep** `lendingToOvrflo[old] = vault`. `_requireKnownLending` (`:403-405`) keys off that mapping, so factory admin forwarding (fee, treasury, APR bounds, tick spacing, and `setLendingRouter`) still reaches the old market while its loans wind down through permissionless `repay`/`close`/`claim`.
6. Append the new market to `lendings` / `lendingCount`.
7. Emit `LendingReplaced(vault, old, newLending)`.

Do not pause the old market. Do not add a vault-level unregister. Pattern #9 stays: a flawed *vault* is a new-column plus voluntary migration, not an in-place replace. Document that property.

The same argument does **not** extend to `replaceBorder`, and this plan closes it on purpose (user decision 2026-08-24): a lending market winds down through permissionless `repay`/`close`/`claim` and holds only streams mid-loan, while the border custodies the wrap reserve. Replacing a broken border means migrating that reserve through the very contract being replaced — replacement is not executable in exactly the failure cases that motivate it. Mitigation is audit depth on the smallest contract in CS1's surface. `ovrfloToBorder` stays write-once (KD6).

### KD8 — FREI-PI on wrap, unwrap, and deposit; skip borrow

The implementation-discipline FREI-PI gate applies. Only the protocol-invariant checks that earn their gas:

- **Border `wrap` and `unwrap`:** end-of-function `wrappedUnderlying <= IERC20(underlying).balanceOf(address(this))`. This is the peg as a checked fact (handoff §1).
- **Vault `deposit`:** end-of-function `marketTotalDeposited[market] <= IERC20(info.ptToken).balanceOf(address(this))`. `toUser + toStream == ptAmount` holds by construction in `_computeSplit` (`src/OVRFLO.sol:418-423`) — do not restate it.
- **Flash mint (CS2):** `totalSupply` after equals `totalSupply` before. Non-negotiable in that later plan.
- **Lending `borrow`:** skip. `obligation <= remaining` is already enforced by the gross-price cap (`src/StreamPricing.sol:52-59`). The fuzz conservation property covers token flow.

Cost accounting: each retained assert is one SLOAD plus one cold `balanceOf` (~2,600 gas) on every wrap, unwrap, or deposit. Accepted by design — the peg is checked, not assumed. Do not relitigate per call.

### KD9 — `OVRFLOLending` drops `underlying`; escrow, payout, and fee become ovrfloToken

Mechanics, all plumbing-level (the pricing path is untouched):

- Delete the `underlying` immutable (`src/OVRFLOLending.sol:118-119` declaration, `:343` store); the constructor keeps reading `ovrfloInfo(core)` and stores `treasury`/`ovrfloToken` only (KD6). The constructor's `underlying_` nonzero check (`:336`, within the read block `:333-337`) stays.
- `supply`: `_pullExact(IERC20(ovrfloToken), …)` (`:436`). `withdraw`: pay `IERC20(ovrfloToken)` (`:467`).
- `borrow`: `_payUnderlying` becomes `_payToken` paying `IERC20(ovrfloToken)` to the attributed borrower and the treasury (`:527-528`, `:1231-1235`).
- `repay`/`claim`/`close`/`proceeds`/`received`: unchanged — already ovrfloToken (`:645`, `:741-743`).
- `_fillTick`, `obligationForFill`, `requireEligible`, UNIT/MIN bounds: unchanged (`:1135-1178`, `src/StreamPricing.sol`).
- UNIT rounding is not part of this change. Supply still reverts `NotUnitAligned` (`:410`). Borrow principal still floors to UNIT (`:1161-1162`). Obligation still ceils. Claims still floor per position; dust still strands in `proceeds` (`:743`). Do not "fix" that dust — it is the residue of pro-rata without enumeration.
- Events keep their shapes; NatSpec "underlying" wording becomes "ovrfloToken". `IOVRFLOFactoryRegistry.ovrfloInfo` NatSpec ("underlying used for fee payment", `src/StreamPricing.sol:13`) is corrected — wording only, the tuple is untouched.

Lenders arrive with ovrfloTokens (deposit, wrap, or DEX). Borrowers draw ovrfloToken. The treasury accrues ovrfloToken fees it can itself lend (`setTreasury` exists at `:391-395`).

### KD10 — Factory-set router and `onBehalfOf` on `borrow` (CS1)

Add to `OVRFLOLending`:

- `address public router` (zero until set).
- `setRouter(address router_)` `onlyOwner`. Factory forwards as `setLendingRouter`. One event `LendingRouterSet`. A zero router disables the on-behalf path. The slot is settable so a flawed request book can be replaced after CS3 ships. `setRouter` accepts any nonzero address by design — the factory is the multisig trust boundary, and no on-chain identity check is added (learned preference: the Safe validates intent, the contract validates input). Until the Safe sets the request-book address, whoever holds the slot controls attribution; off-chain deployment verification treats `router` as part of the verified surface. Declare `router` **after** the last existing storage variable: raw-slot test constants (`TICKS_SLOT`, epoch-slot arithmetic at `test/OVRFLOLending.t.sol`) are recomputed from the regenerated golden, and the `exposed_epochState` cross-checks stay as the loud-failure guard.

Change `borrow` to take a final `address onBehalfOf` (`src/OVRFLOLending.sol:495`). Attribution:

```
address borrower = msg.sender == router ? onBehalfOf : msg.sender;
if (borrower == address(0)) revert ZeroAddress();
```

A non-router caller is always the borrower, even if that caller passes a wrong `onBehalfOf`. The frontend may pass the user address on every self-borrow. A leftover argument does not revert a good loan.

When `msg.sender == router`, revert if `onBehalfOf == address(0)` (the `borrower == address(0)` check). The router pulls the stream from its own escrow (`transferFrom(msg.sender, …)` stays at `:526`). Pay proceeds to `borrower`, not `msg.sender`. Index `borrowerLoanAt` / `borrowerLoanCount` under `borrower`. `_disposeStream` already returns to `loan.borrower` (`:1248-1259`) — no change there.

Two adjacent surfaces this decision touches:

- **`Borrowed` must emit the attributed borrower**, not `msg.sender` (today `src/OVRFLOLending.sol:530-532` logs `msg.sender`; the `Loan` struct stores it at `:508`). Loan lists, print-anchor analytics, and the request-book UI all key off this event. The event keeps its three indexed topics (`loanId`, `borrower`, `market`); `borrower` now carries the attributed address. No new indexed parameter is possible — the EVM caps an event at three indexed fields, and all three are spent.
- **`previewBorrow` keeps its four-argument signature** (`src/OVRFLOLending.sol:561-564`). It is a pricing view with no attribution; only `borrow` grows `onBehalfOf`.

Trust note, stated so the implementer does not add a check: `setRouter` accepts any nonzero address. The factory is the multisig trust boundary; the router it sets can attribute loans to arbitrary addresses (indexing, events, payouts). That power is the same power the Safe already holds over every factory forwarder, accepted as part of KD10 — no on-chain identity constraint is added.

If `test_Lending_RetainsRuntimeHeadroomCanary` fails after this hook plus the asset switch, drop the hook, keep the asset switch, and surface. Do not lower `LENDING_RUNTIME_CANARY`. The CS3 fallback is then GLM's routing table plus `settle`.

### KD11 — Deployment consequence: full fresh generation, including a new lockup

The lockup's `create*` gate reads `ovrfloInfo(msg.sender)` from the factory registry, and `setOvrfloStream` requires `lockup.factory() == address(this)` (`src/OVRFLOFactory.sol:369-381`). A new factory (KD6/KD7 change it) therefore requires a fresh OVRFLO Streams lockup from the sibling repo, plus fresh vault/border/token/lending. CS1 **blocks mainnet launch** and invalidates existing devnet/testnet stacks (re-seed). Nothing in this plan migrates a live stack in place.

### KD12 — Frontend: denomination alignment rides with CS1; the new UX is CS4

CS1 includes the minimal correctness sync only: supply/borrow flows flip the escrow asset (branded money `WstethWei` → `OvrfloWei` on the supply path), the deposit review drops the underlying fee approval, wrap/unwrap calls and the `wrappedUnderlying` read retarget the border, `borrow` calldata gains `onBehalfOf`, E2E fixtures and the seeded wallet funding paths update. Permit is available; the frontend may adopt it in this sync or in CS4 — either is interchangeable as long as approve+pull still works.

The handoff's §7 UX is CS4, sequenced per the handoff: (a) facts-label system + simple/advanced, (b) multi-tick defaults + public ladder, (c) composition suggestions, (d) request-book UI. Grounding notes for CS4: there is no `quote()` view (D2); the label composes `previewBorrow` plus derived net/residual. Simple/advanced is a new persisted view-state key under `docs/maps/state/keys/` (client-only, applied post-paint per web standard W6). The print-anchored rate default needs a `getLogs` aggregation over `Borrowed`. "How many lenders ahead" is a deployless lens in CS4, not a core function — `positionState` already gives amount ahead (`intervalStart` vs `filled`). Every CS4 item follows `ovrflo-web-standard.md` and writes a scratch intent capsule (`docs/maps/SCHEMAS.md` §4).

### KD13 — Solvency and reserve invariants are re-derived, spanning the column

- **Column solvency (replaces the combined check in `docs/agents/onboarding.md` §5):** `ovrfloToken.totalSupply() <= Σ_pt.balanceOf(vault) + underlying.balanceOf(border)` — the PT term sums the vault's balance across **every approved series**, not one market's PT (`addMarket` admits many; a single-series check silently passes while another series' backing is missing). Per-origin equality also holds: `totalSupply == Σ marketTotalDeposited + border.wrappedUnderlying`. The fizz property `property_vault_combined_solvency` (GL-07) is rewritten against vault+border.
- **Border reserve:** `wrappedUnderlying <= underlying.balanceOf(border)`; unwrap never spends PT; wrap/unwrap conservation. The three invariants in `test/OVRFLOWrapUnwrap.invariant.t.sol:180-192` port to a border suite.
- **Lending escrow:** `invariant_EscrowSolvency` (`test/OVRFLOLendingInvariant.t.sol:1471`) flips asset: `ovrfloToken.balanceOf(lending)` vs unfilled + proceeds. `invariant_MoneyRecipients` (`:1693`) asserts borrower and treasury payouts in ovrfloToken. Fizz GL-04 (`property_underlying_flow_ghosts`) re-expresses over ovrfloToken flow through the lending market.
- **Vault post-CS1:** `invariant_PtBalanceGteDeposited` (`test/OVRFLOInvariant.t.sol:305`) survives; the underlying-reserve invariants (`:296`, `:314`) leave the vault suite.

### KD14 — Flash mint (CS2) and borrow request book (CS3) are separately planned follow-ups

CS2 (next audit cycle, per handoff §4): ERC-3156 `maxFlashLoan`/`flashFee`/`flashLoan` of ovrfloTokens inside `OVRFLOBorder`, fee launching at zero with an owner-governed setter under a hardcoded **single-digit-bps** ceiling (not the 10_000 pattern), owner-set supply cap under a hardcoded ceiling, cap check + repay-and-burn check + per-function reentrancy guard + KD8's supply-conservation assert, **no** vault-wide lock. Calibration numbers are open items at CS2 planning.

CS3 (after CS1 stabilizes): the borrow request book as a thin router. Mechanics settled here so CS3's plan inherits them:

- Escrow: borrower posts stream + terms (`market`, `maxAprBps` — ceiling semantics; `targetBorrow`; `minAcceptable`) via plain `transferFrom` (never `safeTransferFrom` — mirroring the borrow escrow rationale at `src/OVRFLOLending.sol:486-488`). Escrowed streams are never drawn from.
- Post-or-execute: at post time, if acceptable depth exists at or below the ceiling, fill immediately (one call). `execute(requestId)` is permissionless and routes to the *cheapest* tick at or below the ceiling.
- `execute` calls core `borrow(..., onBehalfOf = human)` from the book (`msg.sender == router`). Proceeds go to the human. The stream returns to the human at close. The book holds nothing after a successful execute except still-resting requests. No `loanId -> borrower` table. No `settle`.
- Remaining face is read live at fill time; no snapshot. Fees: none in the book; the core's fill-time borrower fee is the only fee, now in ovrfloToken via KD9.
- Before CS3 ships, the Safe calls `setLendingRouter` on the factory.

### KD15 — README fixes ship immediately (CS0)

`README.md:490`: `lending.getfoundry.sh` → `book.getfoundry.sh`. `README.md:471`: roadmap line "Built after the Lending establishes a market APR" → "Built after the lending market establishes an APR". No other content change in CS0.

---

## Implementation Units (changesets)

### CS0 — README fixes (KD15)

`README.md` two-line edit. Verify: `grep`. Ships independently.

### CS1 — Denomination switch + border + minters + registration + flash removal + router hook (KD1–KD13, KD12-sync)

Ordered units. Write an intent record before the first code write of each unit. Each commit leaves `forge build && forge test` green except where this list says the token/border/vault trio is one compile unit. Note: U3 ships `setRouter` before U4 ships the factory forwarder; on the branch between them the owner reaches the lending market directly. Both land before merge.

- **U1. Delete PT flash** (KD1): `src/OVRFLO.sol`, factory forwarders, `interfaces/IFlashBorrower.sol`, the KD1 test list. Drop `ReentrancyGuard` from the vault. One commit. Pure removal. The ABI-enumerated error catalog test hard-fails when the flash errors leave the ABI — regenerate its expected catalog in the same commit (Lens F: `web/tests/lib/errors.test.ts` enumerates the vault ABI).
- **U2. Token + border + vault constructor chain** (KD2, KD3, KD4, KD5, KD8): rewrite `src/OVRFLOToken.sol` (named minters + Permit); add `src/OVRFLOBorder.sol`; change `src/OVRFLO.sol` — nested constructors, fee-from-mint, delete wrap/unwrap/reserve/sweep-underlying, FREI-PI on deposit. These three files are one compile unit and one review commit (or a stacked pair: token, then border+vault). Tests: rewrite `test/OVRFLOToken.t.sol` (standalone pair; a pranked stand-in border constructs the token); port `test/OVRFLOWrapUnwrap.t.sol` and `test/OVRFLOWrapUnwrap.invariant.t.sol` to the border; rewrite deposit-fee assertions (`test/OVRFLO.t.sol:262-283`, `:600-622`; `test/helpers/VaultMockHelpers.sol:63-66`). Fork suites consuming `_deployConfiguredSystem` update their seed/approval helpers with the same unit: `test/fork/OVRFLOWrapUnwrapFork.t.sol`, `test/fork/OVRFLOMainnetFork.t.sol`, `test/fork/OVRFLOFactoryMainnetFork.t.sol`, `test/fork/OVRFLOStreamDifferential.t.sol`, `test/fork/OVRFLOLendingMainnetFork.t.sol` (they self-skip without `MAINNET_RPC_URL`, so name them here — the default `forge test` blast radius does not see them; the underlying-fee approval at `test/fork/OVRFLOMainnetFork.t.sol:104-114` disappears under KD2, and the repay funding path at `test/fork/OVRFLOLendingMainnetFork.t.sol:168-174` moves to the border). Web-side in U7 but compile-coupled here: `wagmi.config.ts` gains `OVRFLOBorder` (the generated types for the new contract must exist before call sites compile), `web/lib/errors.ts` imports `ovrfloBorderAbi` into its union type and `generatedErrorNames` (rule 8 — without this, border reverts lose catalog copy and typed decoding), cache invalidation adds the border address to its key set (`web/lib/invalidate.ts`).
- **Storage-golden regeneration (applies to U2, U3, U4, U5):** every contract in the column changes storage — the vault deletes `wrappedUnderlying`; the token gains Permit's nonce mapping; the lending market swaps `underlying` for `router`; the factory gains `ovrfloToBorder`; `OVRFLOBorder` is a new artifact with no golden. Regeneration procedure: append `OVRFLOBorder` to `CONTRACTS` in `tools/scripts/check-storage-layout.sh` (a contract absent from that array gets zero dual-pipeline coverage regardless of Solidity-side tests), run the script (the dual-pipeline check; `test/StorageLayout.t.sol` alone covers only the current pipeline because `foundry.toml` keeps ffi off), regenerate all goldens under `artifacts/tests/storage-layout/` from both pipelines **only via `check-storage-layout.sh --write`** — hand-edited or hand-copied golden files are a deviation to log, because the canonicalizer strips AST-id suffixes and hand-copies reintroduce them — add a `test_StorageLayout_OVRFLOBorder_MatchesGolden` entry plus its golden, and commit the goldens with the unit that changed the layouts.
- **U3. Lending asset switch + router hook** (KD9, KD10): `src/OVRFLOLending.sol`. Tests: flip escrow/payout asserts across `test/OVRFLOLending.t.sol`, `test/OVRFLOLendingInvariant.t.sol`, `test/OVRFLOLendingGas.t.sol`, `LendingFuzz` in `test/OVRFLOFuzz.t.sol`, `test/helpers/LendingMockFixture.sol` (merge `_fundLender`/`_fundRepayer` into one ovrfloToken path), `test/fork/OVRFLOLendingMainnetFork.t.sol`. Add router/`onBehalfOf` unit tests: self-borrow ignores a wrong `onBehalfOf`; router with `onBehalfOf = address(0)` reverts; router attributes, pays, and indexes the human. `Borrowed`'s existing indexed `borrower` topic carries the **attributed** address — no new topic exists (the three-index cap is already spent on `loanId`/`borrower`/`market`); data fields are unchanged. In-repo consumers read only `actualBorrow`/`feeAmount`/`obligation`/`loanId`, and no off-repo ABI carries `Borrowed` (Lens C census). If the lending canary fails, drop KD10 from this commit and surface.
- **U4. Factory** (KD6, KD7): `src/OVRFLOFactory.sol` — `registerOvrflo` binding checks, `ovrfloToBorder`, `TokenMinterMismatch`/`BorderMismatch`, `replaceLending`, `setLendingRouter`, retargeted `sweepExcessUnderlying`, flash forwarder deletion (if any residue from U1). Tests: `test/OVRFLOFactory.t.sol` — replace `test_VaultConstruction_CreatesAndOwnsToken` (`:211-220`) with minter-binding and `vault.border()` tests; add border mismatch paths; add `replaceLending` (old market still known; new market is `ovrfloToLending`; second `registerLending` still reverts); port mock forwarders (`test/mocks/MockOvrfloAdmin.sol`).
- **U5. Deploy recipe + tooling** (KD5, KD11): `script/OVRFLO.s.sol` runbook steps 6–9 (still deploy vault then register; add border reads), `script/seed-local.sh`, `script/lib/OVRFLOTestFixtures.sol` (`_deployConfiguredSystemAs` return tuple grows to `(factory, ovrflo, token, border)` — positional destructurers break loudly at compile time), `write-deployment-artifact.mjs` (the artifact's `border` field joins the same paired-optional consume rule as `ovrflo`/`lending` — both present or both derived, `tools/scripts/write-deployment-artifact.mjs:27-31`), `test/DeploySize.t.sol` `_artifacts()` gains `OVRFLOBorder`. The client env contract gains nothing (`web/lib/config.ts` unchanged) — border reaches the web through bootstrap discovery, not env.
- **U6. Invariant/fuzz re-derivation** (KD13): border wrap suite; vault drops underlying-reserve terms; fizz regeneration. Run the fizz-sync path after U2–U4 land. The GL-nn property IDs (GL-02/03/04 asset flip, GL-06 holder set, GL-07 span, GL-09 retarget, GL-30 minter shape) are cited from the current harness read; verify each against `test/fizz/Properties.sol` during the sync rather than trusting the citation. Recompute raw-slot constants from the regenerated lending golden (`TICKS_SLOT`, packed epoch-slot decode in `test/OVRFLOLending.t.sol`) and keep the `exposed_epochState` cross-checks green.
- **U7. Web denomination sync** (KD12): asset flips, border retargeting via the new bootstrap discovery leg (KD5 provenance decision — `NEXT_PUBLIC_OVRFLO_BORDER` is not added), approval-count change, `borrow` `onBehalfOf`, E2E + fixtures. State-touching frontend work: write the scratch intent capsule per `docs/maps/SCHEMAS.md` §4 before the first edit.
- **U8. Docs sync**: `README.md` architecture sections, `CONCEPTS.md` (border entry, three labeled exits, denomination vocabulary), `docs/agents/onboarding.md` §2/§4/§5/§7, `AGENTS.md` overview and solvency fact, `docs/solutions/patterns/ovrflo-critical-patterns.md` (fee denomination; sweep-reserve reasoning moves to the border), `VAULT_SECURITY.md` (two burn authorities), R-02 rejected-finding pointer follows the sweep to the border, `x-ray/` refresh after implementation. Also: the stale border-authority lines in `docs/maps/ui/assets.md` and `docs/maps/state/keys/chain-reads.md` (`chain.wrap-reserve` retargets to the border read) — the maps-presence gate forces a companion map update with U7 anyway; name the two files so it is not improvised.

### CS2 — ERC-3156 flash mint in the border (KD14, next audit cycle)

Separate plan + sweep. Constants calibration is an explicit open item (fee ceiling single-digit bps; supply cap a low multiple of circulating supply and deepest pool depth, timelock-raised).

### CS3 — Borrow request book periphery (KD14)

Separate plan + sweep, after CS1 stabilizes. Composes `borrow(..., onBehalfOf)`. Event schema for the two-sided ladder frontend decided there.

### CS4 — Frontend UX per handoff §7 (KD12)

Four sub-changesets (a–d) each with intent capsules and maps lint; request-book UI (d) lands with CS3.

### Not built (handoff §9.5)

PT flash (removed, KD1), underlying flash loans (deferred indefinitely — flash-mint-plus-unwrap covers the use case; revisit only with a deep reserve, and then only with a vault-wide lock and internal-counter accounting), keepers/bounties anywhere, a second borrower-side lending market, per-user operator approvals, `supplyWithPermit` wrappers.

---

## Verification Contract

1. `forge build` then `forge test` — full suite green post-CS1 (user preference: clean build before tests).
2. `FOUNDRY_PROFILE=invariant forge test --match-contract OVRFLOLendingInvariant` and the border/vault invariant contracts — KD13's re-derived properties hold at 500 runs / depth 40.
3. `bash script/seed-local.sh` end-to-end: deploy vault (which creates border and token), `registerOvrflo(vault)`, produce `deployments/local.json` containing `border`; `BOOT_NO_UI=1 npm --prefix web run bootstrap:local` still gates E2E.
4. `test/DeploySize.t.sol` passes with `OVRFLOBorder` gated (EIP-170/3860 caps). Lending canary still holds, or KD10 was dropped and logged.
5. Storage goldens: `bash tools/scripts/check-storage-layout.sh` green after U2–U5; all five artifacts (factory, token, vault, border, lending) have committed goldens.
6. `npm --prefix web run test` and `npm --prefix web run test:e2e` green after U7.
7. Named successor scenarios (test accountability — each names the scenario, not just the unit):
   - *Fee-from-mint*: depositor approves only the PT; treasury ends with exactly `feeAmount` ovrfloToken; `Deposited.toUser` and the user's balance equal `toUser - feeAmount`; no party's underlying balance changes during `deposit`; `minToUser` equal to the net passes and one wei above the net reverts.
   - *Zero-fee skip-mint*: with fee zero, treasury balance is unchanged, no mint reaches the treasury, and the depositor receives the full gross — the branch must not silently mint dust or revert on a zero transfer-to-self.
   - *Border round trip*: wrap 10 wstETH at the border, unwrap 7 — reserve 3 remains, totalSupply tracks, vault underlying balance is zero throughout; unwrap beyond reserve reverts `InsufficientReserve`.
   - *Nested constructors*: after `new OVRFLO(...)`, `token.vault() == vault`, `token.border() == vault.border()`, `border.ovrfloToken() == vault.ovrfloToken()`; a third address cannot mint or burn. The token suite (`test/OVRFLOToken.t.sol`) covers minter/Permit behavior against a standalone-constructed pair; the vault-construction bindings live in the factory/vault suites — do not duplicate both directions in every file.
   - *Registration*: a hostile vault whose token `border()` is not `vault.border()` reverts `TokenMinterMismatch`; a candidate whose border reports a foreign factory reverts `BorderMismatch`; `registerOvrflo` still takes one argument; registration asserts `ovrfloToBorder(ovrflo) != address(0)` for the admitted column.
   - *Lending single-asset*: `supply` moves ovrfloToken into escrow and touches no underlying; `borrow` pays net ovrfloToken to the attributed borrower and fee ovrfloToken to the treasury.
   - *Router hook*: a non-router caller who passes `onBehalfOf = other` still owns the loan; a router call with `onBehalfOf = human` pays and indexes the human and returns the stream to the human on close; a router call with `onBehalfOf = address(0)` reverts.
   - *replaceLending*: after replace, `ovrfloToLending` is the new market; `registerLending` still reverts `LendingExists`; factory `setLendingFee` still reaches the old market; an old-market loan can `repay`/`close`/`claim`.
   - *Flash surface gone*: no ABI entry for `flashLoan` on the vault; the deleted suites' removal matches the KD1 list.
   - *Permit*: an EIP-2612 signature lets a lender `supply` without a prior `approve` transaction (two calls or a batch); a non-minter still cannot mint.
8. Diff review: `git diff --stat` compared against the predicted blast radius in § Implementation Units before CS1 is called done (onboarding § Before writing code, step 3).

## Definition of Done

CS1 done when: all contracts compile and the full Foundry suite including re-derived invariants and regenerated fizz properties passes; the seed smoke deploys the column by constructing the vault (which creates border and token) and registers with one-argument `registerOvrflo`; DeploySize gates all five deployables; web unit + E2E green; docs (README, CONCEPTS, onboarding, AGENTS, critical-patterns, VAULT_SECURITY) no longer describe the pre-switch architecture; every deviation from this plan is logged on the ticket with its reason (do not edit this plan to absorb a deviation).

## Decisions already signed

These were open in an earlier draft. They are closed:

1. Fresh-generation posture (KD11) — CS1 re-seeds everything, including a new lockup from the OVRFLO-Streams repo.
2. Border name — `OVRFLOBorder`.
3. `minToUser` — net-of-fee bound (KD2).
4. PT flash removal — CS1 first commit (KD1), not deferred to CS2.
5. Deploy recipe — nested constructors (KD5), not nonce-CREATE or CREATE2.
6. `registerOvrflo` arity — one argument; factory reads `vault.border()` (KD6).
7. Token getters — `vault()` / `border()`, not `minter0` / `minter1` (KD4).
8. `replaceLending` and the router hook — CS1 (KD7, KD10), not a later factory/lending reopen.
9. Request-book identity — core `onBehalfOf`; no `settle` table (KD10, KD14).
10. CS2 constants — deferred to CS2 planning; only the shape (single-digit-bps ceiling, capped owner-set supply cap) is settled here.

No further user sign-off is required before the ignorance-lens sweep. The sweep's round-1 verdict and the dry-run implementer's pass against this amended text are recorded in § Sweep Contracts.

## Sweep Contracts

Swept 2026-08-24 per `docs/solutions/patterns/ignorance-lens-sweep.md` (round-1 lenses: storage/interface, security, test accountability, web/docs/tooling; completeness critic verdict STOP with three folded point fixes; dry-run implementer pass completed the same day — evidence walk resumed after a rate-limit interruption, synthesis by the orchestrator; verdict BUILD-READY WITH NOTES, notes folded). Rules below bind CS1 implementation. Wrong plan text found by the sweep is point-fixed in place above; the rule groups that outlived their findings live here. Each names its successor scenario.

### Sweep rules — binding

1. **Border permanence (KD6/KD7, user decision).** `ovrfloToBorder` is write-once. Do not add `replaceBorder`, a border unregister, or reserve-migration tooling "for completeness." A flawed border is a fresh-column-plus-migration problem under pattern #9; replacement is not executable through broken custody anyway. Successor scenario: if an audit finds a border defect post-CS1, the ticket starts from KD7's closing paragraph — it does not reopen this decision.
2. **Border provenance (KD5).** The web learns `border` from factory discovery only (`ovrfloToBorder` bootstrap leg into `VaultInfo`). No `NEXT_PUBLIC_OVRFLO_BORDER`; no second static anchor; env/artifact border values are seed-tooling convenience. Successor scenario: any new per-vault client binding follows the same chain-derived boot model.
3. **Goldens are generated, never hand-edited (storage bullet).** Golden changes go through `check-storage-layout.sh --write` after both pipelines agree; hand-copied or hand-tweaked golden files are a logged deviation even when the diff looks right. The `CONTRACTS` array edit precedes any new contract's first golden. Successor scenario: every future new deployable repeats both steps.
4. **Raw-slot constants follow the golden (KD10/U6).** After the lending storage edit, recompute `TICKS_SLOT` and packed epoch-slot decode arithmetic from the regenerated golden before touching test logic; keep the `exposed_epochState` cross-checks green as the loud-failure guard. Never fix a shifted-slot failure by editing the constant to make a vacuous pass — verify the decoded values still cross-check.
5. **Code identity stays off-chain (KD6).** On-chain registration checks prove wiring; the multisig creation-code checklist proves code identity for all three creation transactions (vault, border, token). Do not add on-chain bytecode-identity checks and do not let "the factory verifies it now" erode checklist discipline on the two new children.
6. **Router trust posture (KD10).** `setRouter` accepts any nonzero address; attribution power belongs to whoever holds the slot until the Safe sets it. No identity check, no allowlist. Deployment verification covers `router` as part of the verified surface.
7. **Fee equality is structural (KD2/KD13).** Fee-from-mint means treasury gain equals depositor deduction with no token outside the mint split; tests assert the split, not a re-derived conservation proof.
8. **Compile-coupled web edits land with their unit (U1/U2/U7).** The error-catalog regeneration rides U1; `wagmi.config.ts`, the `ovrfloBorderAbi` import into `web/lib/errors.ts` (union type plus `generatedErrorNames`), and invalidation ride U2; call-site flips ride U7. Without the U2 import, every border revert loses catalog copy and typed decoding and no gate notices — the coverage loop only checks names the union already contains. A green `forge test` does not mean the web compiles — run `npm --prefix web run build` at U2 and U3 boundaries.
9. **Maps layer is named blast radius (U7/U8).** `docs/maps/ui/assets.md` and `docs/maps/state/keys/chain-reads.md` update with U7 (border authority retarget); do not let the maps-presence gate discover them.

### Proven absences

Recorded so later lenses do not re-open settled ground:

- **`OvrfloInfo` freeze:** field 0 is read positionally by the fork's mint gate (`SablierV2Lockup._requireKnownOvrflo` destructures `(treasury,,)`); separate mapping (KD6) is correct. Tuple comment cites compatibility, not custody.
- **Cross-version layout compat:** no proxies; no cross-version raw-slot assertions remain (the fizz harness uses real `registerLending`, no factory-slot grafts); immutables never appear in goldens. Fresh generation (KD11) needs nothing more.
- **ERC20Permit:** OZ 4.9 slots land in the regenerated token golden automatically; EIP-712 domain needs name-consistent constructors (KD4 satisfies); no address-derivation assumption exists anywhere (plain CREATE, no CREATE2 prediction).
- **ABI changes:** no off-repo consumers of `borrow`, `Borrowed`, `FeeTaken`, `previewBorrow`, or `registerOvrflo` shapes; deployment-artifact selectors cover stream/factory only. `generated.ts` decoding survives shape-preserving event changes.
- **Two-minter burn authority, nested-constructor trust, flash removal residue, hostile-candidate admission:** cleared by the security lens; admission weakness is closed by rule 5, not new checks.

CS2, CS3, and CS4 each get their own plan and sweep.
