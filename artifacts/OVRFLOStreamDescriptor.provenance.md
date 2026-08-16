# OVRFLOStreamDescriptor artifact provenance

**License of this object code:** GPL-3.0-or-later.

This file is bytecode of `OVRFLOStreamDescriptor` from the OVRFLO Streams fork.
This is the one contract in the fork with an OVRFLO Solidity name.

The surrounding MIT sources in this repository call the deployment by address.
Those MIT sources are not a derivative of this object code.

U3 golden SVG/JSON fixtures that this descriptor paints live in
`artifacts/goldens/ovrflo-stream-descriptor/` (ticket 09 parses them).

## Corresponding Source

- Repository: OVRFLO-Streams (fork of sablier-labs/v2-core `v1.1.2`)
- Upstream tag: `v1.1.2`
- Fork commit: `0f77e638e7c7a9251463f35099bc8af5651bdb7e`

## Compiler

Stamped from the fork default Foundry profile (`bytecode_hash = "none"`).
See `OVRFLOStream.provenance.md` for the shipping-profile note.

- solc: `0.8.23+commit.f704f362`
- optimizer: enabled, runs `1000`
- via_ir: `false`
- EVM: `shanghai`
- bytecode_hash: `none`
- Foundry profile: `default`

## Provenance hashes

- Artifact sha256: `757d581a01f37603d3064c567e5b32333b782928d784667b0472747a13ebebdc`
- ABI sha256: `e5f9b6f5b5fa99041055d265aff1ca5a91e759eefbd73e4a73193110a2df7d17`
- Creation-bytecode sha256: `f05b45e10fdc59a861e7122a02a92d4970d758eea373b8d0d7e518e59734aeed`
- Runtime-bytecode sha256: `aeb9be16ebe61f677cf17001d143fe3f1585099f0ca0d590b605267d09a991ea`

## Constructor arguments

`OVRFLOStreamDescriptor()` — no constructor arguments. The descriptor has no
admin. The factory owner sets it on the lockup through
`OVRFLOFactory.setStreamNFTDescriptor` after `setOvrfloStream`.
