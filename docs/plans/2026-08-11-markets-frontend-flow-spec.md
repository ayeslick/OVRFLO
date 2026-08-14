# OVRFLO Markets Frontend Flow Specification

Status: exploration contract for rendering and implementation. Treat this file as read-only once implementation begins.

## Product model

The Markets app has three permanent destinations:

- **Borrow** — pledge one eligible Sablier stream, choose one fixed APR tick, receive underlying, and create one loan.
- **Supply** — choose one market and one fixed APR tick, append underlying liquidity, and create one lender position.
- **Positions** — monitor supplied positions, loans, and streams; expose only actions currently available for the connected wallet.

Transactions are linear. Monitoring uses master/detail progressive disclosure. There is no dashboard home, widget system, or separate market explorer.

## Shared shell and entry

### Disconnected

`ENTRY.DISCONNECTED`

- Header exposes `CONNECT WALLET`.
- Main surface explains the three destinations in one sentence each; no protocol metrics.
- Connecting never changes the selected destination.

### Connected and syncing

`ENTRY.SYNCING`

- Preserve the requested destination.
- Resolve chain, wallet balances, lender position IDs, borrower loan IDs, and eligible streams in parallel.
- Loading is not represented as zero. Each unresolved region uses a bounded skeleton or `CHECKING…` state.

### Connected and ready

`ENTRY.READY`

- If the customer arrived through a Borrow, Supply, or Positions link, keep that destination.
- If there is no destination intent, show the compact route chooser: Borrow, Supply, or Positions.
- Wallet or chain change invalidates quotes and transaction checkpoints, then returns to the nearest safe selection state.

## Asset and stream preparation

These are contextual utilities, not a fourth dashboard. They open from the wallet control, from a missing-prerequisite state, or from the action that needs them.

### Create a borrowable stream from PT

`STREAM.SELECT_MARKET → STREAM.ENTER_PT → STREAM.REVIEW → STREAM.APPROVE_PT → STREAM.APPROVE_FEE → STREAM.SIGN → STREAM.CONFIRMED`

- Review shows PT deposited, immediate ovrfloToken to wallet, ovrfloToken placed in the new Sablier stream, underlying fee, maturity, and deposit-cap status.
- `APPROVE_PT` authorizes the exact PT amount unless an existing allowance covers it.
- `APPROVE_FEE` authorizes underlying for the quoted fee unless an existing allowance covers it. Because the oracle-derived fee can move between blocks, show both the current fee and the bounded approval amount; the existing frontend policy uses a 2% fee buffer, never unlimited approval.
- `SIGN` submits the vault deposit only after both allowances are sufficient.
- Confirmation identifies the created stream and exposes `BORROW AGAINST THIS STREAM`.
- If either allowance already covers the requirement, skip that checkpoint without renumbering the human-readable job stages.

### Wrap underlying into ovrfloToken

`ASSETS.WRAP_AMOUNT → ASSETS.WRAP_APPROVE → ASSETS.WRAP_SIGN → ASSETS.WRAP_CONFIRMED`

- Show exact `underlying → ovrfloToken` 1:1 amounts and destination wallet.
- Approve the exact underlying amount to the vault unless allowance is sufficient.
- `wrap` charges no protocol fee and creates no stream.
- Expose this flow from the wallet asset control, from Repay when the wallet lacks ovrfloToken, and from any role's position detail.

### Unwrap ovrfloToken into underlying

`ASSETS.UNWRAP_REVIEW → ASSETS.UNWRAP_SIGN → ASSETS.UNWRAP_CONFIRMED`

- Show the tracked wrap reserve before enabling the action.
- `unwrap` is 1:1, needs no token approval, and charges no protocol fee.
- Insufficient reserve is an unavailable route, not a failed balance or failed claim.

## Borrow flow

Borrow starts with the collateral stream. The selected stream determines compatible market context and the maximum borrow economics.

