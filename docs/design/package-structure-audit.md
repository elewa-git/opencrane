# Package structure audit

Snapshot: 2026-09-09, during the working-tree refactor based on `45e0c6b7`.

Status: recommendation 3 is implemented in PR #843. The other four remain recommendations.
The audit establishes source organization findings, not runtime defects or passing validation.

## Scope and method

The overall Nx inventory covered 119 projects with production source. This bounded source review
examined the remaining apps, backend agent execution packages, artifacts, and observability.
Generated code, vendor code, and tests were excluded from the production-source inventory.

Parallel work covers server composition, inputs, agent services, conversations, IAM, contracts,
workload identity, frontend, and the provider/auth/skills folder moves. Those changes were in
progress at this snapshot; this report does not declare them complete or validated.

The review follows the [monorepo boundaries](../agents/monorepo.md) and
[maintainability guidance](../agents/maintainability.md). Apps own startup, configuration,
dependency assembly, and process lifecycle. Libraries own product rules and implementation
adapters. Many files in a source root, or one large file, are signals to inspect responsibility;
they do not establish a need for a new folder or Nx project by themselves.

## Ranked recommendations

### 1. Move skill authoring implementation out of the app

Product role: validate a submitted skill bundle with the approved offline tools and report its result.

[authoring_worker.py](../../apps/skill-authoring/src/authoring_worker.py) owns bundle download and
digest verification, archive extraction, dependency and secret policy, validator execution,
completion transport, retries, and workspace cleanup alongside `main`. These responsibilities can
change independently of process startup; this is actual implementation leakage into an app.

Recommended owner: extend the existing
[skills worker library](../../libs/backend/agents/skills/worker/src/bootstrap.py) with `authoring/`
modules for bundle intake, validation, completion transport, and workload orchestration. Keep
bootstrap separate so its acknowledgement client does not become a general execution dependency.
The app retains entrypoint, configuration, and image tool selection. No new Nx project is needed.

### 2. Give the memory gateway a library implementation owner

Product role: let authorized OpenCrane workloads search the private memory service through a bounded API.

[server.ts](../../apps/memory-gateway/src/server.ts) combines the authenticated request flow,
private Cognee forwarding, response handling, and error translation.
[search-contract.ts](../../apps/memory-gateway/src/search-contract.ts) owns the permitted search
fields and canonical serialization. The contract and provider adapter are implementation in the app,
even though both files are relatively small.

Recommended structure: one gateway implementation library with `search/`, `cognee/`, and `http/`
folders. The app retains listener startup, configuration, health composition, and shutdown.
Reuse the existing workload-identity token reviewer. The existing
[memory gateway client](../../libs/backend/server/infra/memory-gateway-client/src/index.ts) owns
the caller's port and adapter; it should not absorb the gateway service implementation. This
distinct service responsibility justifies a library boundary, subject to architecture review.

### 3. Extract elicitation purpose behavior inside its existing project

Product role: pause a run for an answer or approval, apply that answer, and resume or expire the request.

Implemented in the existing elicitation project. The
[request coordinator](../../libs/backend/agents/execution/elicitation/main/src/prisma-elicitation-unit-of-work.ts)
keeps response attribution, request lifecycle and run resumption together. Four transaction-bound
owners now contain runtime-input delivery, tool approval, personal-memory permission and A2UI
behavior. The old registry that forwarded decisions back into the coordinator is removed.

The same Serializable transaction covers each purpose effect and the request transition. A failed
purpose rolls back the operation. A run resumes only when neither pending requests nor approvals
remain. The personal-memory owner retains the existing protected payload and permission receipt;
it introduces no fact storage or direct Cognee access. The package README records the state changes.

### 4. Finish the artifact service's read-use-case extraction

Product role: store immutable artifact bytes and serve only bytes authorized by a signed read lease.

[server.ts](../../apps/artifact-service/src/server.ts) already delegates upload promotion to a
library. Its read handler still verifies the lease, checks stored size, retrieves the pinned object,
and streams it with downstream backpressure handling. The read policy and storage flow are app
implementation; listener assembly and response wiring legitimately belong at the process boundary.

Recommended owner: add the lease-bound read use case alongside promotion in
[artifacts/store/main](../../libs/backend/artifacts/store/main/src/index.ts), behind verifier and
store ports. Keep cryptography in artifact authorization and physical storage in
[artifacts/filesystem/main](../../libs/backend/artifacts/filesystem/main/src/index.ts).
Separate the HTTP streaming adapter from the read use case. This is a smaller extraction than the
preceding findings and does not justify reorganizing every artifact package.

### 5. Group run responsibilities without splitting transaction authority

Product role: admit a run, preserve its input, provide execution credentials, and expose its status.

The [runs entry point](../../libs/backend/agents/execution/runs/main/src/index.ts) exposes admission,
credentials, status, and tool recovery from a flat root. Recommended folders in the existing project:
`admission/`, `credentials/`, `status/`, and `tool-recovery/`. This is a lower-priority navigation
improvement, with weaker evidence for changing ownership than the preceding findings.

The [admission unit of work](../../libs/backend/agents/execution/runs/main/src/prisma-run-admission-unit-of-work.ts)
keeps replay, concurrency, and snapshot checks under one atomic admission authority. Preserve that
cohesion. Coordinate conversation lifecycle files with the active conversation refactor owner.

## Inspected areas that do not warrant forced splitting

- [Observability](../../libs/backend/observability/src/index.ts) has concise modules for logging,
  context, tracing, and telemetry. Its flat root does not demonstrate mixed ownership.
- Smaller worker apps generally configure dependencies, start library behavior, and handle shutdown.
  [Artifact scanner startup](../../apps/artifact-scanner/src/index.ts) is an existing example to follow.
- [MCP executor packages](../../libs/backend/agents/runtime/mcp-executor/README.md) already separate
  execution roles; file counts alone do not justify more projects.
- [Filesystem artifact storage](../../libs/backend/artifacts/filesystem/main/src/filesystem-artifact-store.ts)
  implements one storage contract. Its filesystem and atomicity details are cohesive.
- [Artifact preprocessing](../../libs/backend/artifacts/preprocessor/main/src/index.ts) already
  separates the remote adapter, extraction, and processing flow.

No source changes or tests were performed for this audit. Recommendation implementation requires
its own ownership review and focused validation; this snapshot is not evidence that parallel work passed.
