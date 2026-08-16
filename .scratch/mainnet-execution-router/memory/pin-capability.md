# Pin capability probe

Ticket 11. Deployless `eth_call` with creation `code` + calldata, pinned to a **known past** block via EIP-1898 `{blockHash, requireCanonical: true}`. The probe contract returns `block.number`. Supported means the returned height equals the pinned height. A block-independent probe is not this probe.

Recorded: 2026-08-16T05:03:05.850Z
Env file: present (path omitted)
CREATE2 flip: not in this ticket. This record says whether the production primitive works.

| Provider role | EIP-1898 hash pin supported | Notes |
|---|---|---|
| primary (127.0.0.1:8545) | yes | past block 25758712 returned 25758712 |
| fallback-0 (localhost:8545) | yes | past block 25758712 returned 25758712 |
| historical (127.0.0.1:8545) | yes | past block 25758712 returned 25758712 |