| Screen key | Customer decision | Required UI | Continue when |
|---|---|---|---|
| `BORROW.SELECT_STREAM` | Which eligible stream to pledge? | Eligible stream list; remaining amount; source series; stream maturity; current pledge status | One eligible, unpledged stream is selected |
| `BORROW.ENTER_AMOUNT` | How much underlying is wanted now? | Selected stream summary; maximum gross borrow; amount input; balance-independent MAX | Amount is nonzero, unit-aligned, and within the stream-derived cap |
| `BORROW.SELECT_RATE` | Which fixed APR tick should be filled? | Three contextual rates plus `ALL RATES`; live depth in underlying; exact partial-fill warning when target exceeds depth | A live tick is selected and expected net meets the customer's minimum |
| `BORROW.REVIEW` | Are the exact economics acceptable? | Gross borrow; fee; net proceeds; obligation; residual stream; maturity; selected APR; partial-fill status | Quote remains current and customer selects Review Borrow |
| `BORROW.APPROVE_STREAM` | May OVRFLOLending transfer this Sablier NFT? | Exact stream ID; operator address; permission explanation; wallet checkpoint | Skip when market is already approved for this stream; otherwise approval confirms |
| `BORROW.SIGN` | Submit `borrow` | Frozen review receipt; min acceptable net; wallet checkpoint | Borrow transaction is signed |
| `BORROW.PENDING` | Wait for inclusion | Transaction hash; submitted facts; safe navigation | Receipt confirms or fails |
| `BORROW.CONFIRMED` | Inspect the created loan | Loan ID; actual borrow; fee; net proceeds; obligation; stream ID; APR; `VIEW LOAN` | Customer navigates to the position or starts another flow |

### Borrow exceptions

- **No eligible stream:** explain that Borrow requires an eligible, transferable OVRFLO-created Sablier stream. Do not show a disabled transaction form.
- **No depth at selected tick:** keep amount and stream; return to `BORROW.SELECT_RATE` and identify other live ticks.
- **Partial fill:** show actual gross, actual fee, and actual net before signing; never imply the target is guaranteed.
- **Quote changed:** freeze signing, refresh depth, and return to `BORROW.REVIEW` with a visible `QUOTE UPDATED` diff.
- **Approval or signature rejected:** remain at the checkpoint with all selections preserved.
- **Borrow revert:** show the decoded reason when available and provide one recovery action, normally `REFRESH QUOTE`.

### Borrow fee approval rule

- Borrow's protocol fee is deducted from `actualBorrow` before net proceeds are paid. It is disclosed in Review and frozen in the submitted receipt; it is not pulled from the wallet and requires no ERC-20 approval.
- The only origination approval is the Sablier stream NFT approval when not already granted.

## Supply flow

Supply starts with the market because maturity and market activity constrain every later choice.

| Screen key | Customer decision | Required UI | Continue when |
|---|---|---|---|
| `SUPPLY.SELECT_MARKET` | Which PT market and maturity? | Approved active markets; underlying; maturity; number of live APR ticks; best available depth | One active pre-maturity market is selected |
| `SUPPLY.ENTER_AMOUNT` | How much underlying to supply? | Wallet balance; amount input; exact MAX; minimum and unit-alignment feedback | Amount is nonzero, unit-aligned, above minimum, and within balance |
| `SUPPLY.SELECT_RATE` | At which fixed APR tick should liquidity rest? | Three contextual ticks plus `ALL RATES`; existing unfilled amount ahead; selected queue boundary | One valid configured tick is selected |
| `SUPPLY.REVIEW` | Is the position placement correct? | Amount; APR; market maturity; currently ahead; unfilled withdrawability; explicit `earnings begin only when filled` | Review remains current and customer selects Review Supply |
| `SUPPLY.APPROVE` | May OVRFLOLending transfer this exact underlying amount? | Exact amount; spender; current allowance; wallet checkpoint | Skip when allowance is sufficient; otherwise approval confirms |
| `SUPPLY.SIGN` | Submit `supply` | Frozen review receipt; wallet checkpoint | Supply transaction is signed |
| `SUPPLY.PENDING` | Wait for inclusion | Transaction hash; submitted facts; safe navigation | Receipt confirms or fails |
| `SUPPLY.CONFIRMED` | Inspect the created lender position | Position ID; amount; APR; market; queue placement; initial filled/unfilled/claimable state; `VIEW POSITION` | Customer navigates to the position or starts another flow |

### Supply exceptions

- **Market matured or inactive:** keep amount if possible; return to `SUPPLY.SELECT_MARKET` and explain why the previous market is unavailable.
- **Tick configuration changed:** return to `SUPPLY.SELECT_RATE`; never silently move liquidity to another APR.
- **Allowance rejected:** remain at `SUPPLY.APPROVE` with selections preserved.
- **Supply revert:** show the decoded reason and one recovery action; never discard the review receipt.

## Positions flow

Positions is the default monitoring destination for a wallet with history. It is not a transaction wizard.

### Index

`POSITIONS.INDEX`

