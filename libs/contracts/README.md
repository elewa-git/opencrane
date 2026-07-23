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
- **The shared DTOs and enums.** Some are hand-written here (grants, groups, cluster-tenant,
  MCP-server, model-routing, memory, approvals, …); others are **re-exported straight from the model
  packages** (`@opencrane/models/{agents,artifacts,authorization,platform-policy}`) so a caller has
  one import for the whole surface and the wire types stay identical to the domain types.

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
provider credentials or mutable source objects.

## Public surface

- `___CreateControlPlaneClient`, `ControlPlaneClient`, `paths` — the typed HTTP client and its path map.
- `AG_UI_PROJECTION_VERSION`, `AgUiProjectionSourceEvent`, `AgUiSseRecord`,
  `__ProjectAgUiEvent`, and `__EncodeAgUiSseRecord` — the display-safe input, output, projection,
  and SSE-record contract used by the server-owned AG-UI replay path. They do not authenticate a
  browser, read canonical event storage, or create an approval-resume protocol.
- Hand-written DTOs/enums: `Grant`/`GrantScope`/`GrantAccess`, `Group`, `ClusterTenant*`,
  `McpServer*`/`Mcp*` operator types (MCP — the Model Context Protocol for connecting external tools),
  model-routing types, `Memory*`, `Approval`, `ThirdPartySource*`, `RuntimeAssignment`,
  `RunInputSnapshot`/`RunInputSnapshotIdentity`, `MemoryFactReference`, `TenantModelSet`, and
  domain-topology host builders. A memory fact reference pins an immutable content digest and its
  provenance rather than a mutable revision counter.
- `AGENT_RUNTIME_PROTOCOL_V1`, `AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE`,
  `___IsAgentRuntimeServiceAccountName`, `RuntimeStreamOpen`, `RuntimeCommandEnvelope`, and
  `RuntimeCandidate` — the private workload protocol for a personal-agent process that opens its own
  authenticated stream. The opening frame binds the runtime instance to the Pod UID independently
  verified from its Kubernetes credential. The audience constant and shared validator keep Job
  issuance and TokenReview admission on one bounded identity grammar.
- `AGENT_CONTROLLER_PROJECTED_TOKEN_AUDIENCE`, `AGENT_CONTROLLER_SERVICE_ACCOUNT_NAME`, and
  `AgentControllerRunAttempt*` — the private controller handshake for claiming one authorised run,
  reporting the Kubernetes-issued Job identity, and committing that identity under the same database
  lease. `AgentControllerRunWorkloadRelease*` then carries the separate durable command, including
  the assignment's absolute expiry, for releasing only that assigned Job and registering its first
  Pod UID. The opaque bootstrap reference is a
  locator projected through the Job's downward API, never a bearer credential. These types expose
  only immutable workload coordinates; they never expose the run-input body or let the controller
  choose a user, revision, namespace, runtime profile, or replacement Pod.
- Re-exported model types: the agent, artifact, authorization, and platform-policy DTOs.

## Boundary

The one contract surface for public control-plane calls and first-party workload protocols; callers
import it instead of duplicating wire shapes. It defines types and builds a client — it holds no
business logic, persistence, or server state. Runtime and controller frames remain private workload
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
- Siblings: [util](../util/README.md) · [observability](../observability/README.md)
- Re-exported models: [models/agents](../models/agents/main/README.md) · [models/artifacts](../models/artifacts/main/README.md) · [models/authorization](../models/authorization/main/README.md) · [models/platform-policy](../models/platform-policy/main/README.md)
