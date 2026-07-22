# agent-controller — agent workload mutation boundary

> [apps](../README.md) › agent-controller

## What it owns

The agent controller is the sole OpenCrane process allowed to create personal-agent workloads in a
customer **silo**. Each silo has a server namespace plus a separate runtime namespace for untrusted
personal-agent Jobs. The controller has no inbound listener: it polls OpenCrane for authorised desired state, creates a suspended Job in that dedicated runtime namespace,
and reports the
Job's Kubernetes-issued identity back to OpenCrane. A separate durable claim then lets it release
that exact Job and register the unique first Pod.

Keeping this work in a separate, narrowly privileged process prevents the API server and the runtime
itself from becoming general Kubernetes workload launchers. OpenCrane decides *what* may run; this app
only projects that decision into the one restricted runtime namespace named by its RoleBinding.

```
 OpenCrane internal API ........ durable run attempt + named profile
             │  outbound claim
             ▼
 ┌──────────────────────────────────┐
 │ agent-controller  ◄── HERE        │  one per silo; no listener
 └──────────────┬───────────────────┘
                │ exact create, conditional release, exact Pod list
                ▼
 Helm-owned network floor → suspended agent-runtime Job
                │ Job UID        │ first Pod UID
                └────────────────┴───────► OpenCrane run authority
```

**In this flow:** [OpenCrane server](../opencrane/README.md) ·
[controller library](../../libs/backend/agents/runtime/controller/README.md) ·
[agent runtime](../agent-runtime/README.md)

Invariant: this app can never make an unassigned runtime executable. A fail-closed Kubernetes
admission policy accepts only the pinned, suspended Job shape from this controller identity; every
existing resource must match exactly, and unsuspension tests the assigned Job UID,
its latest resource version, and its still-suspended state in one operation. It never chooses among
multiple Pods, and OpenCrane registers the first Pod before bootstrap exchange can succeed.

## Public surface

`Entrypoint:` `src/index.ts` loads telemetry first, validates configuration, creates the narrow
OpenCrane and Kubernetes adapters, runs the assignment and release poll loop, and flushes telemetry
on `SIGTERM`/`SIGINT`.

## Boundary

The process holds no database credentials and exposes no Service, Ingress, public route or health
listener. Its Kubernetes role exists only in the dedicated runtime namespace and grants
`get/create/patch` for Jobs plus `list` for Pods. It cannot create policy, read Secrets, mutate Pods,
or get, replace, delete, or watch any Pod. Its ServiceAccount and Deployment remain in the server
namespace, so compromising a runtime Pod does not place it beside the controller identity. The
projected bootstrap reference is an opaque lookup key, not a credential, and the controller never
logs it.

## Dependency direction

Tagged `type:app`, `layer:entrypoint`, and `scope:agent-controller`. The app composes the runtime
controller library and shared observability package; reusable orchestration and adoption rules stay
outside the app root.

## Runtime & config

- `OPENCRANE_INTERNAL_URL` — same-silo internal OpenCrane origin; Helm derives it from the release.
- `OPENCRANE_CONTROLLER_TOKEN_PATH` — rotating `opencrane-agent-controller` audience token file.
- `AGENT_RUNTIME_NAMESPACE` — literal dedicated runtime namespace the Role and controller may
  mutate; it is never inferred from the controller Pod's own namespace.
- `AGENT_CONTROLLER_POLL_INTERVAL_MS` — 100–60,000 ms delay after idle or failure; default 1,000 ms.
- `AGENT_CONTROLLER_OUTBOX_PRUNE_INTERVAL_MS` — 60 seconds–24 hours between bounded removal of
  successfully delivered runtime handshakes; default one hour. Failed commands remain durable evidence.
- `AGENT_CONTROLLER_REQUEST_TIMEOUT_MS` — 1–60 second hard cap independently applied to every
  OpenCrane and Kubernetes request; default 10 seconds. Process shutdown cancels either request type
  immediately, and each retry receives a fresh deadline.
- `AGENT_CONTROLLER_PROFILES_JSON` — bounded immutable runtime profiles keyed by authority-owned name.

The image runs as an unprivileged numeric user with a read-only root filesystem. Helm provides two
separate projected tokens: one for OpenCrane and one for the Kubernetes API. Structured logs go to
standard output, and OpenTelemetry spans cover every HTTP and Kubernetes input/output call. Enabling
the chart requires immutable SHA-256 digests for both the controller and runtime images. Helm derives
one `<release>-runtime` namespace by default, applies the Pod Security Standards restricted profile,
an aggregate Job/Pod/CPU/memory quota, default-deny networking, fixed OpenCrane-and-DNS egress, and a
ValidatingAdmissionPolicy that rejects sidecars, probes, unpinned images, privileged or host access,
durable/secret mounts, and any update other than the exact one-time `suspend: true` to `false`
release. Enabling this controller requires Kubernetes 1.30 or newer, where that admission API is
stable.

Runtime-profile CPU values use whole cores or millicores such as `1` or `100m`; memory values use
`Ki`, `Mi`, or `Gi`. Helm rejects malformed or non-string quantities before it can install an
admission policy that would deny every runtime Job.

The k3d conformance gate executes both sides of this boundary on a real API server: invalid Job
variants must be denied by admission, and a one-shot controller-identity Job must receive 200/204
from the internal claim route using its projected token. That second probe proves server-side
TokenReview remains reachable through the exact API-server egress rules.

## See also

- Parent index: [apps](../README.md)
- Controller capability: [runtime/controller](../../libs/backend/agents/runtime/controller/README.md)
- Runtime process: [agent-runtime](../agent-runtime/README.md)
- Manifest builder: [k8s-launcher](../../libs/backend/agents/runtime/k8s-launcher/README.md)
