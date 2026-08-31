# agent-runtime — the isolated agent process

> [apps](../README.md) › agent-runtime

## What it owns

The agent runtime runs one claimed AgentRun attempt. It starts as a generic Pod in a small
Helm-owned warm pool. It has no run, user, or model key while it waits.

A **workflow** is a saved task that can continue after a server or controller restart. The AgentRun
workflow reserves one warm Pod in the database, changes its fixed network profile, and checks that it
is ready. This process then binds to that saved reservation and receives a short-lived LiteLLM key in
memory.

```text
 generic warm Pod
       │ database reserves exact Pod UID
       ▼
 claimed network profile + readiness check
       │
       ▼
 one-use proof binding → model key returned in memory
       │
       ▼
 outbound command stream → bounded model loop
       │
       ▼
 server saves events and performs approved external actions
       │
       ▼
 workflow deletes the used Pod
```

The runtime proposes events and tool requests. The OpenCrane server decides what is allowed, calls
external services, and saves durable state. The runtime never calls an external tool itself.

## Main behavior

- It exposes two small in-Pod readiness paths used only by the controller.
- It saves only public proof evidence in the Pod's temporary `emptyDir`, so a container restart on
  the same Pod can replay the exact binding.
- An explicit unreserved generic-Pod response retries with bounded backoff until the controller
  saves a reservation; every other binding refusal stops the process before a command stream opens.
- It rereads the projected Kubernetes token on every bind retry and stream reconnect.
- It keeps the attempt-scoped LiteLLM key only in process memory. There is no mounted-key fallback.
- It opens one outbound command stream and accepts start, resume, and cancel commands for the bound
  attempt.
- It sends model output, usage, tool requests, questions, and terminal results back as bounded
  candidates.
- Before waiting, it sends one bounded continuation to the server. The server encrypts and saves
  that state so a replacement runtime can continue the same model turn.

## Public surface

- `GET /healthz` reports that the process is alive.
- `GET /readyz` reports whether an unclaimed warm Pod is ready or a claimed Pod has the expected
  network profile.
- The runtime opens the private outbound command stream configured by
  `OPENCRANE_RUNTIME_STREAM_URL`; it does not expose a public network service.

## Boundary

The process cannot choose a run, user, agent revision, model, tool, permission, or credential. It
has no database client, Kubernetes permissions, Ingress, persistent tenant storage, provider key, or
tool implementation.

This image runs the standard AgentRun workload. Uploaded OCI MCP and code-skill images use their own
executor class and are not loaded into this Pod.

## Runtime settings

- `OPENCRANE_RUNTIME_STREAM_URL` — private OpenCrane runtime endpoint.
- `OPENCRANE_RUNTIME_TOKEN_PATH` — rotating projected Kubernetes token path.
- `OPENCRANE_WARM_BINDING_PORT` — local readiness and binding port.
- `OPENCRANE_WARM_PROFILE` — fixed claimed network profile expected by the readiness endpoint.
- `POD_UID` — immutable Pod UID from the Kubernetes downward API.
- `OPENCRANE_RUNTIME_LITELLM_BASE_URL` — in-cluster LiteLLM endpoint.
`/tmp/opencrane/proof-evidence.json` contains only the public JWK and its thumbprint. It contains no
private proof key or model key. The file survives a container restart in the same Pod and disappears
when the workflow deletes that Pod.

The container runs as user and group `65532`, has a read-only root filesystem, and receives only
bounded temporary scratch storage.

## Source map

- `src/runtime.py` owns startup, one-use binding, and stream reconnects.
- `src/warm_runtime.py` owns the local readiness paths.
- `src/bootstrap/` owns proof-key generation and the binding request.
- `src/transport/` owns server communication.
- `src/attempts/` owns command execution, the serializable continuation, and saved-result resume.
- `src/model_loop/` adapts the bounded Pydantic AI loop.
- `src/protocol/` converts model events into the stable OpenCrane protocol.

## See also

- [Source architecture](src/README.md)
- [AgentRun authority](../../libs/backend/agents/execution/runs/main/README.md)
- [AgentRun workflow handler](../../libs/backend/agents/execution/runs/controller/README.md)
- [Warm pool definitions](../../libs/backend/agents/runtime/k8s-launcher/README.md)
- [Runtime stream](../../libs/backend/server/infra/agent-runtime-stream/README.md)
