# @opencrane/server

The per-silo OpenCrane control plane. It serves the authenticated REST API, composes backend domain
routers, runs the Tenant and AccessPolicy reconcilers, projects fleet-owned membership, and hosts
the identity-routing gateway proxy.

## Responsibilities

- Serve tenant, policy, model, MCP, skill, awareness, spend, audit, and access-token APIs.
- Reconcile Tenant and AccessPolicy custom resources inside this silo's namespace.
- Render immutable personal-runtime workloads and their effective contracts.
- Route signed-in gateway connections to the caller's owner-pinned runtime.
- Repair fleet-to-silo membership and ClusterTenant projections.
- Emit the OpenAPI contract consumed by generated clients and the documentation site.

## Source layout

```text
src/
├── index.ts                 # process bootstrap and controller composition
├── app/                     # Express apps, route composition, config, logging
├── gateways/                # identity-routing gateway proxy
├── hosting/                 # provider adapters
├── infra/                   # auth, projection, and platform adapters
├── openapi/                 # composed API specification
├── reconcilers/
│   ├── policies/            # AccessPolicy reconciliation
│   └── tenants/             # Tenant reconciliation and workload builders
└── scripts/                 # migration entrypoint

prisma/
├── schema/                  # per-domain Prisma schema files
└── migrations/              # applied migration history
```

Business capabilities live under `libs/backend/*`; reusable infrastructure lives under
`libs/infra/*` and `libs/k8s-platform`. This app is the composition and deployment root.

## Development

From the repository root:

```bash
npm run db:generate -w @opencrane/server
npm run lint -w @opencrane/server
npm test -w @opencrane/server
npm run build -w @opencrane/server
```

The container image is built from `apps/opencrane/deploy/Dockerfile` with the repository root as
its build context.
