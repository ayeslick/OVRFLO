# Browser RPC failure and credential forward-roll

Browser RPC identifiers are public. Production restricts them by exact browser
origins, Ethereum mainnet scope, quotas/caps, and alerts; it never describes
them as secrets.

## Failure classes

| Class | Signal | Discovery response |
|---|---|---|
| Forbidden | HTTP 403 or equivalent | Disable the affected scope; verify origin/network restrictions |
| Rate limited | HTTP 429 or equivalent | Retry the same range using provider timing; do not switch chunks |
| Quota exhausted | Provider quota/CU exhaustion | Disable the affected scope and start credential forward-roll |
| Revoked credential | Explicit revoked/disabled/invalid-key response | Disable the affected scope and start credential forward-roll |
| Historical capability | Range, response-size, archive, or finalized capability failure | Fail the capability probe; never report empty history |
| Execution reverted | EVM execution revert | Return the revert immediately; never replay it on an ordinary-read fallback |
| Transport unavailable | Network, timeout, connection, or gateway failure | Ordinary reads may use the next configured fallback; an active discovery synchronization does not |

## Forward-roll procedure

1. Freeze the affected synchronization checkpoint. Do not advance it and do not
   treat any completed prefix as an empty or complete result.
2. Create or select a replacement browser key/provider with Ethereum mainnet,
   exact preview/production origin allowlists, caps, and alerts.
3. Run the deployment-to-finalized capability probe on that one transport.
   Record provider tier/region, the verified factory anchor, captured
   finalized/latest numbers and hashes, request/byte/duration totals, and the
   redacted transport identity.
4. Build a new immutable frontend artifact with the replacement configuration.
   A credential incident is not repaired by rolling back an older artifact.
5. Start a new synchronization snapshot from the verified deployment anchor.
   Never continue remaining chunks on the replacement transport.
6. Re-run denied-origin, approved-origin, CSP, wallet, and discovery checks,
   then promote that exact prebuilt artifact.

Evidence and telemetry may contain provider name plus a SHA-256 digest of the
origin. They must not contain API keys, authorization headers, query strings,
full RPC URLs, wallet identities, or raw error payloads that echo credentials.
