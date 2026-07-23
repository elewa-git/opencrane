# OpenCrane Platform

## The Vision: AI Skills for Every Employee

AI agent skills are transforming how organizations build AI workflows. Tools like [OpenClaw](https://github.com/openclaw/openclaw) and Hermes are creating a new experience: a **personal AI assistant for every employee**. They learn your work patterns, integrate with your tools, and automate your most repetitive tasks—without requiring you to write a single line of code.

At the individual level, these tools work beautifully. One person, one assistant, endless possibilities.

**But what happens when you scale?** How do you give every member of your organization their own intelligent assistant? How do you share skills across teams? How do you manage context across different employees/projects/departments, and extend the agentic loop's context search with this information? How do you share context from the individual to the team? How do you keep them secure, compliant, and up-to-date? How do you prevent chaos?

## Why OpenCrane? The Risk of Vendor-Hosted Solutions

Existing vendor-hosted AI platforms (like Claude Cowork and OpenAI's emerging skills solutions) offer convenience, but at a hidden cost: **existential risk**. Here's why self-hosting your AI organization matters:

**The Problem with Vendor-Hosted Skills:**
- **Vendor becomes your competitor**: When you build and host skills on any vendor platform, that vendor learns your workflows, best practices, and domain expertise. They can commercialize this knowledge or offer it to your competitors.
- **Loss of competitive advantage**: Your proprietary skills—the institutional knowledge that differentiates you—are indexed, analyzed, and potentially shared or monetized by the host.
- **Pricing lock-in**: Vendors can unilaterally change pricing, restrict features, or discontinue services. You have no fallback; your skills are stuck in their ecosystem.
- **Data governance nightmare**: Personal conversations between employees and AI are potentially visible to the vendor. Regulatory compliance (GDPR, HIPAA, SOC 2) becomes uncertain when your data lives in someone else's infrastructure.
- **Model switching trap**: Build your skills on Claude today, need GPT-4 tomorrow? Your skills are tightly coupled to the vendor's platform. Migration is painful or impossible.

**Why Self-Hosting Matters:**
- **You own your skills**: Proprietary workflows and knowledge stay in your control, not monetized by vendors.
- **Competitive moat**: Build institutional knowledge that's unique to your organization, unavailable to competitors.
- **True data sovereignty**: Employee conversations, company context, and organizational intelligence stay on your infrastructure—never shared with third parties.
- **Model independence**: Switch between Claude, GPT-4, open-source models, or your own without losing your skills investment.
- **Regulatory compliance**: Full audit trails, RBAC, encryption, and data residency under your control.

**The Difference:**
| Aspect | Vendor-Hosted Solutions | Self-Hosted (OpenCrane) |
|--------|------------------------|------------------------|
| **Skill ownership** | Vendor hosts & can analyze your skills | You own everything |
| **Competitive risk** | Vendor learns your workflows | Your workflows stay private |
| **Model switching** | Locked to vendor's LLM | Use any LLM provider |
| **Data residency** | Vendor's servers | Your infrastructure |
| **Regulatory control** | Vendor's terms; compliance uncertain | Full compliance under your control |
| **Pricing** | Vendor can change at will | You control infrastructure costs |

OpenCrane solves this by giving organizations a **self-hosted control plane** where personal assistants, shared skills, and organizational knowledge stay completely under your control—while still providing the convenience and scale of a cloud-native platform.

### Meet OpenCrane

OpenCrane is a **control plane for organizational AI**. It sits on top of agent frameworks and gives organizations the power to issue personal assistants to every employee while maintaining complete control over security, governance, organizational knowledge, and information access.

**Your organization stays in control:**
- **Personal assistants at scale**: Deploy a private AI assistant for every employee in minutes—each one isolated, secure, and acting on behalf of that employee.
- **One dedicated silo per organisation**: Every customer org runs its own isolated stack—dedicated operator, control plane, LLM proxy, MCP gateway, knowledge base, skill registry, and database—provisioned and managed by a central fleet. There is no shared singleton that mixes org data.
- **Vendor independence and BYOK**: Choose your LLM provider—Claude, GPT, open-source models—without lock-in. Each org sets its own provider keys (Bring Your Own Key) through the platform API; keys are stored as Kubernetes Secrets and routed only through the org's LiteLLM proxy, never written to the database.
- **Model routing and cost control**: Pin a model per skill or let the platform choose. The platform sets per-employee budgets and model allowlists, which the org's LiteLLM proxy enforces at request time; the control plane meters spend and warns as budgets approach. An eval-driven, human-gated optimisation loop surfaces "switch this skill's model to save N% at equal quality".
- **Self-hosted, data-sovereign**: Deploy OpenCrane on your infrastructure. Your organizational data—documents, conversations, collected information—stays on your network, never sent to external vendors. Shared skills are stored and versioned in your repository.
- **Security and governance**: Identity-keyed network isolation (Cilium + SPIFFE) gives every workload a cryptographic identity; each silo is default-deny. One fleet release manages identity, access control, skill deployment, cost tracking, audit, and RBAC-filtered access to organizational knowledge across all silos.
- **Organizational intelligence**: Company-wide information gathering agents harvest knowledge from your platforms—starting with Slack, with further sources connecting through the MCP gateway as they land—and make it available to assistants through retrieval plugins, with automatic role-based filtering.
- **Scale from day one**: From 10 employees to 10,000—the same Kubernetes-native architecture scales seamlessly.

## How It Works

Each employee gets their own **private AI assistant**—one continuous assistant that knows who
they are, works on their behalf, and keeps their conversations and files private. Under the
hood that assistant is a structured model with a set of durable conversations rather than a
long-lived process, so a restart or scale-down never erases the relationship.

- **Knows who you are**: Every run draws on an agent persona trained on your needs, working
  style, and communication preferences—one that keeps learning and improving the more you use
  it—plus your permitted company context, budget, and tools. The model may change between runs
  as routing or cost policy improves, but every other input is frozen for the run already
  underway, so a later policy or skill change never rewrites work in progress.
- **Stays yours**: Conversations and files are private to their owner. Team agents and
  scheduled company services run on the same foundation—without ever gaining access to a
  person's private conversations or files.
- **Never forgets a conversation**: A conversation is a thread with an ordered, durable history.
  Each message starts one recorded run, which can be safely cancelled, resumed after approval, or
  replayed in the UI without duplicate results.
- **Tools with control**: Assistants can use approved integrations, company knowledge, files, and
  governed skills. Higher-risk actions wait for the right person's approval before they happen.
- **Files that remain useful**: Uploads and generated outputs are managed as versioned assets. A
  conversation refers to a specific version of a file, which keeps sharing, history, and auditing
  clear even when newer versions are created.

OpenCrane provides the surrounding control plane: it manages assistants, access, budgets, shared
knowledge, integrations, skills, and durable assets while keeping each organisation's data in its
own silo.

See [`CHANGELOG.md`](CHANGELOG.md) for the capabilities shipped so far and [`plan-done.md`](plan-done.md) for the history behind them.

## Architecture

OpenCrane is **Kubernetes-native** and **API-first**. A central **fleet** manages
organisation lifecycle (ClusterTenant provisioning, CRDs, platform DNS, and identity
brokering). Each customer organisation runs its own **silo**: a dedicated operator,
opencrane-server, LiteLLM proxy, MCP gateway (Obot), knowledge base (Cognee), skill
registry, and database — all in an isolated namespace, with no shared data between orgs.

Within each silo:

- every employee gets **one isolated OpenClaw pod**, with its own encrypted storage;
- the silo's planes — LLM routing, MCP tools, and organizational knowledge — are
  accessed only with short-lived, scoped credentials; and
- the org host (`acme.opencrane.ai`) routes each signed-in user to their own pod
  internally — there are no per-user public subdomains.

The super-admin is the only identity that can reach across silos. Conversations stay
inside the pod — OpenCrane governs access, budgets, and networking, but never inspects
them.

A single **ClusterTenant** (one organisation, no fleet) — the manager is the whole control plane, and each employee gets an isolated pod that reaches tools through one Obot MCP gateway:

```
Legend:   [live] live today      [partial] partial / gated      [desired] desired → issue #117

                           ┌──────────────────────────────────────────────────────────┐    ┌────────────────────────────────┐
                           │ clustertenant-manager — THE control plane      [live]    │◄──►│ CNPG Postgres           [live] │
                           │ API + operator + gateway-proxy · one deployment          │    └────────────────────────────────┘
                           │ Obot config authority · MCP registry · contract API      │    ┌────────────────────────────────┐
                           └──────────────────────────────────────────────────────────┘    │ ArtifactStore CAS (PVC) [target]│
                                             │                                             └────────────────────────────────┘
                                             │  (0) config · (1) grants · (2) effective-contract → pods
                                             ▼
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Kubernetes silo namespace · opencrane-<org>                                                                                │
│                                                                                                                            │
│ Tenant runtime        (3) JWT    Obot MCP gateway                                                                          │
│ ┌───────────────────────────┐    ┌────────────────────────────────────────────────────┐                                    │
│ │ jente.oc · jane.oc        │───►│ gateway / proxy · per-call scope check    [live]   │ ──► web egress   [live]            │
│ │ niels.oc          [live]  │    │                                                    │                                    │
│ │                           │    ├────────────────────────────────────────────────────┤     NetworkPolicy egress;          │
│ │ each pod:                 │    │ hosted MCP servers (registry-pulled)   [desired]   │     Cilium FQDN [desired]          │
│ │   personal drive (PVC)    │    │   remote streamable-http today ·                   │                                    │
│ │   workload identity:      │    │   in-cluster local-run = desired                   │                                    │
│ │    SA-JWT [live]  →       │    │                                                    │                                    │
│ │    SPIFFE  [desired]      │    ├────────────────────────────────────────────────────┤                                    │
│ │                           │    │ per-user token store                   [partial]   │                                    │
│ │                           │    │   downstream creds · encrypted · pod-unreachable   │                                    │
│ └───────────────────────────┘    └────────────────────────────────────────────────────┘                                    │
│                                                                                                                            │
│                                                                                                                            │
│ Shared planes:   Cognee brain [live] · Skill registry + gate [live] ·                                                      │
│                  LiteLLM router (BYOK) [live] · Harvesting agents [live]                                                   │
│                                                                                                                            │
│ No fleet manager: for one ClusterTenant the manager IS the whole control plane.                                            │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

📐 See the illustrated **[architecture overview](https://opencrane.ai/advanced/architecture)** — diagrams of the fleet/silo model, the sign-in flow, and the deny-by-default access model.

## Components

| Component | Path | Description |
|-----------|------|-------------|
| Silo operator | `apps/opencrane/` | Per-silo control plane: headless Express REST API (`/api/v1`) + in-silo controllers; emits `openapi.json` at build time |
| Silo chart | `apps/_infra/deploy-k8s/` | Helm chart `opencrane-silo` — per-org silo: silo operator + planes (Cognee, LiteLLM, Obot, skill registry) + Langfuse + gateway. Deploy with `apps/_infra/deploy-k8s/deploy.sh`. |
| Deployment platform | `apps/_infra/deploy-k8s/platform/` | Internal Helm helper chart, deploy engine (`k8s-deploy.sh`, `configure-oidc.sh`), cluster provisioning (`provision.sh`, behind `--provision`), Terraform, value profiles, tests, and `deploy-single-tenant.sh` |
| Contracts | `libs/contracts/` | Generated TypeScript client + DTOs from `openapi.json`; used by the OpenCrane UI and external surfaces |
| Docker | `apps/*/deploy/Dockerfile` | Per-app Dockerfiles (silo operator, tenant runtime, skill registry), built and published by `.github/workflows/docker.yml` |
| Skills | `skills/shared/` | Org/team shared skill library |
| Docs site | `website/` | VitePress documentation site published to GitHub Pages |

> The fleet operator (`apps/fleet-operator/`) and fleet chart (`apps/fleet-platform/`) moved to
> the [WeOwnAI](https://github.com/elewa-git/WeOwnAI) repo (elewa-git/opencrane#150); this repo now
> hosts only the standalone silo/ClusterTenant template.

## Documentation

📖 **Full documentation site: [opencrane.ai](https://opencrane.ai)** —
getting started, concepts, operator & integrator guides, and an interactive API
reference. The site is built with [VitePress](https://vitepress.dev) from
[`website/`](website/). Contributor/agent coding guidance stays in
[`AGENTS.md`](AGENTS.md) and [`docs/agents/`](docs/agents/).

| Doc | Covers |
|-----|--------|
| [Identity & connection auth](https://opencrane.ai/security/identity) | How people sign in and how a browser connects to its assistant |
| [Connection security model](https://opencrane.ai/security/connection-security) | How OpenCrane keeps the browser↔assistant connection secure |
| [Hosting architecture](https://opencrane.ai/operators/hosting) | On-prem-default hosting adapters, the cloud seam, and cert-manager TLS issuance |
| [MCP gateway (Obot)](https://opencrane.ai/integrators/mcp-gateway) | Connecting assistants to external tools over MCP |
| [Skill registry & delivery](https://opencrane.ai/integrators/skill-registry) | Skill catalog, scan/entitle pipeline, and per-read delivery |
| [Retrieval & memory](https://opencrane.ai/integrators/retrieval-memory) | Cognee retrieval plane: datasets, AccessPolicy mapping, freshness |
| [API overview](https://opencrane.ai/reference/api-overview) · [Interactive API reference](https://opencrane.ai/reference/api) · [Runbook](https://opencrane.ai/operators/runbook) | Authentication and API conventions · live endpoint reference · operational runbook |

## Quick Start

### Prerequisites

- Node 22+
- Kubernetes 1.30+ (GKE recommended; required for stable runtime admission policy)
- Helm 3
- Terraform 1.5+ (for GCP deployment)
- PostgreSQL 15+ (Cloud SQL or local)

### Development

```bash
npm ci
npm run build
npm run test
```

### Local Deployment

The deploy scripts can provision the cluster too — `--provision local|gke|vps` creates and targets a cluster before installing (otherwise they deploy onto the current kubectl context).

```bash
# One command: provision a local k3d cluster AND install the fleet onto it.
# The fleet-platform chart's deploy.sh now lives in the WeOwnAI repo (elewa-git/opencrane#150) —
# check that out first, e.g.: ../weownai/apps/fleet-platform/deploy.sh --provision local --base-domain opencrane.local

# Add an organisation (silo) once the fleet is up:
apps/_infra/deploy-k8s/deploy.sh --cluster-tenant acme --base-domain opencrane.local
```

For fast dev iteration with locally-built images, the `apps/_infra/deploy-k8s/platform/tests/k3d-local.sh` harness (k3d + local images; `LOCAL_PROFILE=strict` for prod-style Helm validation) remains available. The `strict` profile does not emulate GCP-only capabilities (Workload Identity, GCS, External Secrets, GCE ingress, Cloud DNS) — it validates the same core wiring with stricter chart inputs locally.

### GCP Deployment

```bash
# One command: provision a GKE cluster (Terraform, internally) AND install the fleet.
# The fleet-platform chart's deploy.sh now lives in the WeOwnAI repo (elewa-git/opencrane#150) —
# check that out first, e.g.: ../weownai/apps/fleet-platform/deploy.sh --provision gke \
#   --project-id my-project --base-domain opencrane.ai

# Add a silo for an organisation (once per org)
apps/_infra/deploy-k8s/deploy.sh \
  --cluster-tenant acme --base-domain opencrane.ai

# Or provision + deploy the fleet AND one seeded org in a single pass (FLEET_CHART_DIR must
# point at a checked-out copy of WeOwnAI's apps/fleet-platform — see elewa-git/opencrane#150)
FLEET_CHART_DIR=../weownai/apps/fleet-platform \
apps/_infra/deploy-k8s/platform/deploy-single-tenant.sh --provision gke \
  --project-id my-project --base-domain opencrane.ai \
  --org-name acme --org-owner-email owner@acme.example

# Prefer to manage infra yourself? Provision with Terraform
# (apps/_infra/deploy-k8s/platform/terraform/environments/dev) and run the deploy scripts WITHOUT
# --provision against the resulting cluster.

# 3. Create a tenant via its declarative cluster contract
kubectl apply -f - <<EOF
apiVersion: opencrane.io/v1alpha1
kind: Tenant
metadata:
  name: jente
spec:
  displayName: Jente
  email: jente@example.com
EOF
```

The operator provisions everything the tenant needs — storage, identity, an encryption key, and access through the org's ingress. Employees sign in at the org host (e.g. `https://acme.opencrane.ai`); the platform routes each session to their own pod internally. See [Set up your domain](https://opencrane.ai/guide/dns) for DNS and TLS.

### API quick reference

Human operators use the OIDC browser flow; the management UI makes same-origin API requests
with its session cookie. Workload APIs use dedicated projected-token boundaries. Static API
tokens and terminal bearer-token automation are deliberately not part of this target.

See the [API overview](https://opencrane.ai/reference/api-overview) for authentication and conventions, and the [interactive API reference](https://opencrane.ai/reference/api) for the full endpoint list.

### Runtime updates

OpenClaw and its Cognee memory plugin ship together in a pinned, immutable tenant
image. Operators upgrade that image through the silo Helm release, so every rollout
and rollback restores a tested runtime/plugin pair rather than changing executable
code inside an employee's persistent storage.

## License

AGPL-3.0-or-later
