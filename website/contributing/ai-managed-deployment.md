# Letting an AI agent manage your deployment

The deploy path described in [Deploying](/contributing/deploying) is scriptable end to end,
which makes it a good fit for an agent-run loop. This page covers the credential convention that
keeps that safe, and the agent that uses it.

> See also: [Deploying](/contributing/deploying) (the scripts the agent runs), [The CI pipeline](
> /contributing/ci-pipeline) (what must be green before an agent deploys), and
> [Versions and migrations](/contributing/versions-and-migrations) (what the agent must resolve
> before mutating a cluster).

The repository ships a `deploy` agent and a `/deploy-loop` skill that mutate clusters **only**
through the scripts covered in [Deploying](/contributing/deploying), and triage every failure
into a fix pull request, an issue, or a design question. The one thing an agent must never see
in plain text is a credential.

## The `keys/` convention

`keys/` at the repository root is gitignored (`/keys/*` in `.gitignore`). Put one secret per
file, named for what it is:

| File | Contents | Consumed as |
| --- | --- | --- |
| `keys/zitadel-pat` | The Zitadel service-user PAT for organisation management, once the mode-scoped credential lands 🔶 | Standalone silos get a full-org credential; fleet-mode silos get a claims-only one |

::: warning
`keys/zitadel-pat` describes an upcoming credential shape, not something the deploy scripts
consume today. Treat it as an intended destination for the mode-scoped Zitadel credential, not a
currently wired flag.
:::

## The custody rule

The agent reads a key file straight into the environment of the one command that needs it, and
never echoes it, logs it, or passes it as a command argument. Provider keys are deliberately outside
this convention: an authenticated operator admits them after deployment through the durable
provider workflow, never through the deploy command.

Everything else an agent needs is already non-secret: cluster context, base domain, tenant name,
image digests from the release manifest, and the deploy ledger for cross-run memory.

## The deploy agent and `/deploy-loop`

- The **`deploy` agent** mutates a cluster only through the deploy scripts, reads whatever it
  needs for diagnosis (read-only `kubectl`, `helm status`, read-only SQL), and returns a
  structured run report.
- The **`/deploy-loop` skill** orchestrates a full run: it resolves the exact release manifest
  first — pre-1.0 that means the current database baseline and digest, not a migration path —
  spawns one `deploy` agent, then triages every finding in the report into a chart/script fix, a
  codebase issue, a data issue, or an infra/design question.

A fresh silo is one command an agent can compose, run and verify. The post-deploy report proves the
model-unconfigured control plane is healthy; configuring a provider is a separate authenticated
product action.

Source: [`.claude/agents/deploy.md`](https://github.com/elewa-git/opencrane/blob/main/.claude/agents/deploy.md)
and [`.claude/commands/deploy-loop.md`](https://github.com/elewa-git/opencrane/blob/main/.claude/commands/deploy-loop.md).
