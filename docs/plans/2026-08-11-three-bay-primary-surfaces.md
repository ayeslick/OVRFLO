# OVRFLO Three-Bay Primary Surfaces — Exploration Set

The locked Three-Bay Instrument Workbench has been extended across the three remaining primary routes:

- Borrow: `.impeccable/mocks/ovrflo-three-bay-borrow.webp`
- Supply: `.impeccable/mocks/ovrflo-three-bay-supply.webp`
- Positions: `.impeccable/mocks/ovrflo-three-bay-positions.webp`
- Locked Assets reference: `.impeccable/mocks/ovrflo-three-bay-instrument-workbench-approved.webp`

These companion screens are exploration comps, not yet marked approved.

## Shared system

- Left bay establishes the asset, stream, or position context.
- Center bay contains the current financial decision or selected position state.
- Right bay states the immediate outcome or next valid action.
- The lower dock carries transaction steps and a literal permission/action receipt.
- Closed rows hold mechanics that do not change the immediate decision.
- Amber marks the active operation; cyan is reserved for contextual navigation.

## Contract-literal behavior

- Borrow fees are deducted from proceeds. No fee-token approval is requested.
- Borrowing may require approval for the selected Sablier stream.
- Supply uses an exact wstETH allowance and has no protocol fee.
- Unmatched supply remains withdrawable; matched value becomes claimable as its loans repay.
- Repay pulls ovrfloWSTETH.
- Closing is permissionless once the stream's withdrawable value covers the obligation, and returns the stream with residual value.
- Lender claims are paid in ovrfloWSTETH.
