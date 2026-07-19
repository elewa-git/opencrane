# Agents

OpenCrane treats an agent as a governed product record with a durable run history—not as a pod,
framework session, or mutable folder. This section explains the target agent subsystem and the
boundaries around personality, tools, identity, sandboxed work, and live execution.

> See also: [Architecture](/advanced/architecture) for the whole platform and
> [API overview](/reference/api-overview) for the currently implemented API surface.

::: info Implementation status
The target contracts and architecture are accepted. The new runtime, sandbox-job integration, and
conversation APIs are 🔶 planned for Phases D–F. Pages in this section describe that target and are
labelled so they do not imply that a planned path is already shipped.
:::

## The agent subsystem

```
person or schedule
        │
        ▼
OpenCrane API ──▶ Thread ──▶ AgentRun ──▶ ordered RunEvents ──▶ UI
        │                         │
        │                         ├──▶ bounded AgentLoopDriver ──▶ LiteLLM
        │                         ├──▶ governed MCP call ─────────▶ Obot
        │                         └──▶ sandbox job ────────────────▶ OpenSandbox
        │
        └── owns identity, policy, approvals, transcript, artifacts and recovery
```

The driver, Obot, and OpenSandbox are replaceable execution components. None of them owns the
canonical Thread, Run, event history, approval decision, persona, or artifact.

## Canonical records

| Record | What it means |
|---|---|
| `AgentService` | Stable personal or managed agent identity |
| `AgentRevision` | Immutable prompt, model, skill, MCP, budget and guardrail configuration |
| `PersonaRevision` | Reviewed version of a personal assistant's identity and working style |
| `Thread` / `Message` | Runtime-neutral canonical conversation |
| `AgentRun` | One execution of one immutable revision, including attempts and terminal outcome |
| `RunEvent` | Ordered text, tool, approval, steering, artifact, usage, progress and terminal event |
| `ApprovalRequest` | A decision bound to the exact run, revision, action and arguments digest |
| `ArtifactVersion` | Immutable durable input or output behind `ArtifactStore` |

Kubernetes workloads are projections of these records. Deleting or restarting a pod must not erase
the assistant's identity, transcript, memory, artifacts, or recovery state.

## Explore the boundaries

- [Personality](/integrators/agents/personality) — the onboarding interview, `SOUL.md` template and
  immutable PersonaRevision.
- [MCP calling](/integrators/agents/mcp-calling) — how a model-selected tool call becomes an
  authorised, credential-brokered Obot invocation.
- [Authentication](/integrators/agents/authentication) — human, workload, run and action identity.
- [Sandbox jobs](/integrators/agents/sandbox-jobs) — OpenSandbox's bounded role for untrusted code,
  document and tenant-authored skill execution.
- [Runs & streaming](/integrators/agents/runs-streaming) — live UI updates over the durable canonical
  RunEvent log.

## Invariants

- Prompt text conditions behaviour; it never grants authority.
- Runtimes and sandbox workloads have no Kubernetes mutation RBAC.
- Model-visible tool filtering improves behaviour but is not authorisation.
- The browser never receives a workload, Obot, OpenSandbox, or provider credential.
- Every durable output is an ArtifactVersion; runtime and sandbox filesystems are scratch.
- Every user-visible execution update is a persisted RunEvent before it is streamed.
- A sandbox action can exercise only an expiring subset of the spawning agent's effective rights;
  credentials and ambient authority are never copied into it.
