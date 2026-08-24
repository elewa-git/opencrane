# agent-runtime — the isolated personal-agent process

> [apps](../README.md) › agent-runtime

<!-- No import alias: this Python application is a deployable process, not an importable package. -->

## What it owns

The agent runtime is the process in which one personal-agent attempt will eventually execute. It
runs inside the customer's dedicated runtime Kubernetes namespace, opens its own authenticated
connection to OpenCrane in the separate server namespace, and never accepts inbound network traffic.

The agent controller creates the fresh, initially suspended Job from durable run authority, releases
the exact assigned Job, and registers its first Pod. This process then binds its per-run public proof
key with a one-use bootstrap exchange, opens its command stream, and executes each `start_attempt`
command as a bounded Pydantic AI model/tool loop over the per-silo LiteLLM proxy, reporting normalized
candidates as the attempt runs. A model tool call is surfaced as a bounded `external_action`
candidate for the control plane to authorize — the runtime never executes an external tool. It also
handles `resume_attempt` (the control plane returns exact saved tool results, which the runtime maps
back to pending calls before feeding them into the paused loop) and `cancel_attempt` (a positive signal that kills the active task while the server retains the
canonical cancellation outcome), absorbs steering only at pre-model-request boundaries, and writes an encrypted,
version-tagged, replaceable local checkpoint subordinate to canonical server state.

```text
 durable run attempt
        │  controller creates and assigns the suspended Job
        ▼
 ┌──────────────────────────────┐
 │  agent-runtime  ◄── HERE      │  bootstrap exchange + outbound stream + bounded model loop
 └──────────────┬───────────────┘
                │ event + external_action candidates (approval + receipts stay server-side)
                ▼
 OpenCrane server authority ── external calls execute once and saved results return on resume
```

**In this flow:** [OpenCrane server](../opencrane/README.md) ·
[runtime resource builder](../../libs/backend/agents/runtime/k8s-launcher/README.md) ·
[runtime stream](../../libs/backend/server/infra/agent-runtime-stream/README.md)

Invariant: this process cannot choose its user, agent revision, run, tools, permissions, or durable
state. A failed or retried attempt receives a different Job identity, and runtime-local files
disappear with its bounded scratch volume. If identity or server authority is unavailable, the
process reconnects with bounded backoff and does no work. The runtime namespace may never collapse
into the OpenCrane server namespace.

## Public surface

`Entrypoint: src/runtime.py` is a thin composition root. It loads the process settings, binds
per-run public proof-key evidence, completes the one-use bootstrap, and maintains the outbound
command stream. Five focused components collaborate beneath it:

```text
runtime.py
├── bootstrap ───────────────► transport/http
└── transport/stream ────────► attempts
                                ├── model_loop
                                └── protocol
```

`src/bootstrap/` owns proof binding, `src/transport/` owns control-plane I/O, `src/attempts/` executes
commands and validates returned results, `src/model_loop/` adapts the bounded model loop, and `src/protocol/` projects stable
candidates. The [source architecture](src/README.md) follows the complete runtime sequence and
records the dependency, authority, retry, cancellation, and checkpoint rules in one place.

`Development entrypoint: src/development_runtime.py` keeps that bootstrap and stream composition but
selects either the unchanged LiteLLM handlers or a deterministic neutral-event strategy. Production
container commands continue to run `src.runtime` and never import development code.

The stream rejects any individual response line above 64 KiB and executes each `start_attempt`
command as a bounded Pydantic AI model/tool loop. The loop reaches the LiteLLM proxy only through an
attempt-scoped virtual key mounted as a group-readable Secret, performs zero implicit retries, and is
driven with `agent.iter()` and per-node `node.stream(run.ctx)` calls (never the `run_stream()`
final-output shortcut).
Raw framework events are normalized into stable protocol candidates while the attempt is active:
output text becomes a canonical message start/delta/end lifecycle; usage and credential-free error
classification become bounded `event` candidates; and a model tool call first reports
`tool.requested` before becoming a bounded `external_action` candidate whose `toolRevisionId` is resolved from the compiled grant set
and whose `argumentsDigest` is a deterministic `sha256:<hex>` the control plane re-derives. A neutral
adapter may also emit one `elicitation_request`. The runtime accepts only bounded `runtime_input` or
reviewed `a2ui_action` shapes, computes the protected-payload digest itself, and pauses after posting
the candidate. The server chooses the participant, durable request id, and absolute expiry. Pydantic
AI types, ids, and checkpoints never cross that seam. Resume delivers saved server-owned tool
results (`{toolInvocationId, outcome, result|failureCode}`) plus exact terminal elicitation results
(`{requestId, requestKey, outcome, response?}`). The runtime maps each tool result back to its
recorded pending call and gives the model only validated elicitation content. Protected A2UI answers
return as a terminal marker without response content. It has no provider credential and cannot
repeat the external action after a reconnect. A neutral adapter may also supply a complete versioned A2UI
envelope for one of the three canonical A2UI event types; the default Pydantic adapter emits none and
the runtime never invents UI shapes. Cancel is a positive signal that suppresses any late candidate; steering is
absorbed only at the safe pre-model-request boundary. Any executor failure surfaces as a real
`run.failed` terminal report rather than a silent acknowledgement, and a dropped stream bounds further
candidate emission. Non-terminal candidates are delivered once; in particular, an ambiguous
external-action delivery is never repeated by the runtime. A terminal candidate may replay unchanged
after an ambiguous network loss because the server may already have persisted it; an explicit HTTP
refusal is never retried.

