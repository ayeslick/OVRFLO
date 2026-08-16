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
- Fork commit: `0f77e638e7c7a9251463f35099bc8af5651bdb7e`

## Compiler

Stamped from the fork default Foundry profile (`bytecode_hash = "none"`).
`FOUNDRY_PROFILE=optimized` (via-IR) is not the shipping stamp for this
artifact. Ticket 08 compares rebuilds against this stamp.

- solc: `0.8.23+commit.f704f362`
- optimizer: enabled, runs `1000`
- via_ir: `false`
- EVM: `shanghai`
- bytecode_hash: `none`
- Foundry profile: `default`

## Provenance hashes

Recomputed by `web/scripts/check-ovrflo-stream-bytecode.mjs` from
`artifacts/OVRFLOStream.json`. A mismatch fails the gate.

- Artifact sha256: `5de326865e0ebfbdfc71fb425012a644fe44d8398be3cc10106e26dae7606767`
- ABI sha256: `7220bf29735eddbf496a2ffaf940a018e3885f7b84998b2a623dab9f1c02e169`
- Creation-bytecode sha256: `d1a4100bca52ca6ccf50b28b9b8ba6a2293e43d5176439bb1e6fe59361d93e8f`
- Runtime-bytecode sha256: `8dd5070c4deb8ed5c3ac249fcd14b26c9a5907beb671fa49d1da3012b181a972`

ABI hash is SHA-256 of `JSON.stringify(abi)` (no whitespace) over the
artifact's `abi` array. Bytecode hashes are SHA-256 of the hex-decoded
`bytecode.object` / `deployedBytecode.object` (0x prefix stripped).

## Constructor arguments

`SablierV2LockupLinear(initialAdmin, initialComptroller, initialNFTDescriptor)`

| Arg | Production / seed value |
|---|---|
| `initialAdmin` | OVRFLOFactory address. Never the Safe. Never the deployer. Also stored as immutable `factory`. |
| `initialComptroller` | `SablierV2Comptroller` address from the same deploy sequence |
| `initialNFTDescriptor` | `OVRFLOStreamDescriptor` address from the same deploy sequence |

After deploy, read `admin() == factory` and `factory() == factory`. A wrong
`initialAdmin` is unrecoverable (`Adminable` is one-step).
