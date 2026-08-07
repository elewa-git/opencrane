# OpenCrane

## The vision

AI assistants become far more valuable when they understand how people work, can use company tools,
and can carry knowledge across conversations. At organisation scale, that creates a governance
problem: every assistant needs the right identity, context, permissions, budget, and approval
boundaries — without exposing one person's work to another.

OpenCrane is a self-hosted control plane for organisational AI. It gives every employee a durable
personal assistant, lets the organisation run shared agents for scheduled and triggered work, and
keeps the organisation in control of its data, knowledge, skills, tools, models, and audit history.

## Why OpenCrane

Vendor-hosted assistants are convenient, but they place proprietary workflows, conversations, and
company knowledge inside another company's platform, and they tie an organisation's operating model
to one model provider.

OpenCrane keeps the organisational layer on infrastructure you control:

- employee conversations, files, personas, and memory stay private to their authorised user;
- company knowledge, integrations, skills, and agent definitions stay organisation-owned;
- model providers and credentials can change without rebuilding the assistant product;
- budgets, approvals, access decisions, and activity are governed in one place; and
- each organisation runs inside its own isolated boundary.

## Two kinds of agent

Everything in OpenCrane is built around one distinction.

- **Personal assistants** work for a single employee. An assistant can see and use only that
  person's approved context, tools, skills, files, and memory. Its work is private to them, and it
  builds up an understanding of how that employee works over time.
- **Managed agents** do bounded work for the organisation, a department, a team, or a project — on a
  schedule or in response to a trigger. Each managed agent runs under its own narrowly scoped
  identity, and can never quietly inherit the person who created it, the employee who started it, or
  anyone's private memory or personal tools.

Both kinds share the same foundation: durable conversations, governed actions, versioned skills and
files, and permitted access to organisation knowledge.

## How it works

Each organisation is one isolated boundary. Inside it, a control plane holds the durable record of
everything — who the agents are, what they may do, and everything they have done. When an agent
needs to act, OpenCrane spins up a short-lived, isolated agent runtime for that single task, hands it
one frozen snapshot of its input, and removes it when the task finishes. The runtime streams its
progress back to the control plane but holds no authority of its own, so an assistant survives
restarts, scaling, and a closed browser tab without ever becoming the source of truth.

```text
        Employees                                              Schedules & triggers
            │                                                           │
            │                                                           │
╔═══ YOUR ORGANISATION — one isolated boundary ═════════════════════════════════════════════════════╗
║           │                                                           │                           ║
║           │                                                           │                           ║
║           ▼                                                           ▼                           ║
║   ┌─────────────────────────┐  ┌─────────────────────────┐   ┌───────────────────────────────┐    ║
║   │ Personal assistant      │  │ identity adjusted       │   │ Managed agent                 │    ║
║   │ private to one          │╌╌│ to the employee         │   │ bounded, scoped work          │    ║
║   │ employee                │  │ (per-person sidecar)    │   │ own scoped identity           │    ║
║   └─────────────────────────┘  └─────────────────────────┘   └───────────────────────────────┘    ║
║                │                                                             │                    ║
║                └─────────────────┬───────────────────────────────────────────┘                    ║
║                                  ▼                                                                ║
║           ┌─────────────────────────────────────────────┐    ┌─────────────────────────────────┐  ║
║           │           OpenCrane control plane           │    │ Shared organisation services    │  ║
║           │       identity · conversations · tasks      │    │ maintained centrally,           │  ║
║           │     approvals · budgets · access · audit    │    │ outside the agents              │  ║
║           └─────────────────────────────────────────────┘    │                                 │  ║
║               runs a           │   ▲   progress              │  • Models                       │  ║
║                task            │   │                         │  • Tools                        │  ║
║                                ▼   │                         │  • Memory & knowledge           │  ║
║           ┌─────────────────────────────────────────────┐    │  • Files & artifacts            │  ║
║           │                Agent runtime                │uses│                                 │  ║
║           │     isolated & short-lived · one task ·     │───▶│                                 │  ║
║           │           keeps no standing access          │    │                                 │  ║
║           └─────────────────────────────────────────────┘    └─────────────────────────────────┘  ║
║                                                                                                   ║
║                                                                                                   ║
╚═══════════════════════════════════════════════════════════════════════════════════════════════════╝
```

The control plane governs the parts that must be consistent across every agent:

- **Durable conversations** keep an ordered history that replays after a reconnect, instead of
  trusting the browser or the runtime to remember.
- **Governed actions** pause for approval when a step needs it, and record the exact action taken and
  its outcome.
- **Versioned skills and files** preserve which capability or input a task actually used, even after a
  newer version is published.
- **Organisation memory** makes permitted company knowledge available to an agent without granting it
  broad access to any employee's private data.
