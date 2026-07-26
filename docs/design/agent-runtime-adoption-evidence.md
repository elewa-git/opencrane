# Agent-runtime adoption-evidence record (template — UNPOPULATED)

> Status: **TEMPLATE ONLY. Nothing below is adopted.** This record is filled and acted on by the
> named later gate [#337](https://github.com/elewa-git/opencrane/issues/337), under
> [ADR 0010](../adr/0010-language-neutral-agent-runtime.md). Do not treat an empty field as a pass.

## Purpose

ADR 0010 qualifies `pydantic-ai-slim[openai]==2.13.0` as the **first candidate** for the bounded
model/tool loop and states that adoption is recorded **only after** the pinned adapter passes every
protocol, security, reliability, and **live-LiteLLM** conformance gate. The offline conformance
harness and fault-injection matrix (Phase E slice 4 — `apps/agent-runtime/tests/test_conformance.py`,
`apps/agent-runtime/tests/test_fault_matrix.py`, and the attempt-scoped credential rejection proofs in
`libs/backend/agents/execution/runs`) are built and CI-runnable, but they are a **precondition**, not
adoption. The live-LiteLLM leg, this evidence record, and the OpenClaw loop deletion all remain gated
on #337.

This document is the structure #337 must complete. Every field is intentionally blank; #337 fills it
from the passing run and only then flips status to adopted.

## Adoption evidence

| Field | Value | Source of truth |
| --- | --- | --- |
| Package lock (hash-pinned transitive) | _(unpopulated)_ | `pip-compile --generate-hashes` over `apps/agent-runtime/deploy/requirements.txt` |
| Image digest | _(unpopulated)_ | `apps/agent-runtime/deploy/Dockerfile` base + built `@sha256:…` |
| Protocol version | _(unpopulated)_ | `AGENT_RUNTIME_PROTOCOL_V1` in `@opencrane/contracts` |
| Supported model matrix | _(unpopulated)_ | live-LiteLLM conformance run over the per-silo proxy |
| Upgrade / drain rules | _(unpopulated)_ | #337 rollout note |

## Gate checklist (all must be evidenced by #337 before adoption)

- [ ] Offline conformance harness green in CI (precondition — slice 4).
- [ ] Offline fault-injection matrix green in CI (precondition — slice 4).
- [ ] Attempt-scoped credential rejection proofs green in CI (precondition — slice 4).
- [ ] Live-LiteLLM conformance leg green against the real proxy (`OPENCRANE_RUNTIME_LIVE_CONFORMANCE=1`).
- [ ] Hash-pinned package lock resolved and recorded above.
- [ ] Base-image digest pinned and recorded above.
- [ ] Supported model matrix recorded above.
- [ ] Upgrade/drain rules recorded above.
- [ ] OpenClaw loop deletion executed (only after the above) — the #337 deletion gate.

## See also

- [ADR 0010 — Language-neutral agent runtime](../adr/0010-language-neutral-agent-runtime.md)
- [#337 — conformance adoption + OpenClaw deletion gate](https://github.com/elewa-git/opencrane/issues/337)
- [#246 — Phase E runtime boundary](https://github.com/elewa-git/opencrane/issues/246)
