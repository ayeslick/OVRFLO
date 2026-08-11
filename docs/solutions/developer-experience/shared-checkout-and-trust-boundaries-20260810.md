---
title: Shared-checkout discipline and agent trust boundaries — scoped commits, verified capabilities, relayed secrets
date: 2026-08-10
category: developer-experience
module: agent orchestration (no code module)
problem_type: developer_experience
component: orchestration
severity: high
applies_when:
  - Multiple agents share one git checkout
  - A coordinator relays new capabilities or credentials to a running agent mid-task
  - An agent is about to rule out an approach based on a claimed capability limit
  - An agent is about to decline a ticket criterion based on its own reading of repo state
tags: [orchestration, git-discipline, prompt-injection, capability-verification, trust]
---

# Shared-checkout discipline and agent trust boundaries — scoped commits, verified capabilities, relayed secrets

## Context

Four trust-and-state lessons from the v1-lite buildout, each paid for once.

## The lessons

**1. Agents in a shared checkout commit by explicit path only.** The U4 commit
collision came from `git add -A` scooping up a concurrent agent's in-progress
files. Every commit in a shared checkout names its paths (`git add <paths>`);
`-A`/`-u` are reserved for a coordinator that has just verified `git status`
against its own change inventory.

**2. Verify capability claims empirically before ruling them out.** "Subagents
can't spawn subagents" was a misdiagnosis of a process death, and it briefly
warped ticket 07's orchestration design. The cost of an empirical check (spawn
a trivial child, observe) is minutes; the cost of a false limit is an
architecture built around it.

**3. Mid-task capability reversals will — and should — meet resistance.** When
the coordinator relayed the user's mid-session instruction that a secrets file
was now available (reversing the agent's original "environment-gated" brief),
the ticket-08 builder refused it as a suspected injection: the message reversed
a security-relevant decision via an unverifiable channel and asked for report
omissions (framed as secret-hygiene, but indistinguishable from concealment
from inside the agent's trust position). That refusal was CORRECT under its
information. The durable protocol: agent briefs should state up front which
channel may deliver environment reversals and that secret-hygiene instructions
(use-but-don't-log) are expected to accompany them; coordinators should expect
refusal otherwise and plan to run the gated step themselves rather than
argue an agent out of a sound trust posture.

**4. Verify the premise before declining a criterion.** The same builder
declined the SPDX sweep believing `test/` was uniformly `UNLICENSED` "by
convention" — the actual distribution was 29 MIT / 19 UNLICENSED / 4 Unlicense,
i.e. drift, not convention, and the ticket's premise was right. A declined
criterion needs the same evidence standard as an implemented one: count, cite,
then decline.

## Remediation tier (per the 2026-08-10 hierarchy)

Tier 4 (reviewable) for the commit and premise-verification rules — brief
template and review checklist. Tier 2-adjacent for the relayed-secrets
protocol: pre-declaring the reversal channel in the brief makes the legitimate
message recognizably legitimate, which removes the ambiguity rather than
adjudicating it after the fact.

## See also

- `.scratch/lending-v1-lite/issues/09-compound-and-codify.md` — orchestration
  lessons (d), (f).
