# @opencrane/contracts — the control-plane API contract and typed client

> [OpenCrane](../../README.md) › contracts

## What it owns

This package is the **contract** between the OpenCrane server (the control plane) and everything that
calls it — the built-in web app and any external, proprietary frontend. A "contract" here is the
shared, versioned definition of the HTTP API: the request/response shapes (DTOs — data transfer
objects) and the enums that both sides agree on, plus a ready-made typed client that speaks it.

Two halves:

- **The typed client.** `___CreateControlPlaneClient(baseUrl, token)` returns an
  [`openapi-fetch`](https://github.com/openapi-ts/openapi-fetch) client whose method and path types
  come from `generated/api.ts` — TypeScript generated from the server's OpenAPI 3.1 specification.
  Because the types are generated from the same spec the server emits, a call that would 404 or send
  the wrong body fails to compile rather than at runtime.
- **The shared DTOs, enums, and wire validators.** Some are hand-written here (grants, groups, cluster-tenant,
  MCP-server, model-routing, memory, approvals, …); others are **re-exported straight from the model
  packages** (`@opencrane/models/{agents,artifacts,authorization,conversations}`) so a caller has
  one import for the whole surface and the wire types stay identical to the domain types. Private
  controller DTOs use adjacent `*.types.ts`/`*.validator.ts` pairs for runtime attempts and governed
  skill workloads; those Zod schemas keep runtime acceptance, strict request fields, and TypeScript
  models in one package.

```
 apps/opencrane server ....... emits OpenAPI 3.1 spec (dist/apps/opencrane/openapi.json)
        │  openapi-typescript
        ▼
 ┌────────────────────────────┐
 │   contracts  ◄── HERE       │  generated types + DTOs + ___CreateControlPlaneClient
 └────────────────────────────┘
        │  typed client + shared types
        ▼
 in-repo web app  ·  external frontends (via the released spec, see below)
```

**In this flow:** [models/agents](../models/agents/main/README.md) · [models/authorization](../models/authorization/main/README.md) *(re-exported DTOs)* · the `apps/opencrane` server *(spec producer)*

Invariant: the client's types are a faithful projection of the server's published spec — regenerate
after any API change so the two never silently diverge. `RunInputSnapshot` is the cross-domain
record of one run's frozen persona, transcript, memory references, tools, budgets, model route and
verified identity provenance; it carries only immutable coordinates and canonical JSON, never
provider credentials or mutable source objects. Its integration assignments record an integration
identifier plus each revision-reviewed tool name, description, exact input JSON Schema, and
canonical schema digest; provider addressing and credentials remain entirely behind the
server-owned action execution boundary and never enter the snapshot or runtime. The compiled model
route also freezes the model registry's generated-output allowlist; the runtime
cannot infer image-generation authority from a prompt or provider response. Identity is
explicitly tagged: a user run
pins a human's signed fleet membership, while a managed run pins the derived service principal, its
signed membership, and the exact approved non-personal scopes. A service record cannot be read as a
user record by accident.

`PROMPT_COMPILER_VERSION` is the single version pin shared by revision authoring, admission, and
the deterministic compiler. A revision that names another version is not admissible, preventing a
runtime from silently interpreting a frozen snapshot with different assembly rules.

## Public surface

- `___CreateControlPlaneClient`, `ControlPlaneClient`, `paths` — the typed HTTP client and its path map.
- `API_ERROR_LIMITS`, `ApiErrorEnvelope`, `ApiValidationIssue`, `ApiValidationIssueLocations`, and
  `___ParseApiErrorEnvelope` — the generated public error contract and bounded runtime parser used
  to map authorized request failures back to frontend fields without trusting arbitrary responses.
- `___ModelRoutingDefaultWriteSchema` — the model-adjacent Zod schema shared by the public routing
  defaults boundary; it enforces known fields while deliberately preserving auto-config extensions.
- `PublicHealthReport` and its fixed service/status enums — the public-safe `/healthz` response
  shared by the server and future status consumers. It reports only
  recognisable capability names and categorical availability, never internal topology or errors.
- `AG_UI_PROJECTION_VERSION`, `AG_UI_A2UI_ENVELOPE_VERSION`, `AgUiProjectionSourceEvent`,
  `AgUiProjectionEvent`, and `AgUiSseRecord` — the stable AG-UI wire vocabulary shared by server and
  browser. Projection and SSE encoding policy live in the separate backend
  [conversation projection package](../backend/conversations/projection/main/README.md).
- `AG_UI_A2UI_ENVELOPE_VERSION`, `AgUiA2uiSurfaceStates`, and
  `___ParseAgUiA2uiEnvelope` — the versioned CUSTOM envelope, authoritative ten-state presentation
  lifecycle, and strict parser for governed A2UI surfaces. Each envelope binds conversation, run,
  message, surface, and monotonic sequence coordinates; admits only ordered upstream
  `beginRendering`, `surfaceUpdate`, and `dataModelUpdate` operations from the accepted eleven-name
  catalogue; and may carry one bounded display-safe reason. These are presentation facts only and
  never grant an action or let a client infer lifecycle authority.
- `AG_UI_CHILD_RUN_ENVELOPE_VERSION` — versioned CUSTOM envelope for lossy immediate-child terminal
  updates. It never exposes child context or sibling data.
- `AG_UI_TOOL_FAILURE_EVENT` / `AgUiToolFailureEnvelope` — display-safe failed-tool marker carrying
  only the public call id and an optional server-selected technical classification, never provider
  text, raw arguments, credentials, or retry authority.
- Hand-written DTOs/enums: hierarchical `Group` with nullable `parentId`, `ClusterTenant*`,
  `Mcp*` operator types (MCP — the Model Context Protocol for connecting external tools),
  model-routing types, memory-gateway constants, `ThirdPartySource*`, `RuntimeAssignment`,
  `RunInputSnapshot`/`RunInputSnapshotIdentity`/`RunInputSnapshotIdentityKinds`/`RunInputSnapshotIntegrationAssignment`,
  `TenantModelSet`, and domain-topology host builders.
- `PROMPT_COMPILER_VERSION` — the immutable compiler-version pin every executable agent revision
  must name before it can admit a run.
- `AgentConfigPatchKinds` — the durable `persona_refresh` and `model_alias` vocabulary shared by
  personal-configuration validators, persistence, and public schemas. It keeps the readable JSON
  values stable while making patch branches compile against one shared owner.
- `MemoryFactProvenanceSourceKinds` and `RunInputSnapshotIdentityKinds` — stable memory-source and
  tagged-execution-identity vocabularies used by catalogue validation and frozen run-input branches.
  Their readable serialised values remain part of the contract; the enums prevent independent
  persistence and admission code from drifting on which branch a value selects.
- `AGENT_RUNTIME_PROTOCOL_V1`, the personal and managed runtime audience constants and validators,
  `RuntimeStreamOpen`, `RuntimeCommandEnvelope`, and `RuntimeCandidate` — the private workload
  protocol for an agent process that opens its own authenticated stream. The opening frame binds the
  runtime instance to the Pod UID independently verified from its Kubernetes credential. Personal
  and managed runtimes use distinct projected-token audiences and ServiceAccount grammars, so one
  workload class cannot borrow the other's transport identity.
- `RuntimeCommandKinds` and `RuntimeCandidateKinds` — documented string-backed discriminants that
  keep workload command and candidate control flow exhaustive while preserving protocol bytes.
- `AGENT_CONTROLLER_PROJECTED_TOKEN_AUDIENCE`, `AGENT_CONTROLLER_SERVICE_ACCOUNT_NAME`, and
  `AgentControllerRunAttempt*`/`AgentControllerMcpbValidation*` — the private controller handshake for claiming one authorised run or MCP bundle inspection job,
  reporting the Kubernetes-issued Job identity, and committing that identity under the same database
  lease. `AgentControllerRunWorkloadRelease*` then carries the separate durable command, including
  the assignment's absolute expiry, for releasing only that assigned Job and registering its first
  Pod UID. The opaque bootstrap reference is a
  locator projected through the Job's downward API, never a bearer credential. These types expose
  only immutable workload coordinates; they never expose the run-input body or let the controller
  choose a user, revision, namespace, runtime profile, or replacement Pod.
- `___ParseAgentController*`, `___IsAgentControllerIdentifier`, and
  `___IsEmptyAgentControllerCommand` — Zod-backed private-protocol
  validators colocated with those DTOs. Response parsers strip untrusted extensions, request parsers
  reject extensions, and contextual result parsers bind echoed Job and Pod coordinates to the exact
  submitted command.
- `__CreateSkillWorkloadBootstrapReference`, `__HashSkillWorkloadBootstrapReference`, and
  `__IsSkillWorkloadBootstrapReference` — the browser-safe, deterministic protocol shared by the
  governed-skill controller and the server authority. It creates the opaque Job reference, stores
  only its SHA-256 hash, and rejects any other wire shape; it is not a user credential or a general
  hashing API.
- `__CreateMcpbValidatorBootstrapReference` and `__IsMcpbValidatorBootstrapReference` — the
  deterministic opaque reference shared by the MCP bundle controller and validator worker. The Job
  carries this reference but never the validation identifier it came from.
- `ARTIFACT_PREPROCESSOR_PROJECTED_TOKEN_AUDIENCE`,
  `ARTIFACT_PREPROCESSOR_SERVICE_ACCOUNT_NAME`, `ArtifactPreprocessorJobClaim`, and the
  claim/failure commands — the narrow broker protocol for the isolated PDF converter. These DTOs
  carry only an expiring attempt fence and bounded source metadata; storage addresses, content
  addresses, leases, receipts, and catalogue coordinates remain server-private.
- Re-exported model types and validators: the agent, artifact, authorization, and immutable-mode
  conversation DTOs. Conversation timeline and replay positions remain canonical positive decimal
  strings so database `BigInt` values cross JSON without precision loss.

## Boundary

The one contract surface for public control-plane calls and first-party workload protocols; callers
import it instead of duplicating wire shapes. It defines types, validates first-party wire models,
and builds a client — it holds no business policy, persistence, or server state. Runtime and controller frames remain private workload
contracts rather than public browser endpoints. External proprietary frontends should generate their
client from the released spec (see below), keeping a clean process/network boundary.

## Licensing

This package is licensed under **MIT** (see [`LICENSE`](./LICENSE)), unlike the rest of the platform,
which is AGPL-3.0-or-later. This is a deliberate relicensing by the copyright owner so external
consumers — including proprietary frontends — can use the generated client and types without
inheriting AGPL obligations. The MIT grant covers only the contents of this `libs/contracts/`
directory.

## Consuming the contract from an external project

You do **not** need to import this package to build a client. The control plane publishes its OpenAPI
spec two ways:

- at runtime: `GET /api/v1/openapi.json`
- as a **release asset** named `openapi.json` on each tagged OpenCrane release.

External frontends should pin a released `openapi.json` and run `openapi-typescript` against it. That
keeps a clean process/network boundary and avoids linking against any AGPL code:

```bash
# Pin a specific OpenCrane release, then generate a typed client locally.
curl -fsSL -o openapi/opencrane.json \
  https://github.com/<org>/opencrane/releases/download/<tag>/openapi.json
npx openapi-typescript openapi/opencrane.json -o src/api/generated.ts
```

## Dependency direction

Tagged `scope:shared` (`layer:contract`): it may depend on the shared model packages it re-exports
and other shared packages — never on apps, backend domains, or the frontend/server layers.

## See also

- Parent index: [OpenCrane](../../README.md)
- Siblings: [util](../util/README.md) · [observability](../backend/observability/README.md)
- Re-exported models: [models/agents](../models/agents/main/README.md) · [models/conversations](../models/conversations/main/README.md) · [models/conversation-assets](../models/conversation-assets/main/README.md) · [models/artifacts](../models/artifacts/main/README.md) · [models/authorization](../models/authorization/main/README.md)
