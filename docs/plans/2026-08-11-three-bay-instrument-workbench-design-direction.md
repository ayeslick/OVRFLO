# OVRFLO Three-Bay Instrument Workbench — Locked Converter Direction

## Approved reference

The asset converter is locked to the **Three-Bay Instrument Workbench** shown in:

`.impeccable/mocks/ovrflo-three-bay-instrument-workbench-approved.webp`

The approved reference is the visual source of truth for this surface. Implementation should reproduce its composition rather than translate it into the Folio Timefield layout.

## Structure

The three bays remain visible together because each answers a different question:

- **Left — reserve:** the user's wstETH balance, tracked wrap reserve, and reserve-limited unwrap rule.
- **Center — conversion:** Wrap/Unwrap mode, amount, deterministic output, 1:1 rate, protocol-fee status, stream status, approval receipt, and the active transaction step.
- **Right — claim:** the user's ovrfloWSTETH balance and its relationship to eligible PT after maturity.

The lower disclosure rows hold reserve mechanics and contract details. `USE FOR REPAY` preserves the position-management return path without overloading the converter itself.

## Contract-literal language

- Exact symbol: `ovrfloWSTETH`.
- `ovrfloWSTETH` represents an equal claim on eligible PT after maturity. It is not described as a claim on wstETH.
- Wrapping exchanges wstETH for ovrfloWSTETH 1:1, adds the received wstETH to the tracked wrap reserve, charges no protocol fee, and creates no stream.
- Unwrapping exchanges ovrfloWSTETH for wstETH 1:1 only while the tracked wrap reserve covers the amount.
- Wrapping may require an exact wstETH approval. Unwrapping requires no token approval.
- Because output is deterministic, the field is labeled `OUTPUT`, not `OUTPUT (EST.)`.

## Visual invariants

- Black-and-white one-bit instrument language with amber as the active-operation color and cyan reserved for contextual return navigation.
- Three-bay geometry, hard rules, bitmap texture, square controls, and tabular readouts remain intact.
- Job steps and permission receipt remain visible during the transaction flow.
- No gradients, soft cards, glass, rounded dashboard components, decorative shadows, or added color system.
- No generic `ovrfloToken`, `OVRFLO TOKEN`, or incorrect underlying-wstETH claim language.
