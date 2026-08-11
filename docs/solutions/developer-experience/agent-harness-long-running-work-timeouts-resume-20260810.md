---
title: Long-running work under an agent harness — timeouts, detachment, and resume choreography
date: 2026-08-10
category: developer-experience
module: agent orchestration (no code module)
problem_type: developer_experience
component: orchestration
severity: high
applies_when:
  - Any agent runs a command expected to exceed ~2 minutes (invariant profiles, mutation campaigns, fuzz runs, fork seeding)
  - A coordinator supervises background agents or detached scripts
  - An agent process dies mid-task (usage limit, stream stall, host restart)
tags: [orchestration, timeouts, background-tasks, resume, watchdog, medusa, foundry]
---

# Long-running work under an agent harness — timeouts, detachment, and resume choreography

## Context

The v1-lite buildout (tickets 01–08, 2026-08) ran dozens of agent sessions over
commands that routinely take 2–10 minutes: the `runs=500/depth=40` invariant
profile (~5 min), Medusa campaigns (~1.5 min per 1M calls), mutation loops, and
Anvil-fork seeding. Three independent failure classes cost real hours before the
countermeasures below became standing practice.

## The lessons

**1. Bash tool calls die silently at the default 120s timeout.** The U6
mutation campaign lost its first hour to invariant runs that were killed at
2 minutes and read as "no output" rather than "truncated". Any command that can
exceed ~2 minutes gets `timeout: 600000` explicitly, or runs with
`run_in_background`. This must be written into the brief of every spawned agent
that will run such commands — tickets 06, 07, and 08 each independently
re-learned it until the brief template carried it.

**2. Detached scripts are invisible to the harness.** An agent that launches a
detached run and "waits" by ending its turn is not waiting — nothing will wake
it. The working pattern is a coordinator alarm-clock: a background timer task
whose completion re-invokes the coordinator, which checks state and resumes or
redispatches. Never rely on an agent noticing time passing.

**3. Silent stream stalls are a distinct death mode, and resume is lossless.**
During ticket 07, implementer agents stalled mid-generation (no failure event,
transcript idle 30+ min) three separate times. Countermeasures, in order:
- A **watchdog loop** (background shell: exit when the agent's transcript mtime
  exceeds ~700s idle) converts silent stalls into coordinator wake-ups.
- **Resume, never restart.** An agent's transcript survives process death;
  resuming it (SendMessage to the stopped agent) preserves its full reading
  state. Restarting from scratch re-pays the entire reading phase. The only
  unresumable agents are user-cancelled ones.
- A truly hung agent that the harness still shows as "running" cannot receive
  queued messages — force-stop it first (TaskStop), then the resume message
  triggers re-entry from the intact transcript.
- On resume, instruct the agent to **bias toward writing durable increments
  over re-reading** — the third stall costs minutes instead of the lane only if
  earlier work landed on disk.

**4. Agents die at usage limits mid-flight; disk state is the only truth.**
When resuming a killed campaign, verify actual file state before believing any
prior status report — the ticket-07 restart found 160 lines of properties on
disk that the last status message said did not exist yet.

## Remediation tier (per the 2026-08-10 hierarchy)

Tier 4 (reviewable): these are process rules in briefs and coordinator
checklists. Tier 1–2 are not available — the harness's timeout defaults and
notification semantics are not ours to redesign; what we control is the brief
template and the coordinator playbook. The watchdog loop is the closest thing
to tier 3 (automated detection) and should be armed by default for any
background agent expected to run more than a few minutes.

## See also

- `.scratch/lending-v1-lite/issues/09-compound-and-codify.md` — orchestration
  lessons (a), (b), (e) that this writeup records durably.
