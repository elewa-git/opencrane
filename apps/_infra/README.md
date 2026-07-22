# Deployment infrastructure

`apps/_infra` contains deployment-only applications and the Kubernetes release composer. These
projects own third-party version pins, Helm resources, workload identity, network policy, storage,
and deployment smoke contracts. They do not own OpenCrane business rules: the functional libraries
listed below own how the product uses each service.

## Service map

| Deployment | What OpenCrane uses it for | Functional areas | OpenCrane integration owners |
|---|---|---|---|
| [`cognee`](./cognee/) | Durable organisation memory, indexed knowledge, dataset membership, and retrieval permissions. | Knowledge and memory; authorization and sharing. | [`libs/backend/server/reporting/awareness`](../../libs/backend/server/reporting/awareness/main/), [`grants`](../../libs/backend/server/iam/grants/main/), [`policies`](../../libs/backend/server/iam/policies/main/), and [`contract`](../../libs/backend/server/tenancy/contract/main/). Temporary Cognee identity/bootstrap code remains in the [`feat-openclaw-tenant` deletion boundary](../../libs/backend/feat-openclaw-tenant/main/). |
| [`litellm`](./litellm/) | The model gateway for provider credentials, model registration and routing, tenant keys, budgets, and spend accounting. | Models and economics; tenant runtime access. | [`libs/backend/server/gateways/model-routing`](../../libs/backend/server/gateways/model-routing/main/), [`providers`](../../libs/backend/server/gateways/providers/main/), [`spend`](../../libs/backend/server/reporting/spend/main/), and [`tenants`](../../libs/backend/server/tenancy/tenants/main/). |
| [`obot`](./obot/) | MCP credential custody and the gateway through which agents reach external tools. | Tools and integrations; effective runtime contracts. | [`libs/backend/server/gateways/mcp`](../../libs/backend/server/gateways/mcp/main/) owns MCP registration and custody metadata; [`contract`](../../libs/backend/server/tenancy/contract/main/) renders the effective tool surface. |
| [`langfuse`](./langfuse/) | Self-hosted model-execution telemetry and product-facing routing metrics. | Model operations and observability. | [`libs/backend/server/gateways/model-routing`](../../libs/backend/server/gateways/model-routing/main/) owns the Langfuse metrics adapter. Shared tracing primitives remain in [`libs/observability`](../../libs/observability/). |
| [`deploy-k8s`](./deploy-k8s/) | The installation entrypoint that composes the OpenCrane apps and the four deployment units above into one Kubernetes release. | Platform operations and release composition across all functional areas. | [`apps/_infra/deploy-k8s/platform`](../../apps/_infra/deploy-k8s/platform/) supplies shared Helm templates, deployment scripts, and cluster provisioning. [`apps/opencrane`](../opencrane/) owns the target database baseline; [`apps/postgres`](../postgres/) applies it during clean CNPG setup. |

## Ownership rule

Add deployment configuration here only when it belongs to a rendered workload or release
composition. Put reusable application behaviour under the matching `libs/backend/server` domain,
server-process infrastructure under `libs/server/_infra`, and Kubernetes release mechanisms under
`apps/_infra/deploy-k8s/platform`. A third-party deployment may be replaced without moving its
OpenCrane functional contract out of those libraries.
