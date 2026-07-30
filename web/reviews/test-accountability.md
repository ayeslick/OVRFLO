# Test accountability

## 2026-07-30 — U1 fail-closed runtime and anchors

Owner: Codex U1 implementation

- `tests/lib/config.test.ts`: removed expectations that production silently
  accepts a zero factory, missing RPC, and placeholder Reown ID. The replacement
  assertions enforce the R1 fail-closed production contract while retaining an
  explicit local profile that Vercel production rejects.
- `tests/hooks/useWriteFlow.test.tsx`: changed the caller-chain assertion from
  preserving `chainId: 999` to enforcing configured chain ID 1. The former
  expectation pinned the exact R4 override vulnerability.
- Added deployment, RPC, CSP/prebuilt packaging, error-boundary, and prerender
  guard coverage. No existing safe assertion was relaxed or removed.
