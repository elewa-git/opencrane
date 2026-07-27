# OpenCrane

## The vision

AI assistants become far more valuable when they understand how people work, can use company tools,
and can carry knowledge across conversations. At organisation scale, that also creates a difficult
governance problem: every assistant needs the right identity, context, permissions, budget, and
approval boundaries without exposing one person's work to another.

OpenCrane is a self-hosted control plane for organisational AI. It gives employees durable personal
assistants and lets organisations create shared agents for scheduled or triggered work, while the
organisation remains in control of its data, skills, tools, models, and audit history.

## Why OpenCrane

Vendor-hosted assistants are convenient, but they place proprietary workflows, conversations, and
company knowledge inside another company's platform. They can also tie an organisation's skills and
operating model to one model provider.

OpenCrane keeps the organisational layer on infrastructure you control:

- employee conversations, files, personas, and memory remain private to their authorised users;
- company knowledge, integrations, skills, and agent definitions remain organisation-owned;
- model providers and credentials can change without rebuilding the assistant product;
- budgets, approvals, access decisions, and activity are governed in one place; and
- each organisation runs within its own isolated boundary.

## Meet OpenCrane

OpenCrane gives every employee a durable assistant rather than a long-running personal server.
Conversations, messages, run inputs, events, approvals, and files are recorded by the control plane.
When work needs to run, OpenCrane starts an isolated, short-lived Job for that attempt and removes it
when the attempt finishes.

The same foundation supports personal and managed agents:

- **Personal assistants** work for one employee and can use only that person's approved context,
  tools, skills, and files.
- **Managed agents** perform bounded organisation, department, team, or project work on a schedule or
  trigger, under their own narrowly scoped identity.
- **Durable conversations** keep an ordered history that can be replayed after a reconnect without
  making the browser or runtime the source of truth.
- **Governed actions** pause for approval when required and record the exact action and outcome.
- **Versioned assets and skills** preserve which input or capability a run used, even after a newer
  version is published.
- **Organisation memory** makes permitted company knowledge available without granting broad access
  to private employee data.

## How it works

Each organisation is represented by a **ClusterTenant**, the organisation-level isolation boundary.
Its OpenCrane installation combines:

- a control plane that owns identity, agent definitions, conversations, runs, approvals, access,
  budgets, audit, and schedules;
- one isolated Job for each agent run attempt;
- a channel proxy that authenticates inbound browser and channel traffic before it reaches runtime
  authority; and
- shared organisation services for models, tools, memory, artifacts, and telemetry.

The runtime receives one frozen input snapshot, reports ordered events back to OpenCrane, and has no
durable authority of its own. An employee's assistant therefore survives worker replacement and
scaling without turning a Pod or browser session into the product record.

See the illustrated [architecture overview](https://opencrane.ai/advanced/architecture) for the
reader-facing system view.

## Components

| Path | What it is |
| --- | --- |
| [`apps/opencrane/`](apps/opencrane/) | The authenticated REST API and control-plane composition root. |
| [`apps/opencrane-ui/`](apps/opencrane-ui/) | The organisation administration and employee web interface. |
| [`apps/channel-proxy/`](apps/channel-proxy/) | The inbound channel trust boundary. |
| [`apps/agent-controller/`](apps/agent-controller/) | The controller that assigns and releases isolated runtime Jobs. |
| [`apps/agent-runtime/`](apps/agent-runtime/) | The outbound-only process that performs one run attempt. |
| [`apps/managed-agent-runtime/`](apps/managed-agent-runtime/) | The isolated runtime plane for scheduled and triggered managed agents. |
| [`apps/artifact-service/`](apps/artifact-service/) | The service that receives and promotes governed artifact bytes. |
| [`apps/artifact-preprocessor/`](apps/artifact-preprocessor/) | The bounded document-extraction worker. |
| [`apps/skill-authoring/`](apps/skill-authoring/) | The isolated Job plane for candidate skill authoring. |
| [`apps/tool-runner/`](apps/tool-runner/) | The isolated Job plane for governed tool execution. |
| [`apps/_infra/`](apps/_infra/) | Deployment wrappers for PostgreSQL, Cognee, LiteLLM, Obot, Langfuse, and the Kubernetes release. |
| [`libs/backend/`](libs/backend/) | Server, agent, artifact, channel, and runtime capabilities. |
| [`libs/frontend/`](libs/frontend/) | Reusable web features, elements, platform services, and state adapters. |
| [`libs/contracts/`](libs/contracts/) | Shared API contracts and the generated TypeScript client. |
| [`website/`](website/) | The VitePress documentation site published at opencrane.ai. |

## Documentation

The full documentation is at [opencrane.ai](https://opencrane.ai), including:

- [getting started](https://opencrane.ai/guide/getting-started);
- the [architecture overview](https://opencrane.ai/advanced/architecture);
- the [deployment guide](https://opencrane.ai/guide/deploy-cluster);
- the [MCP integration guide](https://opencrane.ai/integrators/mcp-gateway); and
- the [API overview](https://opencrane.ai/reference/api-overview).

Repository contributors should start with [`AGENTS.md`](AGENTS.md). Capability history lives in
[`CHANGELOG.md`](CHANGELOG.md), while completed implementation history and design context live in
[`plan-done.md`](plan-done.md).

## Quick start

### Prerequisites

- Node.js 22 or newer
- Kubernetes 1.30 or newer
- Helm 3
- `kubectl`
- a CloudNativePG operator in the target cluster

### Build and test

```bash
npm ci
npm run build
npm run test
```

### Deploy an organisation

The deployment entrypoint installs one isolated organisation boundary. Before running it, create
the PostgreSQL credential Secrets named in the command and configure the organisation's OpenID
Connect (OIDC) identity provider.

```bash
export OIDC_ISSUER_URL="https://identity.example.com"
export OIDC_CLIENT_ID="opencrane-acme"
export OIDC_REDIRECT_URI="https://acme.opencrane.example/api/v1/auth/callback"

apps/_infra/deploy-k8s/deploy.sh \
  --base-domain opencrane.example \
  --cluster-tenant acme \
  --postgres-credentials-secret opencrane-postgres-bootstrap \
  --obot-postgres-credentials-secret opencrane-obot-postgres-bootstrap \
  --litellm-postgres-credentials-secret opencrane-litellm-postgres-bootstrap \
  --langfuse-postgres-credentials-secret opencrane-langfuse-postgres-bootstrap
```

This installs the isolated `acme` ClusterTenant organisation boundary and serves its UI and REST API at
`https://acme.opencrane.example`. The API is rooted at `/api/v1`; the generated OpenAPI document and
interactive reference are linked from the [API documentation](https://opencrane.ai/reference/api).

For deployment profiles, required Secrets, and local cluster setup, follow the
[cluster deployment guide](https://opencrane.ai/guide/deploy-cluster).

## Licence

OpenCrane is available under the [MIT licence](LICENSE).
