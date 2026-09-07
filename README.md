# OpenCrane

## The vision

OpenCrane is building a company workspace where every employee has a private AI assistant and
teams can delegate repeatable work to shared agents. Assistants should understand how people work,
use the right company tools and knowledge, and carry useful context between conversations.

The organisation chooses where OpenCrane runs, which models it uses, what each assistant may
access, and which actions need a person's approval. Conversations, files and company configuration
stay under its control. Data sent to an external model provider or integration follows the
organisation's chosen configuration.

## What it does

OpenCrane brings five things together:

- **People and teams:** company membership and permissions determine who may use or manage each resource.
- **Assistants:** a personal assistant works privately for one employee; a shared agent is intended
  to carry out a defined company task with its own permissions.
- **Conversations:** a place to ask for work, follow progress and return to its history. An assistant
  and a conversation are different things: the assistant helps; the conversation records the work.
- **Tools, knowledge and files:** tools act in other systems, knowledge supplies context, and files
  hold inputs and results.
- **Company controls:** administrators manage access, model providers, spending limits and activity.

The intended experience is straightforward: ask for help preparing a customer meeting, let the
assistant use the company information it may access, review any proposed action, and return later
to the same work. That complete journey is the product goal; its individual capabilities have
different implementation states.

## Current development status

OpenCrane is **pre-MVP**. The 0.11 review baseline implements durable conversations, bounded personal
model turns, and inspection and recovery of conversation workspaces. These implementations are not
yet proof of a complete live customer journey. Agent-driven tool use, personal-memory workflows,
shared scheduled work and group `@agent` conversations still need product completion.

See [what is built and what remains](https://opencrane.ai/guide/status) for the current distinction,
[CHANGELOG.md](CHANGELOG.md) for capability changes, and [plan.md](plan.md) for active work.

## How the system fits together

The web workspace talks to an OpenCrane server that checks permissions and saves the work. When an
assistant needs to run, it uses an isolated conversation computer. The computer can stop and be
replaced while the conversation and saved workspace remain recoverable. Models, integrations,
memory and files have their own shared services.

The [architecture overview](https://opencrane.ai/advanced/architecture) maps these responsibilities
to the current applications and stores.

## Get started

If your organisation already runs OpenCrane, sign in at its address and follow the
[personal-assistant setup guide](https://opencrane.ai/guide/persona).

To install a development instance, start with the
[installation guide](https://opencrane.ai/guide/getting-started). It links the supported Kubernetes
setup, identity configuration and required deployment inputs. The 0.11 release installation uses a
fresh database baseline.

For local development:

```bash
npm ci
npm exec nx show projects
```

Use focused Nx build and test tasks for the part you are changing. Contributor instructions start
in [AGENTS.md](AGENTS.md); the [contributor guide](https://opencrane.ai/contributing/overview)
explains the development workflow.

## Repository map

| Path | Purpose |
|---|---|
| [apps/](apps/) | Deployable applications and installation tooling |
| [libs/](libs/) | Reusable product capabilities and shared infrastructure |
| [libs/contracts/](libs/contracts/) | Shared API and runtime contracts |
| [website/](website/) | User, operator and integrator documentation |
| [docs/adr/](docs/adr/) | Architecture decisions |

## Licence

OpenCrane is available under the [GNU Affero General Public License v3.0 or later](LICENSE).