- Top strip is `NOW / NEXT`: available actions first, then upcoming wallet-relevant maturities.
- Main list is `YOUR POSITIONS` with role filters `ALL`, `SUPPLIED`, `BORROWED`, and `STREAMS`.
- Hide zero-count role filters rather than showing empty categories.
- Selecting a row updates the fixed detail pane in place. The list and detail pane are not visually connected by lines or arrows.
- Direct links may preselect a position or loan ID.

### Supplied position detail

`POSITIONS.SUPPLY_DETAIL`

- Show amount supplied, filled, unfilled, claimable, fixed APR, maturity, and amount currently ahead.
- Show `WITHDRAW UNFILLED` only when unfilled is nonzero.
- Show `CLAIM` only when claimable is nonzero.
- If both are available, Claim is primary only when it is the action that brought the customer through `NOW / NEXT`; otherwise preserve last intent.
- After confirmation, refresh `positionState` and claim discovery before updating the row.

### After a lender claim

`POSITIONS.CLAIM_CONFIRMED`

- Lending `claim` pays recovered value in `ovrfloToken`, not underlying.
- The receipt must say exactly what arrived: `RECEIVED <amount> ovrfloToken`.
- Present three explicit next choices without implying equivalence when liquidity differs:
  - **Unwrap to underlying** — call the vault's `unwrap` for a 1:1 `ovrfloToken → underlying` exit. Enable only when the tracked wrap reserve covers the requested amount. This is one transaction and needs no token allowance.
  - **Keep ovrfloToken** — return to the position with the claimed token in the wallet.
  - **Claim PT after maturity** — after the relevant series matures, burn ovrfloToken 1:1 for PT through the vault's maturity `claim`. Receiving PT is not the same as receiving underlying; redemption from PT to underlying happens through Pendle/SY outside the lending claim.
- A swap route may be offered only when a real configured venue and quote exist. It is not a protocol-guaranteed exit and is absent from the base flow.
- If wrap reserve is insufficient, disable `UNWRAP TO UNDERLYING`, show available reserve, and keep the other exits readable. Never label reserve unavailability as a failed claim.

### Unwrap to underlying

`POSITIONS.UNWRAP_REVIEW → POSITIONS.UNWRAP_PENDING → POSITIONS.UNWRAP_CONFIRMED`

- Review shows the exact 1:1 amounts, current wrap reserve, destination wallet, and underlying symbol.
- Submit one `unwrap(amount)` transaction; there is no approval checkpoint.
- Confirmation says `RECEIVED <amount> <underlying>` and returns to the supplied position with refreshed wallet balances.

### Borrowed position detail

`POSITIONS.LOAN_DETAIL`

- Show actual net proceeds, obligation, recovered, outstanding, APR, pledged stream, and maturity.
- Show `CLOSE FROM STREAM` only when the UI has verified withdrawable stream value covers outstanding; permissionless does not mean always executable.
- Show `REPAY` while outstanding is nonzero.
- Closed loans remain readable and clearly identify the returned stream.

### Repay a loan

`POSITIONS.REPAY_AMOUNT → POSITIONS.REPAY_PREPARE → POSITIONS.REPAY_APPROVE → POSITIONS.REPAY_SIGN → POSITIONS.REPAY_CONFIRMED`

- Permit partial repayment up to outstanding and a clear `REPAY IN FULL` choice.
- Show repayment in ovrfloToken, remaining obligation, and whether full repayment returns the pledged stream.
- If the connected wallet lacks enough ovrfloToken but has underlying, `REPAY_PREPARE` offers `WRAP SHORTFALL` and returns with the entered repay amount preserved.
- Wrapping the shortfall uses the normal underlying approval and `wrap` transaction.
- Repay then approves the exact ovrfloToken repayment amount to OVRFLOLending unless allowance is sufficient, followed by the `repay` transaction.
- Anyone may repay, but the released stream always returns to the recorded borrower. State this when payer and borrower differ.
- Full repayment closes the loan; partial repayment refreshes outstanding and keeps the loan active.

### Stream detail

`POSITIONS.STREAM_DETAIL`

- Show source deposit/series, released, remaining, maturity, transferability, and whether the stream is pledged.
- When pledged, link to the loan detail; do not offer transfer actions.
- When returned and eligible, expose `BORROW AGAINST THIS STREAM` as a route into `BORROW.ENTER_AMOUNT` with stream context preserved.

## Position actions

Every position action uses the same checkpoint grammar:

`READY → WALLET_SIGNATURE → PENDING → CONFIRMED → REFRESHED_DETAIL`

