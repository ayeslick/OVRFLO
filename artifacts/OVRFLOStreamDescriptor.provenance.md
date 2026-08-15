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
- Fork commit: `98a198d64bb21b2633fcfdeb58a82613189f718e`

## Compiler

Stamped from the fork default Foundry profile (`bytecode_hash = "none"`).
See `OVRFLOStream.provenance.md` for the optimized-profile note.

- solc 0.8.23
- optimizer: true, runs 1000
- via_ir: false
- EVM: paris

## Constructor arguments

`OVRFLOStreamDescriptor()` — no constructor arguments. The descriptor has no
admin. The factory owner sets it on the lockup through
`OVRFLOFactory.setStreamNFTDescriptor` after `setOvrfloStream`.
