# Deployment infrastructure

`apps/_infra` contains deployment-only applications and the Kubernetes release composer. These
projects own third-party version pins, Helm resources, workload identity, network policy, storage,
and deployment smoke contracts. They do not own OpenCrane business rules: the functional libraries
listed below own how the product uses each service.

## Service map

| Deployment | What OpenCrane uses it for | Functional areas | OpenCrane integration owners |
|---|---|---|---|
| [`cognee`](./cognee/) | Durable organisation memory, indexed knowledge, dataset membership, and retrieval permissions. | Knowledge and memory; authorization and sharing. | [`libs/backend/server/awareness`](../../libs/backend/server/awareness/main/), [`grants`](../../libs/backend/server/grants/main/), [`policies`](../../libs/backend/server/policies/main/), and [`contract`](../../libs/backend/server/contract/main/). Temporary Cognee identity/bootstrap code remains in the [`feat-openclaw-tenant` deletion boundary](../../libs/backend/feat-openclaw-tenant/main/). |
| [`litellm`](./litellm/) | The model gateway for provider credentials, model registration and routing, tenant keys, budgets, and spend accounting. | Models and economics; tenant runtime access. | [`libs/backend/server/model-routing`](../../libs/backend/server/model-routing/main/), [`providers`](../../libs/backend/server/providers/main/), [`spend`](../../libs/backend/server/spend/main/), and [`tenants`](../../libs/backend/server/tenants/main/). |
| [`obot`](./obot/) | MCP credential custody and the gateway through which agents reach external tools. | Tools and integrations; effective runtime contracts. | [`libs/backend/server/mcp`](../../libs/backend/server/mcp/main/) owns MCP registration and custody metadata; [`contract`](../../libs/backend/server/contract/main/) renders the effective tool surface. |
| [`langfuse`](./langfuse/) | Self-hosted model-execution telemetry and product-facing routing metrics. | Model operations and observability. | [`libs/backend/server/model-routing`](../../libs/backend/server/model-routing/main/) owns the Langfuse metrics adapter. Shared tracing primitives remain in [`libs/observability`](../../libs/observability/). |
| [`cilium`](./cilium/) | The exact-pinned upstream Cilium substrate: identity-keyed network policy and default-deny enforcement for every namespace. Installed once per cluster by its own `deploy.sh`, deliberately outside the silo release. | Platform networking and workload isolation. | Policy profiles are rendered by the apps that own each workload boundary. |
| [`deploy-k8s`](./deploy-k8s/) | The installation entrypoint that composes the OpenCrane apps and the four deployment units above into one Kubernetes release. It also owns the registered database-schema hook component. | Platform operations and release composition across all functional areas. | [`apps/_infra/deploy-k8s/platform`](../../apps/_infra/deploy-k8s/platform/) supplies shared Helm templates, deployment scripts, and cluster provisioning. [`apps/opencrane`](../opencrane/) owns the Prisma schema and server image used by the schema hook. |

## Ownership rule

Add deployment configuration here only when it belongs to a rendered workload or release
composition. Put reusable application behaviour under the matching `libs/backend/server` domain,
server-process infrastructure under `libs/server/_infra`, and Kubernetes release mechanisms under
`apps/_infra/deploy-k8s/platform`. A third-party deployment may be replaced without moving its
OpenCrane functional contract out of those libraries.