## Boundary

The process has no listener, Service, Ingress, Kubernetes role-based access control (RBAC), model
provider credential, tool implementation, artifact credential, database client, or persistent tenant
mount. It does not decide which run it may execute; OpenCrane validates the exact Job, Pod,
ServiceAccount, attempt, and revision before admitting work.

It also has no static Helm workload. Installing one shared Deployment would blur user and attempt
identity, so the image may run only as the fresh Job contract defined by this slice. Durable memory
or artifacts must cross an authenticated OpenCrane service boundary rather than remaining inside the
runtime.

## Dependency direction

Tagged `type:app`, `layer:entrypoint`, and `scope:agent-runtime`. It is a deployable process at the top
of the dependency graph; libraries do not import it. The wire contract is owned by
`@opencrane/contracts`, and the server-side transport is owned by `libs/backend/server/infra`.

## Runtime & config

- `OPENCRANE_RUNTIME_STREAM_URL` — exact in-cluster OpenCrane base endpoint; the process appends
  `/bootstrap`, `/stream`, and `/candidates`.
- `OPENCRANE_RUNTIME_TOKEN_PATH` — rotating audience-bound projected-token path.
- `OPENCRANE_RUNTIME_BOOTSTRAP_PATH` — path of the projected bootstrap-reference file (defaults to
  `/var/run/opencrane/bootstrap/reference`).
- `POD_UID` — immutable Pod identity supplied through the Kubernetes downward API.
- `OPENCRANE_RUNTIME_LITELLM_BASE_URL` — in-cluster LiteLLM proxy base URL the bounded loop calls.
- `OPENCRANE_RUNTIME_LITELLM_KEY_PATH` — path of the mounted attempt-scoped LiteLLM key (defaults to
  `/var/run/opencrane/litellm/key`).
- `OPENCRANE_RUNTIME_CHECKPOINT_DIR` — directory for the encrypted local resume checkpoint (defaults
  to `/tmp/opencrane/checkpoints`).
- `/var/run/opencrane/bootstrap/reference` — read-only opaque lookup reference projected from the
  Pod annotation. It is not a credential and is never placed in an environment variable or argument.
- `/var/run/opencrane/litellm/key` — the attempt-scoped LiteLLM virtual key, projected as a
  group-readable (`0440`) Secret volume. It is never the master key, never a provider secret, and
  never a plaintext environment variable.
- `/tmp/opencrane/checkpoints/checkpoint.enc` — the replaceable encrypted local checkpoint. It is a
  subordinate optimisation only, never durable state and never a source of truth.
- Writable storage is only a per-attempt `emptyDir` capped at 1 GiB and mounted at `/tmp`.
- Third-party dependencies are `cryptography` (P-256 proof-key generation),
  `pydantic-ai-slim[openai]` (the bounded model/tool loop), and the direct `openai` client used only
  to stream attempt-scoped generated files from the provider container. All three are pinned in
  `deploy/requirements.txt`; the standard library covers everything else.

The Job builder requires an immutable image digest plus bounded CPU, memory, deadline, and scratch.
The container runs as numeric user and group `65532` with a read-only root filesystem. Its projected
credential is group-readable (`0440`) only by that runtime group; it is never world-readable.

## Status

The current image proves identity, the one-use bootstrap exchange, durable command dispatch, and a
bounded model/tool loop: it binds its proof key, receives its fenced `start_attempt`,
`resume_attempt`, and `cancel_attempt` commands with its control-plane-compiled literal input, and
completes a real agent run over LiteLLM through an attempt-scoped key. It surfaces model tool calls as
`external_action` candidates for server-side authorization, consumes exact saved tool results from
the control plane without any direct provider credential, kills the active task on a positive cancel signal, absorbs steering at pre-model-request
boundaries, and writes an encrypted, version-tagged, replaceable local checkpoint subordinate to
canonical server state. The controller creates or exact-adopts the suspended Job, releases the durable
assignment, and registers the unique first Pod. The offline conformance harness and fault-injection
matrix (`tests/test_conformance.py`, `tests/test_fault_matrix.py`) are built and CI-runnable. The
same conformance contract is used for live LiteLLM qualification.

## See also

- Parent index: [apps](../README.md)
- Source architecture: [agent runtime source](src/README.md)
- Server transport: [agent-runtime-stream](../../libs/backend/server/infra/agent-runtime-stream/README.md)
- Per-attempt resources: [runtime/k8s-launcher](../../libs/backend/agents/runtime/k8s-launcher/README.md)
- Runtime protocol: [contracts](../../libs/contracts/README.md)
- Deployment composer: [deploy-k8s](../_infra/deploy-k8s/README.md)
