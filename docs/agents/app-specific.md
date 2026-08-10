# App-specific guidance

> Part of the OpenCrane agent guidance. See [`AGENTS.md`](../../AGENTS.md) for the index.

Read the package's own `README.md` before non-trivial work. General TypeScript rules
([`typescript.md`](./typescript.md)), identity rules ([`architecture.md`](./architecture.md)), and
Kubernetes rules ([`k8s.md`](./k8s.md)) apply throughout.

## Apps

| App | Responsibility |
| --- | --- |
| [`apps/opencrane`](../../apps/opencrane/README.md) | Authenticated REST API, durable product authority, process composition, Prisma, and the server Helm unit. |
| [`apps/opencrane-ui`](../../apps/opencrane-ui/README.md) | Angular web client for organisation and employee surfaces. |
| [`apps/channel-proxy`](../../apps/channel-proxy/README.md) | Inbound channel authentication and routing boundary. |
| [`apps/memory-gateway`](../../apps/memory-gateway/README.md) | Private Cognee transport boundary that TokenReviews the server identity. |
| [`apps/agent-controller`](../../apps/agent-controller/README.md) | Sole Kubernetes mutator for governed run-attempt Jobs. |
| [`apps/agent-runtime`](../../apps/agent-runtime/README.md) | Outbound-only process for one personal or managed run attempt. |
| [`apps/managed-agent-runtime`](../../apps/managed-agent-runtime/README.md) | Isolated namespace and identity profile for scheduled and triggered managed runs. |
| [`apps/artifact-service`](../../apps/artifact-service/README.md) | Governed artifact byte promotion and receipt service. |
| [`apps/artifact-preprocessor`](../../apps/artifact-preprocessor/README.md) | Broker-only document extraction worker. |
| [`apps/skill-authoring`](../../apps/skill-authoring/README.md) | Isolated candidate-skill Job plane. |
| [`apps/tool-runner`](../../apps/tool-runner/README.md) | Isolated governed tool-execution Job plane. |
| [`apps/postgres`](../../apps/postgres/README.md) | OpenCrane-owned PostgreSQL deployment and clean baseline bootstrap. |
| [`apps/_infra`](../../apps/_infra/README.md) | Third-party deployment wrappers and the Kubernetes release composer. |

Apps are thin composition roots. Reusable behaviour belongs in a library, and no app imports another
app's source.

## Backend libraries

| Group | Responsibility |
| --- | --- |
| `libs/backend/agents/personal/*` | Persona, verified personal-memory selection, and configuration authorities owned by a person. |
| `libs/backend/agents/memory/*` | Generic durable fact metadata and catalog-outbox authority; fact content remains in Cognee. |
| `libs/backend/agents/execution/*` | Immutable run inputs, run lifecycle, and runtime protocol admission. |
| `libs/backend/agents/runtime/*` | Kubernetes Job projection and controller orchestration. |
| `libs/backend/agents/skills/*` | Governed skill authoring and execution workloads. |
| `libs/backend/artifacts/*` | Artifact authorization, storage, and preprocessing. |
| [`libs/backend/channel-proxy`](../../libs/backend/channel-proxy/main/README.md) | Reusable inbound-channel trust-boundary logic. |
| [`libs/backend/server`](../../libs/backend/server/README.md) | API capabilities grouped by agents, IAM, gateways, knowledge, reporting, and organisation scope. |
| [`libs/backend/server/agents/onboarding`](../../libs/backend/server/agents/onboarding/main/README.md) | Durable, session-owner-bound onboarding route state and exact persona/bootstrap references. |
| [`libs/backend/server/infra`](../../libs/backend/server/infra/README.md) | OpenCrane server runtime, transport, identity, and external-I/O seams. |
| [`libs/backend/observability`](../../libs/backend/observability/README.md) | Cross-cutting structured logging and execution tracing. |

The durable execution authority is `Thread -> AgentRun -> ordered RunEvent`. A runtime receives one
immutable input snapshot and proposes output; it never becomes a second event, approval, or artifact
authority.

## Server infrastructure

[`libs/backend/server/infra`](../../libs/backend/server/infra/README.md) contains process-specific seams for HTTP,
authentication, Kubernetes access, projected workload identity, the runtime stream, memory,
credential custody, and sandbox execution. These packages contain no business-domain authority.

## Frontend libraries

Angular libraries under `libs/frontend/*` feed `apps/opencrane-ui`:

- `core` and `platform` hold cross-cutting browser primitives;
- `elements/*` contains presentational components;
- `features/*` contains routed user-interface slices; and
- `state/*` contains gateway ports, live adapters, caches, and browser state.

The governed persona onboarding path is split deliberately:

- [`features/onboarding`](../../libs/frontend/features/onboarding/README.md) owns one routed shell
  with interview, tie-resolution, review, and ready state components;
- [`state/onboarding`](../../libs/frontend/state/onboarding/README.md) owns the transport-neutral
  port, validated projection, and resumable orchestration without becoming a persistence authority; and
- [`state/persona/adapter`](../../libs/frontend/state/persona/adapter/README.md) is the typed adapter
  over the generated signed-in-owner API.

Legacy frontend packages use `scope:web`; new capability slices use bounded ownership scopes. The
persona onboarding feature, state port, and adapter use `scope:persona-onboarding` plus role tags
that enforce feature → state and adapter → state/core direction. Cross-cutting core and UI elements
use `scope:shared`. The UI is an API client, never a privileged product authority.

## API-first rule

Every product capability must be usable through the authenticated OpenCrane API. The web client,
generated clients, and custom integrations are peers over the same contract.

## Package navigation

Every app, library, and grouping directory has a `README.md`. When a package is added, moved, or
deleted, update its own README, its parent map, and this page in the same change. Follow
[`package-docs.md`](./package-docs.md).
