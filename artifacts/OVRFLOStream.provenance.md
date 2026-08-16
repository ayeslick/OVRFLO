# OVRFLOStream artifact provenance

**License of this object code:** GPL-3.0-or-later.

This file is bytecode of `SablierV2LockupLinear` from the OVRFLO Streams fork.
The Solidity name stays `SablierV2LockupLinear`. The deployed ERC721 identity is
`OVRFLO Stream` / `Stream`.

The surrounding MIT sources in this repository call the deployment by address.
Those MIT sources are not a derivative of this object code.

## Corresponding Source

- Repository: OVRFLO-Streams (fork of sablier-labs/v2-core `v1.1.2`)
- Upstream tag: `v1.1.2`
- Fork commit: `8ff0c3203bfb0ad76c577f114d9b39f958e9fd02`

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

- Artifact sha256: `c73a3cc9069e1a44bc1b854f0629f096ae344b03bc9228086dd1dfa8195c18e8`
- ABI sha256: `7220bf29735eddbf496a2ffaf940a018e3885f7b84998b2a623dab9f1c02e169`
- Creation-bytecode sha256: `b44485582000aabfdbed9042a5e0190bcb072fb4d4401fd6f9dfc9caa4145eae`
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
