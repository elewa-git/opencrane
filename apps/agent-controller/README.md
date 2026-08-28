# agent-controller — agent workload mutation boundary

> [apps](../README.md) › agent-controller

## What it owns

The agent controller owns the fixed personal and managed warm pools in a customer **silo**. Each pool
is a Helm-owned Deployment in its own restricted namespace. The controller has no inbound listener.
An Absurd task asks OpenCrane for one saved run claim, finds a ready generic Pod, activates only that
Pod, and binds it to one run attempt. The Pod is discarded after use and its Deployment restores the
spare.

The same process also projects governed skill workloads into the authoring and tool-runner
namespaces. Those Jobs are created suspended and their UID is committed to the durable skill record.
A separate database-fenced release permits one conditional unsuspend with a deadline bounded by that
release, followed by registration of the exact first Job-owned Pod. The controller cannot write
Secrets or choose a worker identity in either skill namespace. A separate fail-closed admission
policy permits only the pinned, class-specific worker shape, so the controller cannot use its Job
permission to create arbitrary work.

The controller also projects admitted OCI-backed MCP servers into their dedicated executor
namespace. The server chooses the imported image digest; deployment configuration fixes the
OpenCrane companion, ServiceAccount, endpoint, lifetime, and resources. The controller records the
Job UID before release and records the first Pod UID before the companion may claim work.

When artifact preprocessing is enabled, the same durable worker creates and releases the fixed PDF
conversion Job in its isolated namespace. The optional Role grants only Job get/create/patch/delete
and Pod list there; the profile fixes the immutable image, worker identity, same-silo broker
endpoint, deadline, scratch volume, and resources. Fail-closed admission binds creation and release
to the exact suspended Job envelope. After durable completion, the Absurd task deletes only the Job
UID that OpenCrane saved; a failed delete is retried and an already missing Job is complete.

Each released skill Job receives an audience-bound projected token and opaque bootstrap reference
through separate read-only files. Helm fixes the acknowledgement URL to the same-silo OpenCrane
Service; it does not inherit the controller's configurable runtime endpoint. The worker can only
acknowledge that reference, and the server TokenReviews the exact first worker Pod before consuming
it once.

Keeping this work in a separate, narrowly privileged process prevents the API server and the runtime
itself from becoming general Kubernetes workload launchers. OpenCrane decides *what* may run; this app
only projects that decision into the restricted runtime namespace named by the selected profile's RoleBinding.

```
 OpenCrane internal API ........ durable run claim + named warm profile
             │  outbound claim
             ▼
 ┌──────────────────────────────────┐
 │ agent-controller  ◄── HERE        │  one per silo; no listener
 └──────────────┬───────────────────┘
                │ exact Pod read, profile activation, and discard
                ▼
 Helm-owned personal or managed Deployment → one-use claimed Pod
                                              │ exact Pod UID
                                              └──────► OpenCrane run authority
```

**In this flow:** [OpenCrane server](../opencrane/README.md) ·
[controller library](../../libs/backend/agents/runtime/controller/README.md) ·
[agent runtime](../agent-runtime/README.md)

Invariant: this app can never assign one warm Pod twice. OpenCrane saves the reservation first, the
controller activates only the exact ready Pod returned by that claim, and Kubernetes admission lets
the controller change only the fixed generic profile into its fixed personal or managed profile.

## Public surface

`Entrypoint:` `src/index.ts` loads telemetry first, validates configuration, starts the guarded
AgentRun, skill-authoring, and optional artifact-preprocessing workflow workers, retains the generic
skill and OCI MCP reconciliation loops, and drains workflows and telemetry on `SIGTERM`/`SIGINT`.

## Boundary

The process uses the same release-local OpenCrane database credential as the server so Absurd can
claim tasks from the queues where server transactions admitted them. Its NetworkPolicy permits only
the release-local CNPG pooler on TCP 5432. It exposes no Service, Ingress, public route or health
listener. Its runtime roles permit only reading and activating the fixed warm Deployments and Pods.
Separate roles keep `get/create/patch` for governed skill and OCI MCP Jobs, add UID-fenced `delete`
only for artifact Jobs, and keep `list` for their Pods. The controller cannot create policy or read
workload credentials. The one-attempt model key stays in
the Absurd claim response and is sent directly to the claimed Pod. The controller never receives the
LiteLLM master key. Its ServiceAccount and Deployment remain in the server namespace, so
compromising a runtime Pod does not place it beside the controller identity.

## Dependency direction

