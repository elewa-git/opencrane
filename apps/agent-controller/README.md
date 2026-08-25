# agent-controller — agent workload mutation boundary

> [apps](../README.md) › agent-controller

## What it owns

The agent controller is the sole OpenCrane process allowed to create personal- and managed-agent
workloads in a customer **silo**. Each silo has a server namespace plus separate runtime namespaces
for untrusted personal-agent and connector-scoped managed-agent Jobs. The controller has no inbound listener: it polls OpenCrane for authorised desired state, creates a suspended Job only in the namespace bound to that workload profile,
and reports the
Job's Kubernetes-issued identity back to OpenCrane. A separate durable claim then lets it release
that exact Job and register the unique first Pod.

The same process also projects governed skill workloads into the authoring and tool-runner
namespaces. Those Jobs are created suspended and their UID is committed to the durable skill record.
A separate database-fenced release permits one conditional unsuspend with a deadline bounded by that
release, followed by registration of the exact first Job-owned Pod. The controller cannot write
Secrets or choose a worker identity in either skill namespace. A separate fail-closed admission
policy permits only the pinned, class-specific worker shape, so the controller cannot use its Job
permission to create arbitrary work.

For authoring validation, the same process also runs an Absurd worker. A workflow is a saved task
that can pause and continue after a restart. When a product adapter admits a validation, the
OpenCrane server saves that task in the same database transaction as the validation record; this
controller reloads only its ID, creates the restricted Job, and asks the server to record the
outcome. The handler registration is live, but a product-facing admission path is still pending.
It never decides whether a validation may be admitted or writes the product's final result directly.

Each released skill Job receives an audience-bound projected token and opaque bootstrap reference
through separate read-only files. Helm fixes the acknowledgement URL to the same-silo OpenCrane
Service; it does not inherit the controller's configurable runtime endpoint. The worker can only
acknowledge that reference, and the server TokenReviews the exact first worker Pod before consuming
it once.

The controller also creates one suspended MCP bundle validator Job for each durable validation request.
An MCP bundle is a packaged MCP server. The Job gets only an opaque bootstrap reference and a short-lived
token; it has no database or Kubernetes credentials. This slice only creates or adopts that fixed Job.
It does not start the Job or allow a bundle to run.

Keeping this work in a separate, narrowly privileged process prevents the API server and the runtime
itself from becoming general Kubernetes workload launchers. OpenCrane decides *what* may run; this app
only projects that decision into the restricted runtime namespace named by the selected profile's RoleBinding.

