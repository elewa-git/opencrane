# libs/backend — product and control-plane capabilities

Backend libraries are grouped by the capability they provide. The agent product lives under
[`agents/`](agents/): these authorities shape a person's assistant, its conversations, durable
memory catalogue, and logical runs. The OpenCrane server's control-plane capabilities live under
[`server/`](server/): they establish identities, membership, authorization, agent-service
publication, and the boundaries that connect the product to deployed runtimes.

`apps/opencrane` is the intended composition boundary for both groups. Its process-only transport
and platform support lives separately under [`libs/server/_infra`](../server/_infra/) so business
capabilities do not become mixed with server machinery. Apps remain thin entrypoints that mount
routers, construct clients, and manage process lifecycle.

`feat-openclaw-tenant/` is the one temporary exception. It is a direct-deletion boundary for the
retired personal-agent runtime and must not receive new functionality.

## Layout

```text
libs/backend/
  agents/personal/<domain>/main/  Personal-agent product capability
  server/<domain>/main/           OpenCrane control-plane capability
  channel-proxy/main/             Target-neutral channel forwarding capability
    project.json              Nx project metadata and targets
    src/index.ts              public barrel
  feat-openclaw-tenant/       deletion boundary; do not extend
```

The `/main` level lets a capability namespace gain a deliberately separate peer later without
flattening unrelated responsibilities together.

## Current functional domains

- Personal agent: personas built from an onboarding interview, conversations, durable-memory
  metadata, and logical run attempts. See [`agents/`](agents/).
- Control plane: identity and access, fleet membership, agent-service publication, channel target
  resolution, artifacts, and the established server capabilities. See [`server/`](server/).
- Channel proxy: a target-neutral browser-facing forwarding boundary that asks the control plane
  for each authorized destination.

- Identity and access: access tokens, identity, grants, groups, policies, and cluster membership.
- Tenant and runtime lifecycle: tenants, connections, effective contracts, and projection repair.
- Models and economics: providers, model routing, spend, and budgets.
- Knowledge and memory: awareness, retrieval sources, and company documents.
- Tools and integrations: skills and MCP servers.
- Operations and API composition: audit, metrics, and the generated API specification.

These are current code ownership boundaries, not promises that legacy Tenant, AccessPolicy,
OpenClaw, rollout, or projection behavior survives the direct target refactor.

## Dependency rules

- Server capabilities may depend on models, contracts, utilities, `libs/server/_infra` support,
  and explicit backend peers; they never depend on an app.
- Cross-capability imports use a public barrel such as
  `@opencrane/backend/server/<domain>`, never an internal source path.
- Server-runtime imports use `@opencrane/server/_infra/<runtime>`.
- No compatibility aliases exist for the previous flat paths.
- Database models remain in the OpenCrane app's per-domain Prisma schema files; see
  [`docs/agents/prisma.md`](../../docs/agents/prisma.md).

## Adding a backend capability

1. Put a user-facing personal-agent capability under
   `libs/backend/agents/personal/<domain>/main`; put a server control-plane capability under
   `libs/backend/server/<domain>/main`.
2. Name the Nx project after that bounded capability and update `sourceRoot`, target working
   directories, and its root-relative TypeScript and Vitest paths.
3. Add the matching `@opencrane/backend/agents/...` or
   `@opencrane/backend/server/...` public path to the root `tsconfig.json` paths.
4. Export only the public capability surface from `src/index.ts` and mount transport adapters from
   `apps/opencrane`.
5. Add or update the app-owned Prisma schema slice when the capability owns durable models.
6. Run the project's lint and test targets plus `npm run lint:boundaries`.

The server container copies `libs` wholesale and bundles the app's source dependency closure, so a
new source-only backend library does not need its own Dockerfile.