Tagged `type:app`, `layer:entrypoint`, and `scope:agent-controller`. The app composes the runtime
controller library and shared observability package; reusable orchestration and adoption rules stay
outside the app root.

## Runtime & config

- `OPENCRANE_INTERNAL_URL` — same-silo internal OpenCrane origin; Helm derives it from the release.
- `DATABASE_URL` — release-local OpenCrane database URL read through the existing application Secret.
- `OPENCRANE_SILO_ID` — silo accepted by the workflow guard for every controller task.
- `OPENCRANE_SERVER_SERVICE_NAME` and `POD_NAMESPACE` — exact same-silo server coordinates checked
  by the controller-only HTTP authorities.
- `OPENCRANE_WORKFLOW_DATABASE_POOL_SIZE`, `OPENCRANE_WORKFLOW_WORKER_CONCURRENCY`, and
  `OPENCRANE_WORKFLOW_POLL_INTERVAL_MS` — bounded Absurd database, concurrency, and polling limits.
- `OPENCRANE_CONTROLLER_TOKEN_PATH` — rotating `opencrane-agent-controller` audience token file.
- `AGENT_CONTROLLER_POLL_INTERVAL_MS` — 100–60,000 ms delay after idle or failure; default 1,000 ms.
- `AGENT_CONTROLLER_REQUEST_TIMEOUT_MS` — 1–60 second hard cap independently applied to every
  OpenCrane and Kubernetes request; default 10 seconds. Process shutdown cancels either request type
  immediately, and each retry receives a fresh deadline.
- `AGENT_CONTROLLER_WARM_PROFILES_JSON` — the exact personal and managed Deployment, namespace,
  ServiceAccount, image, and profile labels. A claim that names anything else is refused before
  Kubernetes I/O.
- `AGENT_CONTROLLER_SKILL_WORKLOAD_PROFILES_JSON` — exactly one immutable authoring and tool-runner
  profile, each using a class-bound ServiceAccount, projected-token audience, and fixed bootstrap
  file paths and same-silo acknowledgement URL.
- `AGENT_CONTROLLER_MCP_EXECUTOR_PROFILE_JSON` — one immutable profile for OCI-backed MCP Jobs. It
  fixes the companion image, isolated namespace, zero-RBAC ServiceAccount, internal endpoint,
  projected-token lifetime, scratch size, deadline, and both containers' resources.
- `AGENT_CONTROLLER_ARTIFACT_PREPROCESSOR_PROFILE_JSON` — optional immutable PDF Job profile emitted
  only when artifact preprocessing is enabled.

The image runs as an unprivileged numeric user with a read-only root filesystem. Helm provides two
separate projected tokens: one for OpenCrane and one for the Kubernetes API. Structured logs go to
standard output, and OpenTelemetry spans cover every HTTP and Kubernetes input/output call. Enabling
the chart requires immutable SHA-256 digests for both the controller and runtime images. Helm derives
one personal `<release>-runtime` namespace and one managed `<release>-managed-runtime` namespace by
default. This chart owns both namespaces, their warm Deployments, quotas, default-deny networking,
fixed OpenCrane, same-silo LiteLLM and DNS egress, and the admission rule that permits only the exact
generic-to-claimed profile change or discard. Enabling this controller requires Kubernetes
1.30 or newer, where that admission API is stable, and the release-local LiteLLM mode: a shared
LiteLLM endpoint is rejected because this runtime boundary deliberately permits only the same-silo
Service and port.

Kubernetes API egress accepts exact Service CIDRs/port and optional exact backing endpoint
CIDRs/port. Supply both on CNIs that apply NetworkPolicy after Service destination translation;
Kubernetes intentionally leaves the ordering of that translation implementation-defined.

Runtime-profile CPU values use whole cores or millicores such as `1` or `100m`; memory values use
`Ki`, `Mi`, or `Gi`. Helm rejects malformed or non-string quantities before it can install an
warm pool that cannot start.

The k3d conformance gate executes both sides of this boundary on a real API server: invalid warm Pod
changes must be denied, and the controller identity must receive the expected response from the
internal claim route. That second probe proves server-side TokenReview remains reachable through the
exact API-server egress rules.

## See also

- Parent index: [apps](../README.md)
- Controller capability: [runtime/controller](../../libs/backend/agents/runtime/controller/README.md)
- Runtime process: [agent-runtime](../agent-runtime/README.md)
- Manifest builder: [k8s-launcher](../../libs/backend/agents/runtime/k8s-launcher/README.md)
- MCP executor controller: [runtime/mcp-executor/controller](../../libs/backend/agents/runtime/mcp-executor/controller/README.md)