```
 OpenCrane internal API ........ durable run attempt + named profile
             │  outbound claim
             ▼
 ┌──────────────────────────────────┐
 │ agent-controller  ◄── HERE        │  one per silo; no listener
 └──────────────┬───────────────────┘
                │ exact create, conditional release, exact Pod list
                ▼
 Helm-owned personal or managed runtime floor → suspended agent-runtime Job
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
OpenCrane and Kubernetes adapters, starts the durable skill-validation worker, runs the runtime
assignment/release, suspended-skill-assignment, and suspended-MCP-bundle-validator poll loops, and
flushes telemetry
on `SIGTERM`/`SIGINT`.

## Boundary

The process receives the same silo database URL as task admission only to run already-admitted
workflow tasks; it exposes no Service, Ingress, public route or health listener. Its Kubernetes
roles exist only in the dedicated personal and managed runtime namespaces and grant
`get/create/patch` for Jobs, `list` for Pods, and `create` (only) for Secrets — the per-attempt
LiteLLM key Secret, owned by its Job so it is garbage-collected with it. It cannot create policy,
read/update/delete Secrets, mutate Pods, or get, replace, delete, or watch any Pod. The minted
virtual key rides the claim response and is written straight into the Secret; the controller never
holds the LiteLLM master key. Its ServiceAccount and Deployment remain in the server namespace, so
compromising a runtime Pod does not place it beside the controller identity. The projected bootstrap
reference is an opaque lookup key, not a credential, and the controller never logs it. It has one
separate Role in the MCP bundle validator namespace that can only create and get validator Jobs; the
matching admission policy accepts one exact suspended worker shape.

## Dependency direction

Tagged `type:app`, `layer:entrypoint`, and `scope:agent-controller`. The app composes the runtime
controller library and shared observability package; reusable orchestration and adoption rules stay
outside the app root.

## Runtime & config

- `OPENCRANE_INTERNAL_URL` — same-silo internal OpenCrane origin; Helm derives it from the release.
- `OPENCRANE_SERVER_SERVICE_NAME` — exact same-silo OpenCrane Service allowed to receive the controller token.
- `OPENCRANE_CONTROLLER_TOKEN_PATH` — rotating `opencrane-agent-controller` audience token file.
- `DATABASE_URL` — same-silo database connection used only by the durable validation worker.
- `OPENCRANE_SILO_ID` — the silo whose saved validation tasks this controller may execute.
- `AGENT_CONTROLLER_WORKFLOW_DATABASE_POOL_SIZE` — 1–20 database connections for the worker;
  Helm uses the shared workflow setting.
- `AGENT_CONTROLLER_WORKFLOW_WORKER_CONCURRENCY` — 1–20 validation handlers in parallel; Helm
  uses the shared workflow setting.
- `AGENT_CONTROLLER_POLL_INTERVAL_MS` — 100–60,000 ms delay after idle or failure; default 1,000 ms.
- `AGENT_CONTROLLER_OUTBOX_PRUNE_INTERVAL_MS` — 60 seconds–24 hours between bounded removal of
  successfully delivered runtime handshakes; default one hour. Failed commands remain durable evidence.
- `AGENT_CONTROLLER_REQUEST_TIMEOUT_MS` — 1–60 second hard cap independently applied to every
  OpenCrane and Kubernetes request; default 10 seconds. Process shutdown cancels either request type
  immediately, and each retry receives a fresh deadline.
- `AGENT_CONTROLLER_PROFILES_JSON` — bounded immutable runtime profiles keyed by authority-owned name;
  every profile carries its sole runtime namespace, identity class, and ServiceAccount. A claim whose
  namespace does not exactly equal its selected profile is refused before Kubernetes I/O. The
  personal profile name must be a DNS label and cannot use the reserved managed profile name
  `managed-default`.
- `AGENT_CONTROLLER_SKILL_WORKLOAD_PROFILES_JSON` — exactly one immutable authoring and tool-runner
  profile, each using a class-bound ServiceAccount, projected-token audience, and fixed bootstrap
  file paths and same-silo acknowledgement URL.
- `AGENT_CONTROLLER_MCPB_VALIDATOR_PROFILE_JSON` — the one immutable profile for suspended MCP bundle
  validator Jobs: namespace, image digest, ServiceAccount, token audience, fixed bootstrap URL and
  file paths, resource limits, and deadline. It cannot supply a command, bundle location, or database
  credential.

The image runs as an unprivileged numeric user with a read-only root filesystem. Helm provides two
separate projected tokens: one for OpenCrane and one for the Kubernetes API. Structured logs go to
standard output, and OpenTelemetry spans cover every HTTP and Kubernetes input/output call. Enabling
the chart requires immutable SHA-256 digests for both the controller and runtime images. Helm derives
one personal `<release>-runtime` namespace by default. Its managed profile reads the namespace and
ServiceAccount from the composer-owned `managedAgentRuntimePlane.managedAgentRuntime` values; that
runtime plane owns the namespace and its network policy, while this chart grants the controller KSA only exact Job, Pod-list, and model-key
Secret-create permissions there. Each profile namespace receives a separate fail-closed admission
policy with its own ServiceAccount grammar and projected-token audience. The personal plane applies the Pod Security Standards restricted profile,
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
