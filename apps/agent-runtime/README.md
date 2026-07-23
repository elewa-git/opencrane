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
candidate for the control plane to authorize — the runtime never executes the tool itself. It also
handles `resume_attempt` (feeding control-plane-authorized deferred tool results back into the paused
loop) and `cancel_attempt` (a positive signal that kills the active task and acknowledges the
server-chosen reason), absorbs steering only at pre-model-request boundaries, and writes an encrypted,
version-tagged, replaceable local checkpoint subordinate to canonical server state.

```text
 durable run attempt
        │  controller creates and assigns the suspended Job
        ▼
 ┌──────────────────────────────┐
 │  agent-runtime  ◄── HERE      │  bootstrap exchange + outbound stream + bounded model loop
 └──────────────┬───────────────┘
                │ event + external_action candidates (tool execution stays server-side authority)
                ▼
 OpenCrane server authority
```

**In this flow:** [OpenCrane server](../opencrane/README.md) ·
[runtime resource builder](../../libs/backend/agents/runtime/k8s-launcher/README.md) ·
[runtime stream](../../libs/server/_infra/agent-runtime-stream/README.md)

Invariant: this process cannot choose its user, agent revision, run, tools, permissions, or durable
state. A failed or retried attempt receives a different Job identity, and runtime-local files
disappear with its bounded scratch volume. If identity or server authority is unavailable, the
process reconnects with bounded backoff and does no work. The runtime namespace may never collapse
into the OpenCrane server namespace.

## Public surface

`Entrypoint: src/runtime.py` generates a per-run ES256 keypair, reads the projected bootstrap
reference, and binds the public key once via the bootstrap exchange (failing closed on any refusal).
It then reads the mounted projected token at connection time, opens the runtime-initiated stream,
rejects any individual response line above 64 KiB, and executes each `start_attempt` command as a
bounded Pydantic AI model/tool loop. The loop reaches the LiteLLM proxy only through an
attempt-scoped virtual key mounted as a group-readable Secret, performs zero implicit retries, and is
driven with `agent.iter()` / `run_stream_events()` (never the `run_stream()` final-output shortcut).
Raw framework events are normalized into stable protocol candidates while the attempt is active:
output text, usage, and errors become bounded `event` candidates, while a model tool call becomes a
bounded `external_action` candidate whose `toolRevisionId` is resolved from the compiled grant set
and whose `argumentsDigest` is a deterministic `sha256:<hex>` the control plane re-derives. Pydantic
AI types, ids, and checkpoints never cross that seam. Resume injects only control-plane-authorized
deferred tool results; cancel is a positive signal that suppresses any late candidate; steering is
absorbed only at the safe pre-model-request boundary. Any executor failure surfaces as a real
`run.error` candidate rather than a silent acknowledgement, and a dropped stream bounds further
candidate emission. The one exception is the control plane's explicit bounded retry response before
an external action has a durable invocation receipt: the runtime resubmits that exact candidate id
until the server accepts it, exhausts its durable retry budget, or the active attempt/stream is
cancelled, without misreporting a dispatch outage as a model failure.

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
`@opencrane/contracts`, and the server-side transport is owned by `libs/server/_infra`.

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
- `OPENCRANE_RUNTIME_CHECKPOINT_DIR` — directory in the per-attempt scratch `emptyDir` for the
  encrypted local resume checkpoint (defaults to `/tmp/opencrane/checkpoints`). The checkpoint is a
  subordinate local optimisation only, encrypted with a process-lifetime in-memory key, never durable
  state and never a source of truth.
- `/var/run/opencrane/bootstrap/reference` — read-only opaque lookup reference projected from the
  Pod annotation. It is not a credential and is never placed in an environment variable or argument.
- `/var/run/opencrane/litellm/key` — the attempt-scoped LiteLLM virtual key, projected as a
  group-readable (`0440`) Secret volume. It is never the master key, never a provider secret, and
  never a plaintext environment variable.
- Writable storage is only a per-attempt `emptyDir` capped at 1 GiB and mounted at `/tmp`.
- Third-party dependencies are `cryptography` (P-256 proof-key generation) and
  `pydantic-ai-slim[openai]` (the bounded model/tool loop), both pinned in `deploy/requirements.txt`;
  the standard library covers everything else.

The Job builder requires an immutable image digest plus bounded CPU, memory, deadline, and scratch.
The container runs as numeric user and group `65532` with a read-only root filesystem. Its projected
credential is group-readable (`0440`) only by that runtime group; it is never world-readable.

## Status

The current image proves identity, the one-use bootstrap exchange, durable command dispatch, and a
bounded model/tool loop: it binds its proof key, receives its fenced `start_attempt`,
`resume_attempt`, and `cancel_attempt` commands with its control-plane-compiled literal input, and
completes a real agent run over LiteLLM through an attempt-scoped key. It surfaces model tool calls as
`external_action` candidates for server-side authorization, feeds authorized deferred results on
resume, kills the active task on a positive cancel signal, absorbs steering at pre-model-request
boundaries, and writes an encrypted, version-tagged, replaceable local checkpoint subordinate to
canonical server state. The controller creates or exact-adopts the suspended Job, releases the durable
assignment, and registers the unique first Pod. The offline conformance harness and fault-injection
matrix (`tests/test_conformance.py`, `tests/test_fault_matrix.py`) are built and CI-runnable; the
live-LiteLLM conformance run over the pinned `pydantic-ai` package, the driver adoption evidence, and
the corresponding OpenClaw loop deletion remain gated on
[#337](https://github.com/elewa-git/opencrane/issues/337) (ADR 0010) and are not exercised offline.

## See also

- Parent index: [apps](../README.md)
- Server transport: [agent-runtime-stream](../../libs/server/_infra/agent-runtime-stream/README.md)
- Per-attempt resources: [runtime/k8s-launcher](../../libs/backend/agents/runtime/k8s-launcher/README.md)
- Runtime protocol: [contracts](../../libs/contracts/README.md)
- Deployment composer: [deploy-k8s](../_infra/deploy-k8s/README.md)
