# Monorepo Structure and Dependency Direction

> Part of the OpenCrane agent guidance. See [`AGENTS.md`](../../AGENTS.md) for the index.

OpenCrane is an NX-managed monorepo. Its folders describe deployability and dependency direction,
not team ownership or implementation history.

## Deployables live in `apps/`

Every independently deployed workload in the OpenCrane release has one root under `apps/<name>` and
is registered as an NX project. A workload counts as independently deployed when it produces or owns
one or more cluster Pods, Deployments, StatefulSets, DaemonSets, CronJobs, or Jobs. This includes
deployment-only wrappers for upstream products such as Cognee, Obot, or LiteLLM: the app root may
contain no product source, but it still owns the pinned dependency, configuration, identity, state,
network policy, deployment wiring, and smoke contract.

An app owns only its composition boundary:

- process entrypoint and lifecycle;
- dependency injection and route/module assembly;
- app-specific configuration parsing;
- container/build metadata;
- app-owned Helm templates, values, and deployment wiring;
- smoke/contract tests that prove the assembled deployable.

Business rules, adapters, calculations, reusable Kubernetes builders, shared UI components, and
domain models do not stay in an app because only one app currently calls them. Put them in `libs/`
and make the app compose them. Keep an app-local implementation only when it is inseparable from
that process boundary and has no useful independent contract.

Charts may aggregate deployables, but aggregation does not erase app ownership: every rendered
workload must map back to its own `apps/<name>` root. An umbrella such as `apps/opencrane-infra`
composes app-owned deployment units and release values; it does not become the anonymous owner of
their Pods. A distinct image or process role always gets a distinct app root. A Job using the exact
same image, entrypoint, trust boundary, and lifecycle as an existing app may remain owned by it.

CLI packages and browser applications also live in `apps/` even though they do not create cluster
Pods, because they are independently built/shipped entrypoints.

## Reuse before creation

Before creating an app, library, route, event/topic, chart template, or adapter, search the live NX
graph and public entrypoints in `apps/`, `libs/`, `libs/k8s-platform/`, `prisma/`, and generated or
runtime contracts. Inspect existing charts, Services, NetworkPolicies, CRDs, and OpenAPI/contracts.
Record the search terms, candidate paths, and one decision: **reuse**, **extend**, or **new**. Prefer
the existing owner when a small coherent extension preserves one authority for the capability.

Do not count frozen-blue or drop/archive code as reusable green functionality. Reusing a retired
mechanism through an adapter recreates the compatibility layer this rewrite removes.

## Libraries use a functional first pass

The first directory below `libs/` states the execution concern. Use the narrowest existing concern;
add a new one only when its dependency policy is meaningfully different.

| Root | Owns | Dependency direction |
|---|---|---|
| `libs/models/` | Pure domain values, schemas, invariants, deterministic calculations | Lowest dependency layer; no database, HTTP, Kubernetes, filesystem, framework, or app imports |
| `libs/contracts/` | Stable external DTOs/protocols and generated clients | Dependency-light contract layer; generated clients do not turn this into a business-logic home |
| `libs/utils/` or `libs/util/` | Small dependency-light helpers with no domain authority | Models/other dependency-light shared code only |
| `libs/backend/` | Server-side domain capabilities, use cases, ports, and adapters | Models, utils, infra abstractions, and explicit backend peers allowed by tags |
| `libs/frontend/` | UI elements, features, state, and gateways | Models/contracts, utils, and frontend peers; never backend implementations |
| `libs/infra/` | Reusable external-I/O and platform adapters | Models/contracts and utils; no app imports |

Within the functional root, group by bounded capability and then by technical role only when needed,
for example `libs/backend/agents/main`, `libs/frontend/features/agents`, or
`libs/infra/artifacts/filesystem`. Do not create a broad `shared`, `common`, or `core` dumping ground.
Promote code to a wider library only when at least two consumers need the same contract or the code
is independently coherent and testable.

The existing singular `libs/util/` name remains valid until a deliberate whole-repo rename; do not
create `libs/utils/` beside it just to satisfy this document.

## Enforced dependency rules