- **Withdraw:** exact refundable unfilled amount; owner-only.
- **Claim:** exact discovered claimable amount and contributing loans; refresh discovery after confirmation.
- **Repay:** exact amount selected by payer; explain that the borrower receives the released stream even when a third party repays.
- **Close:** show the derived outstanding and current withdrawable stream value before signature.

## Global rendering states

Every screen must render these states without changing its topology:

- `LOADING` — unresolved data, never represented as zero.
- `EMPTY` — confirmed zero results with a role-specific next action.
- `READY` — data is current and actions are enabled.
- `STALE` — quote or wallet context changed; signing is disabled until refreshed.
- `WALLET_PENDING` — waiting for approval or signature.
- `CHAIN_PENDING` — transaction submitted; safe to navigate away.
- `CONFIRMED` — receipt with the created/updated entity ID.
- `ERROR` — decoded cause, preserved inputs, one primary recovery action.

## Navigation and persistence

- Browser Back moves one decision backward and preserves valid selections.
- Switching between Borrow and Supply preserves each flow independently for the current wallet and chain.
- Positions direct links preserve the selected entity ID in the URL.
- Transaction checkpoints cannot be entered through stale browser history; they revalidate and fall back to Review.
- Wallet or chain changes clear approvals, quotes, pending checkpoints, and selected entity ownership assumptions.
- Completed receipts remain locally recoverable by transaction hash until indexed position/loan data is available.

## Render inventory

The minimum deterministic render set is:

1. `ENTRY.DISCONNECTED`
2. `ENTRY.READY`
3. `BORROW.SELECT_STREAM`
4. `BORROW.ENTER_AMOUNT + SELECT_RATE`
5. `BORROW.REVIEW`
6. `BORROW.APPROVE_STREAM`
7. `BORROW.SIGN`
8. `BORROW.CONFIRMED`
9. `SUPPLY.SELECT_MARKET`
10. `SUPPLY.ENTER_AMOUNT + SELECT_RATE`
11. `SUPPLY.REVIEW`
12. `SUPPLY.APPROVE`
13. `SUPPLY.SIGN`
14. `SUPPLY.CONFIRMED`
15. `POSITIONS.INDEX + SUPPLY_DETAIL`
16. `POSITIONS.INDEX + LOAN_DETAIL`
17. `POSITIONS.INDEX + STREAM_DETAIL`
18. One representative `LOADING`, `EMPTY`, `STALE`, `PENDING`, and `ERROR` state per topology.
19. `POSITIONS.CLAIM_CONFIRMED` with an enabled underlying unwrap.
20. `POSITIONS.CLAIM_CONFIRMED` with insufficient wrap reserve.
21. `POSITIONS.UNWRAP_REVIEW` and `POSITIONS.UNWRAP_CONFIRMED`.
22. `STREAM.REVIEW`, `STREAM.APPROVE_PT`, and `STREAM.APPROVE_FEE`.
23. `ASSETS.WRAP_AMOUNT`, `ASSETS.WRAP_APPROVE`, and `ASSETS.WRAP_CONFIRMED`.
24. `POSITIONS.REPAY_AMOUNT`, `POSITIONS.REPAY_PREPARE` with a wrap shortfall, `POSITIONS.REPAY_APPROVE`, and `POSITIONS.REPAY_CONFIRMED`.

## Visual direction for the next iteration

- The emotional thesis is **a new financial mechanism inside a familiar machine**. Self-repaying loans are unfamiliar; a disciplined retro workstation provides learned cues, visible state, and psychological safety.
- Retain One-Bit's binary hierarchy, inverse selections, dither, title bars, receipt precision, and explicit job progress.
- Do not reduce retro to decoration or parody: no fake Apple identity, trash can, arbitrary desktop icons, or overlapping-window clutter. Familiar metaphors must explain state—wizard, job queue, permission receipt, foreground task, completed record.
- Use a stronger contemporary grotesk for navigation and decisions; mono/bitmap type carries state, amounts, APR, IDs, permissions, and receipts.
- Let black fields establish large-scale composition. Gold and cyan are signal colors, never decoration.
- Rate Tape is an interaction primitive for maturity, rate, queue position, and settlement—not a universal motif.
- Every wallet prompt is shown as a named job with exact asset, amount, spender/operator, reason, and what comes next.
- Prefer one dominant decision per viewport, fewer rules, decisive inversion, and asymmetric compositions. The interface should feel like OVRFLO System 1.0: old enough to trust, new enough to belong only to this protocol.
