# SablierV2Comptroller artifact provenance

**License of this object code:** GPL-3.0-or-later.

This file is bytecode of `SablierV2Comptroller` from the OVRFLO Streams fork.
The Solidity name stays `SablierV2Comptroller`.

The surrounding MIT sources in this repository call the deployment by address.
Those MIT sources are not a derivative of this object code.

## Corresponding Source

- Repository: OVRFLO-Streams (fork of sablier-labs/v2-core `v1.1.2`)
- Upstream tag: `v1.1.2`
- Fork commit: `98a198d64bb21b2633fcfdeb58a82613189f718e`

## Compiler

Stamped from the fork default Foundry profile (`bytecode_hash = "none"`).
See `OVRFLOStream.provenance.md` for the optimized-profile note.

- solc 0.8.23
- optimizer: true, runs 1000
- via_ir: false
- EVM: paris

## Constructor arguments

`SablierV2Comptroller(initialAdmin)`

| Arg | Production / seed value |
|---|---|
| `initialAdmin` | OVRFLOFactory address. Never the Safe. Never the deployer. |

Fees are zero at deploy. After deploy, read `admin() == factory`. A wrong
`initialAdmin` is unrecoverable (`Adminable` is one-step). The factory has no
forwarder for `transferAdmin`, `setProtocolFee`, `setFlashFee`, or
`toggleFlashAsset`.
