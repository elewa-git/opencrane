# agent-controller — agent workload mutation boundary

> [apps](../README.md) › agent-controller

## What it owns

The agent controller is the sole OpenCrane process allowed to create personal-agent workloads in a
customer **silo**. Each silo has a server namespace plus a separate runtime namespace for untrusted
personal-agent Jobs. The controller has no inbound listener: it polls OpenCrane for authorised desired state, creates a suspended Job in that dedicated runtime namespace,
and reports the
Job's Kubernetes-issued identity back to OpenCrane. A separate durable claim then lets it release
that exact Job and register the unique first Pod.

The same process also projects governed skill workloads into the authoring and tool-runner
namespaces. Those Jobs are created suspended and their UID is committed to the durable skill record.
A separate database release fence permits exactly one UID-and-resource-version-fenced unsuspend
patch, followed by a list-only lookup that records the sole Job-owned worker Pod. It has no Secret,
update, delete, watch, policy, or cross-namespace access in either skill namespace.

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
OpenCrane and Kubernetes adapters, runs the runtime assignment/release and skill assignment/release
poll loops, and flushes telemetry
on `SIGTERM`/`SIGINT`.

## Boundary

The process holds no database credentials and exposes no Service, Ingress, public route or health
listener. Its Kubernetes role exists only in the dedicated runtime namespace and grants
`get/create/patch` for Jobs, `list` for Pods, and `create` (only) for Secrets — the per-attempt
LiteLLM key Secret, owned by its Job so it is garbage-collected with it. It cannot create policy,
read/update/delete Secrets, mutate Pods, or get, replace, delete, or watch any Pod. The minted
virtual key rides the claim response and is written straight into the Secret; the controller never
holds the LiteLLM master key. Its ServiceAccount and Deployment remain in the server namespace, so
compromising a runtime Pod does not place it beside the controller identity. Separate Roles in each
skill namespace grant only `get/create/patch` for Jobs and `list` for Pods; a fail-closed admission
policy limits that patch to the fixed one-time release transition. The projected bootstrap reference
is an opaque lookup key, not a credential, and the controller never logs it.

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
- `AGENT_CONTROLLER_SKILL_WORKLOAD_PROFILES_JSON` — exactly one immutable authoring and tool-runner
  profile, each using a class-bound ServiceAccount and projected-token audience.

The image runs as an unprivileged numeric user with a read-only root filesystem. Helm provides two
separate projected tokens: one for OpenCrane and one for the Kubernetes API. Structured logs go to
standard output, and OpenTelemetry spans cover every HTTP and Kubernetes input/output call. Enabling
the chart requires immutable SHA-256 digests for both the controller and runtime images. Helm derives
one `<release>-runtime` namespace by default, applies the Pod Security Standards restricted profile,
an aggregate Job/Pod/CPU/memory quota, default-deny networking, fixed OpenCrane, same-silo LiteLLM,
and DNS egress, and a ValidatingAdmissionPolicy that rejects sidecars, probes, unpinned images,
privileged or host access, durable mounts, arbitrary Secret projections, and any update other than
the exact one-time `suspend: true` to `false` release. Enabling this controller requires Kubernetes
1.30 or newer, where that admission API is stable, and the release-local LiteLLM mode: a shared
LiteLLM endpoint is rejected because this runtime boundary deliberately permits only the same-silo
Service and port.

Kubernetes API egress accepts exact Service CIDRs/port and optional exact backing endpoint
CIDRs/port. Supply both on CNIs that apply NetworkPolicy after Service destination translation;
Kubernetes intentionally leaves the ordering of that translation implementation-defined.

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