- **Budgets and audit** track spend and activity in one place, per agent and per organisation.

See the illustrated [architecture overview](https://opencrane.ai/advanced/architecture) for the
full reader-facing system view.

## What an organisation admin configures

An agent's reach is set once, centrally, by an organisation admin — never by the agent or the
person using it. Each setting becomes part of the effective contract OpenCrane freezes into a task
before its agent runtime starts, so changing a policy shapes future tasks and never rewrites one
already running.

```text
                                       ┌───────────────────┐
                                       │ Organisation admin│
                                       │                   │
                                       └───────────────────┘
                                                 ▼
╔═══ OpenCrane control plane — what an organisation admin configures ═════════════════════════════╗
║                                                                                                 ║
║  ┌───────────────────────────────────────────┐   ┌───────────────────────────────────────────┐  ║
║  │ People & access                           │   │ Agents & skills                           │  ║
║  │ employees · departments · teams ·         │   │ managed agent definitions & revisions     │  ║
║  │ projects · who may use what (grants)      │   │ schedules · triggers · published skills   │  ║
║  └───────────────────────────────────────────┘   └───────────────────────────────────────────┘  ║
║                                                                                                 ║
║  ┌───────────────────────────────────────────┐   ┌───────────────────────────────────────────┐  ║
║  │ Tools & integrations                      │   │ Models & providers                        │  ║
║  │ MCP tool servers · tool grants            │   │ provider keys (BYOK) · enabled models     │  ║
║  │ external integrations & approvals         │   │ model routing defaults                    │  ║
║  └───────────────────────────────────────────┘   └───────────────────────────────────────────┘  ║
║                                                                                                 ║
║  ┌───────────────────────────────────────────┐   ┌───────────────────────────────────────────┐  ║
║  │ Knowledge                                 │   │ Budgets & audit                           │  ║
║  │ organisation retrieval sources            │   │ spend caps · usage quotas                 │  ║
║  │ what agents may retrieve                  │   │ audit log (view decisions & activity)     │  ║
║  └───────────────────────────────────────────┘   └───────────────────────────────────────────┘  ║
║                                                                                                 ║
║                                                                                                 ║
╚═════════════════════════════════════════════════════════════════════════════════════════════════╝
                    compiled into the frozen contract for every task
                                                 ▼
              ┌─────────────────────────────────────────────────────────────────────┐
              │ Effective contract for one task                                     │
              │ the frozen snapshot each Agent runtime receives — no setting        │
              │ can change once the task has started                                │
              └─────────────────────────────────────────────────────────────────────┘
```

## Documentation

The complete documentation is at [opencrane.ai](https://opencrane.ai), including:

- [getting started](https://opencrane.ai/guide/getting-started);
- the [architecture overview](https://opencrane.ai/advanced/architecture);
- the [deployment guide](https://opencrane.ai/guide/deploy-cluster);
- the [MCP integration guide](https://opencrane.ai/integrators/mcp-gateway); and
- the [API overview](https://opencrane.ai/reference/api-overview).

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

The deployment entrypoint installs one isolated organisation boundary. Before running it, create the
PostgreSQL credential Secrets named in the command and configure the organisation's OpenID Connect
(OIDC) identity provider.

```bash
export OIDC_ISSUER_URL="https://identity.example.com"
export OIDC_CLIENT_ID="opencrane-acme"
export OIDC_REDIRECT_URI="https://acme.opencrane.example/api/v1/auth/callback"

apps/_infra/deploy-k8s/deploy.sh \
  --base-domain opencrane.example \
  --cluster-tenant acme \
  --postgres-credentials-secret opencrane-postgres-bootstrap \
  --obot-postgres-credentials-secret opencrane-obot-postgres-bootstrap \
  --litellm-postgres-credentials-secret opencrane-litellm-postgres-bootstrap
```

This installs the isolated `acme` organisation boundary and serves its UI and REST API at
`https://acme.opencrane.example`. The API is rooted at `/api/v1`; the generated OpenAPI document and
interactive reference are linked from the [API documentation](https://opencrane.ai/reference/api).

For deployment profiles, required Secrets, and local cluster setup, follow the
[cluster deployment guide](https://opencrane.ai/guide/deploy-cluster).

## Repository layout

For a two-minute orientation: application deployables live under [`apps/`](apps/), reusable
capabilities under [`libs/`](libs/), shared API contracts under [`libs/contracts/`](libs/contracts/),
and the documentation site under [`website/`](website/).

Repository contributors should start with [`AGENTS.md`](AGENTS.md). Capability history lives in
[`CHANGELOG.md`](CHANGELOG.md), while completed implementation history and design context live in
[`plan-done.md`](plan-done.md).

## Licence

OpenCrane is available under the [GNU Affero General Public License v3.0 or later](LICENSE).
