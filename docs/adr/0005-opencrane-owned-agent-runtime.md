# ADR 0005 — OpenCrane-owned agent runtime

- **Status:** Accepted
- **Date:** 2026-07-16
- **Task:** `#245` — Phase A decision record
- **Supersedes / superseded by:** supersedes the 2026-06-19 decision to retain OpenClaw as the
  platform runtime
- **Related:** [ADR 0006](0006-rewrite-freeze-whole-silo-cutover.md) ·
  [`personal-agent-platform-architecture.md`](../design/personal-agent-platform-architecture.md) ·
  [`openclaw-agent-loop-replacement-plan.md`](../design/openclaw-agent-loop-replacement-plan.md)

## Context

The 2026-06-19 direction retained OpenClaw because it already supplied the personal-agent gateway,
session, transcript, compaction, tool-loop, workspace, channel, and plugin behavior. The product
roadmap has since pivoted: a person's assistant is the primary product and the front door to company
agents, artifacts, memory, skills, approvals, schedules, and tools.

OpenCrane already owns, or must own, the surrounding authority: OIDC and channel ingress, tenant and
run identity, authorization, transcript/event durability, persona, memory policy, MCP grants,
artifacts, skills, budgets, scheduling, workload isolation, approvals, retry, and audit. Keeping
OpenClaw as a permanent peer would preserve two runtime contracts, two transcript/session models,
and a large translation surface.

The trigger for revisiting the June decision has therefore fired: **roadmap divergence caused by the
personal-agent product pivot**.

## Decision

OpenCrane will own the personal and managed-agent runtime end to end:

- OpenCrane owns canonical `Thread`, `Message`, `Run`, ordered `RunEvent`, approval, transcript,
  context/compaction, retry, cancellation, budgets, identity, memory, and tool policy.
- One exact-pinned TypeScript toolkit drives only the bounded model/tool loop behind an
  OpenCrane-owned `AgentLoopDriver` contract.
- Python remains available for isolated authoring/tool Jobs; it is not a second conversational
  runtime.
- The green runtime contains no OpenClaw package, protocol, config renderer, transcript mirror,
  workspace compatibility, plugin hook, or reverse bridge.
- The frozen OpenClaw image is a behavioral oracle and blue rollback artifact, not a green runtime
  dependency.

The TypeScript toolkit is deliberately **not** selected by this ADR. Gate L4 runs
`@openai/agents` and `ai`/`ToolLoopAgent` against the same frozen trajectories and real LiteLLM
matrix. It records one winner and exact dependency pins; the losing production adapter is removed.

## Alternatives considered

- **Retain a lean OpenClaw runtime permanently** — rejected. It shortens the runtime build but keeps
  the config/protocol/plugin/workspace/session compatibility tax indefinitely.
- **Run OpenClaw and an owned toolkit as permanent peers** — rejected. It creates two authorities
  and two operating matrices instead of completing the cutover.
- **Embed a second loop inside OpenClaw** — rejected. It adds a loop without removing the larger
  OpenClaw runtime shell.
- **Select a toolkit in the architecture ADR** — rejected. Provider, approval-resume,
  cancellation, retry, event, and telemetry behavior must be measured by Gate L4.

## Consequences

- OpenCrane assumes production responsibility for session correctness, reconnect, cancellation,
  compaction, recovery, approval resume, and run persistence.
- Gate L0 must preserve the exact pinned blue behavior as deterministic fixtures before green
  replacement work relies on it.
- CI forbids OpenClaw and retired-domain imports in green from the first green PR.
- After each silo's cutover and retention window, the OpenClaw installer, runtime, protocol,
  workspace, pairing/device, and transcript compatibility surface is deleted rather than deprecated.