- Apps may depend on libs. Libraries never depend on apps.
- Import another project through its public barrel/package entrypoint, never its internal source
  path.
- Prevent cycles. If two libraries need each other, move the shared contract downward or merge the
  libraries when they are actually one capability.
- Keep dependency-light models/contracts usable by backend, frontend, migrations, and tests without
  pulling runtime frameworks or external-I/O clients.
- Tag every project on three distinct dimensions: project type (`type:app|lib`), functional layer
  (`layer:entrypoint|model|contract|util|backend|frontend|infra`), and bounded-capability ownership
  (`scope:<capability>` or the deliberately cross-cutting `scope:shared`). Use
  `@nx/enforce-module-boundaries` constraints for all three; folder names alone are documentation,
  not enforcement. Apps cannot depend on apps. `layer:model` is the bottom layer; every other layer
  lists its allowed lower/peer layers explicitly. A capability may use its own scope and explicitly
  approved shared/cross-capability contracts, not every project that happens to share a layer.
- Migrate the current layer-shaped `scope:backend|web|shared|app` tags in the first R2 structure gate;
  they are not evidence of bounded-capability ownership.
- Register build, test, lint, and deploy-relevant targets per project so `nx affected` can validate
  only the impacted graph without losing isolation.
- CI now selects affected `container` targets from the NX graph and publishes their immutable SHA
  artifacts. The frozen-blue estate may retain `latest` as a non-deployment alias. Each green
  independently deployable app must then gain an app-owned semantic version and a promotion step that
  selects an explicit version from that immutable artifact. Helm values must resolve a digest or
  immutable version tag, never a moving `latest` tag. Do not retrofit semantic release machinery into
  frozen-blue/drop apps: establish this metadata with each green deployment root in R2.
- Delete replaced projects with their exports, tags, path aliases, targets, chart values, tests, and
  docs. Git history is the compatibility archive.

Run at minimum after changing project structure or boundaries:

```bash
npx nx show projects
npm run lint:boundaries
npx nx affected -t build test lint --base="$WAVE_BASE"
```

Use targeted project tasks during a slice; use the affected graph at a wave gate.
The first R2 foundation slice must add a deterministic workload-ownership check that renders the
green manifests and verifies every workload's owning app root. Until that check exists, the
architecture agent's explicit deployable inventory is a blocking gate, not optional documentation.

## Rewrite-freeze rule

Green is a clean target, not a migration layer. It must not import blue/OpenClaw packages, add
compatibility shims, dual-write, retain deprecated aliases, or repair a blue component that the
accepted data disposition says will be dropped. One-way read-only exporters and idempotent green
importers are migration tools, not runtime compatibility. Frozen-blue changes are limited to the
approved stabilization or break-fix contract in the rewrite-freeze plan.

Before editing a legacy path, classify it as one of:

- **green survivor** — refactor directly into the target package boundary;
- **blue stabilization** — make only the minimum R1/freeze-contract change;
- **migration input** — observe/export read-only; do not improve its product design;
- **drop/archive** — do not fix or port it; schedule its complete removal.

## Research basis

These rules adapt the workspace's current NX/TypeScript stack rather than introducing a second
monorepo model:

- [NX: Folder structure](https://nx.dev/docs/concepts/decisions/folder-structure) recommends grouping
  projects by scope and keeping shared capabilities in explicit shared projects.
- [NX: Enforce module boundaries](https://nx.dev/docs/features/enforce-module-boundaries) documents
  tag-based dependency constraints enforced by ESLint and the project graph.
- [NX: Tags in multiple dimensions](https://nx.dev/docs/guides/enforce-module-boundaries/tag-multiple-dimensions)
  shows independent scope and type constraints so app/library placement is enforced separately from
  domain ownership.
- [NX: What is a monorepo?](https://nx.dev/docs/concepts/decisions/what-is-a-monorepo) distinguishes
  independently built/deployed projects from a monolithic deployable.
- [TypeScript: Project references](https://www.typescriptlang.org/docs/handbook/project-references)
  recommends small projects with explicit dependency relationships and thin endpoint projects.
