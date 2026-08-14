# OVRFLO Progressive Markets Design Direction

## Objective

Make Borrow, Supply, Convert, and Positions understandable on first contact without removing the protocol depth that experienced customers need.

The default interface answers one immediate question. Secondary financial detail, execution detail, history, and contract data remain available through explicit disclosure controls.

## Product language

- Read the ERC-20 `name()` and `symbol()` at runtime. For the wstETH vault fixtures, the token is **OVRFLO Wrapped Staked Ether** with symbol **ovrfloWSTETH**.
- Use the live symbol instead of the generic implementation term `ovrfloToken` in customer-facing copy.
- Describe ovrfloWSTETH as redeemable 1:1 for an eligible PT after maturity. Do not describe it as an equal claim on wstETH.
- Wrapping wstETH mints ovrfloWSTETH 1:1 and adds the received wstETH to the vault's tracked wrap reserve. It charges no protocol fee and creates no stream.
- Unwrapping burns ovrfloWSTETH for wstETH 1:1 only while the tracked wrap reserve covers the requested amount.
- Do not use “shortfall.” State the customer's present balance and the additional amount needed, then offer a direct way to obtain it.

## Default disclosure

### Borrow

Visible by default:

- selected stream and maturity;
- amount requested;
- exact wstETH the borrower receives;
- amount the stream repays over time;
- confirmation that any residual stream value returns to the borrower;
- one `REVIEW BORROW` action.

Disclosed on request:

- rate and fee;
- gross/net calculation;
- stream repayment explanation;
- approvals and transaction sequence;
- contract data.

### Supply

Visible by default:

- wallet balance;
- supply amount;
- selected fixed APR and adjacent choices;
- when earnings begin;
- unmatched-withdrawal behavior;
- one `REVIEW SUPPLY` action.

Disclosed on request:

- market depth;
- matching mechanics;
- claim attribution;
- approval and transaction sequence;
- contract data.

### Positions

The default `SIMPLE` view shows only totals, position identity, human-readable state, and next action. It does not open a detail inspector automatically.

The optional `DETAILED` view adds financial columns and terms. Individual position pages lead with current state and the next meaningful action; activity and contract information remain closed until requested.

### Convert

The converter is the visual baseline for the product: two assets, one exchange relationship, one amount, one action. Token semantics and reserve behavior are present but subordinate. Approval detail appears only after `CONTINUE`.

## Visual system

- Bright white operating surface with one black-framed work area.
- Black title bar and decisive black primary action.
- One cyan accent reserved for active progress or attention.
- Bitmap character in headings and measured values; plain, readable typography for explanations.
- Squared controls, thin rules, restrained one-bit texture, and generous whitespace.
- No desktop metaphors, system-version naming, event tapes, job terminology, connector diagrams, or default technical consoles.

## Complexity moved out of the default view

- APR calculations, fee breakdowns, allowances, spenders, and transaction queues move to Review.
- Order-book depth and matching mechanics move to closed disclosures.
- Loan IDs, recovered/obligation accounting, activity, and addresses move to Detailed or Contract Details.
- Asset preparation for repayment begins only after the customer selects `REPAY NOW`; if more ovrfloWSTETH is needed, the flow states the additional amount and offers conversion without introducing new protocol terminology.
