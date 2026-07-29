---
title: The RPC API key is exposed in Anvil's process arguments
date: 2026-07-29
category: security-issues
module: tools/scripts/bootstrap-local.sh, .gitignore
problem_type: security_issue
component: tooling
symptoms:
  - "`ps -eo args` shows the full provider URL, API key included, for any local process to read"
  - "The key appears in shell history, CI logs, and agent transcripts"
  - "Sibling and nested .env files (.env.local, tools/ponder/.env) were not gitignored"
root_cause: incomplete_setup
resolution_type: config_change
severity: medium
tags: [secrets, api-key, anvil, fork, gitignore, process-arguments, rotation]
---

# The RPC API key is exposed in Anvil's process arguments

## Problem

The local development fork is started with the provider URL as a command-line
flag (`tools/scripts/bootstrap-local.sh:61`):

```bash
anvil --fork-url "$MAINNET_RPC_URL" --chain-id 1
```

`MAINNET_RPC_URL` carries an embedded API key. Process command lines are
readable by **any** process on the host, so for as long as the fork runs, the
key is available to anything that can call `ps`.

## Symptoms

Verified live on this machine while a fork was running (value redacted here):

```
$ ps -eo args | grep fork-url
anvil --fork-url https://eth-mainnet.g.alchemy.com/<REDACTED>
```

The same value also lands in shell history, in any CI job log that echoes the
command, and — as happened during this work — in an agent session transcript.

## What Didn't Work

- **Assuming a gitignored `.env` was sufficient.** It protects the *repository*.
  It does nothing about `argv`, history, logs, or transcripts, which are
  entirely separate exposure channels.
- **The pre-existing ignore rules.** A single root `.env` entry left real gaps:
  sibling variants such as `.env.local` and `.env.production`, and any `.env`
  created at depth under `tools/` or `script/`, were not covered — only `web/`
  had a wildcard. None of those files existed yet, which is precisely why the
  gap was invisible: the first one created would have been committable.

## Solution

Two parts, one of which is not code.

**Close the repository channel properly.** `.gitignore` now covers the variants
and depths, with explicit negations so templates still ship:

```gitignore
.env
.env.*
!.env.example
**/.env
**/.env.*
!**/.env.example
*.key
*.pem
*.p12
*.keystore
.config/
```

**Rotate the key.** Once a secret has been on a command line, it must be treated
as disclosed — there is no way to retract it from the histories, logs, and
transcripts it has already reached. Rotation is a provider-dashboard action and
is recorded as a maintainer step (R34).

The durable improvement is to keep the value out of `argv` at all: check
whether the tool accepts the endpoint through an environment variable or a
config file rather than a flag, and prefer that form. Environment variables are
not perfectly private either — `/proc/<pid>/environ` is readable by the same
user — but they are not world-readable the way `argv` is on a shared host, and
they do not land in shell history.

## Why This Works

Secrets leak through **channels**, and closing one says nothing about the
others. The channels here are at least five:

| Channel | Closed by |
|---|---|
| Repository | `.gitignore` (now covers variants and depth) |
| Process table (`argv`) | keeping the value out of flags — otherwise unavoidable |
| Shell history | not invoking the value inline |
| CI / build logs | not echoing the command |
| Agent transcripts | redaction at the point of display |

A gitignore rule is often mistaken for "the secret is handled," because it is
the only one of these with a visible artifact in the repo. It is the channel
that matters least for a key that is passed on a command line every time the
dev environment starts.

The severity is bounded here — a read-only archive-node key, rate-limited and
replaceable — which is exactly why it is worth documenting rather than
panicking about. The mechanism generalizes to keys that are not bounded, and
the habit is what transfers: **ask which channels a secret traverses, not
whether it is in git.**

## Prevention

- Never pass a secret-bearing URL as a command-line argument when the tool
  offers an environment or config-file path.
- Treat any secret that has appeared in `argv`, history, a log, or a transcript
  as disclosed, and rotate it. "It was only local" is not a mitigation.
- Keep `.gitignore` negations (`!**/.env.example`) alongside the broad rules, so
  hardening the ignore does not silently stop shipping the templates.
- When redacting for display, redact at the **path boundary** — the key is the
  path segment, so truncating the host alone leaks nothing but truncating the
  query alone may leak everything.

## Related Issues

- [The agent instruction files are gitignored](../developer-experience/agent-instruction-files-are-gitignored-check-tracking-first.md) — the same `.gitignore` surprising in the opposite direction
- [Fail the build on missing security config](../best-practices/fail-the-build-on-missing-security-config.md) — the other build/deploy-time secret-and-origin handling in this app
- [Anvil forge script broadcast out of funds](../integration-issues/anvil-forge-script-broadcast-out-of-funds-LocalSeeding-20260421.md) — the local-fork bootstrap this script belongs to
