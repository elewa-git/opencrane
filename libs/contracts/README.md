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
  controller DTOs use adjacent `*.types.ts`/`*.validator.ts` pairs for runtime attempts; those Zod
  schemas keep runtime acceptance, strict request fields, and TypeScript
  models in one package.

Personal-session, ordinary chat, group-child and reviewed-share requests require an `idempotencyKey` UUID. Clients reuse it after an
uncertain response and supply a new UUID for a new command. Group-child responses identify their
parent request and Pending, Ready or Unavailable state; parent metadata never grants child access.

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
provider credentials or mutable source objects. Its `mcpTools` list records immutable MCP tool
revision identifiers plus each saved name, description, exact input JSON Schema, and canonical
schema digest. Registry and provider credentials remain entirely behind server-owned execution
boundaries and never enter the snapshot or conversation computer. The compiled model
route also freezes the model registry's generated-output allowlist; the executor
cannot infer image-generation authority from a prompt or provider response. The compiled budget
preserves the admitted model-turn limit alongside token, cost, tool, and wall-clock ceilings.
Identity evidence is explicitly tagged. A personal run pins the human's deployment-selected Fleet or Standalone membership.
A company run pins its own Internal Principal, active service and exact published revision. Both
carry the human requester's independently verified human membership. The strict schema lives beside the agent model and is re-exported here. Standalone evidence uses
the local membership row/version and bounded observation instead of Fleet proof fields. The schema rejects
mixed kinds, missing requester evidence and principal/silo/revision substitutions; current database
and identity checks still run at admission. A stored snapshot never grants current permission.

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
- `ConversationHistoryResponse`, `ConversationEntry`, and the conversation-computer contracts — the
  immutable history and generation-fenced computer vocabulary shared by server and browser.
- `ConversationComputerRealizationKinds`, `ConversationComputerRealization`, and
  `RealizedLeaseScope` — the persisted discriminant between a production Agent Sandbox and a Tier 2
  host-development process. Both carry non-secret process coordinates; authentication and product
  authority remain server-owned. Host coordinates do not claim that the workstation enforces the
  production profile's Kubernetes confinement, resources or checkpoint support.
- `ConversationToolProposal`, `___ConversationToolProposalSchema` and
  `ConversationToolProposalReceipt` — the private workload request for one frozen tool revision
  and bounded JSON arguments. It accepts no caller-selected identity or approval. A receipt
  confirms storage only; it contains no provider result or execution claim.
- `___ConversationComputerSchema` validates the existing public computer shape, lease generation,
  and checkpoint metadata without admitting private extensions. Readers still bind its conversation
  coordinate to the authenticated request.
- `AG_UI_CHILD_RUN_ENVELOPE_VERSION` — versioned CUSTOM envelope for lossy immediate-child terminal
  updates. It never exposes child context or sibling data.
- `AG_UI_TOOL_FAILURE_EVENT` / `AgUiToolFailureEnvelope` — display-safe failed-tool marker carrying
  only the public call id and an optional server-selected technical classification, never provider
  text, raw arguments, credentials, or retry authority.
- `ConversationEntry`, its human/agent/service/system authors, encrypted message payload references,
  explicit log variants, and A2UI mutations — the canonical participant-visible event contract for
  a `conversation-{id}` history stream. `___ConversationEntrySchema` validates storage and
  receipt-transformer records; `___ConversationComputerEntrySchema` is stricter and refuses a
  computer-provided service attestation. Receipt verification and the bound writer's computer/stream
  checks remain context-specific boundaries outside these structural parsers. Both carry opaque
  payload and artifact coordinates, never plaintext bodies, storage credentials, or general
  event-store access.
- Hand-written DTOs/enums: hierarchical `Group` with nullable `parentId`, `ClusterTenant*`,
  `Mcp*` operator types (MCP — the Model Context Protocol for connecting external tools),
  model-routing types, memory-gateway constants, `ThirdPartySource*`,
  `RunInputSnapshot`/`RunInputSnapshotMcpTool`, `ExecutionSubject`,
  `TenantModelSet`, and domain-topology host builders.
- `ConversationModelRequest`, `ConversationModelResponse`, `ConversationModelToolCall` and
  `ConversationModelContinuation` — shared server-only model transport contracts. Adjacent strict
  schemas preserve the original assistant call and validate the combined saved call/result bound.
  Tool modes distinguish a first selection from text-only continuation. These types grant no tool
  permission; endpoint and credential fields stay in server memory and must never become workload
  or browser payloads.
- `PROMPT_COMPILER_VERSION` — the immutable compiler-version pin every executable agent revision
  must name before it can admit a run.
- `AgentConfigPatchKinds` — the durable `persona_refresh` and `model_alias` vocabulary shared by
  personal-configuration validators, persistence, and public schemas. It keeps the readable JSON
  values stable while making patch branches compile against one shared owner.
- `MemoryFactProvenanceSourceKinds` and `ExecutionSubject` — stable memory-source vocabulary and the
  evidence-bound agent identity, principal, membership, capability, run, computer-lease, requester,
  and admission coordinates shared by run snapshots and service gates.
- `AGENT_CONTROLLER_PROJECTED_TOKEN_AUDIENCE`, `AGENT_CONTROLLER_SERVICE_ACCOUNT_NAME`, and
  `AgentControllerRunAttempt*` — the private controller handshake for claiming one authorised run,
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
- `__CreateSkillAuthoringValidationBootstrapReference`, `__HashSkillAuthoringValidationBootstrapReference`, and
  `__IsSkillAuthoringValidationBootstrapReference` — the browser-safe, deterministic protocol used by the
  workflow-owned skill-authoring path. It creates the opaque Job reference, stores
  only its SHA-256 hash, and rejects any other wire shape; it is not a user credential or a general
  hashing API.
- `__CreateArtifactPreprocessBootstrapReference`,
  `__HashArtifactPreprocessBootstrapReference`, and
  `__IsArtifactPreprocessBootstrapReference` — the shared opaque reference for a one-shot PDF
  preprocessing Job. It lets the server store a hash rather than a usable worker value, while the
  worker still has to prove its Kubernetes identity before it can receive brokered bytes.
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
