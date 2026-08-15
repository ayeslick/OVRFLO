# OVRFLOStream artifact provenance

**License of this object code:** GPL-3.0-or-later.

This file is bytecode of `SablierV2LockupLinear` from the OVRFLO Streams fork.
The Solidity name stays `SablierV2LockupLinear`. The deployed ERC721 identity is
`OVRFLO Stream` / `OVRFLOStream`.

The surrounding MIT sources in this repository call the deployment by address.
Those MIT sources are not a derivative of this object code.

## Corresponding Source

- Repository: OVRFLO-Streams (fork of sablier-labs/v2-core `v1.1.2`)
- Upstream tag: `v1.1.2`
- Fork commit: `98a198d64bb21b2633fcfdeb58a82613189f718e`

## Compiler

Stamped from the fork default Foundry profile (`bytecode_hash = "none"`).
`FOUNDRY_PROFILE=optimized` (via-IR) failed to compile this commit
(Yul stack-too-deep in the descriptor). Ticket 08 compares rebuilds against
this stamp.

- solc 0.8.23
- optimizer: true, runs 1000
- via_ir: false
- EVM: paris (fork `foundry.toml` `emv_version` typo is unused; solc default)

## Constructor arguments

`SablierV2LockupLinear(initialAdmin, initialComptroller, initialNFTDescriptor)`

| Arg | Production / seed value |
|---|---|
| `initialAdmin` | OVRFLOFactory address. Never the Safe. Never the deployer. Also stored as immutable `factory`. |
| `initialComptroller` | `SablierV2Comptroller` address from the same deploy sequence |
| `initialNFTDescriptor` | `OVRFLOStreamDescriptor` address from the same deploy sequence |

After deploy, read `admin() == factory` and `factory() == factory`. A wrong
`initialAdmin` is unrecoverable (`Adminable` is one-step).
