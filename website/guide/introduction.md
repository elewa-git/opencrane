# What is OpenCrane?

OpenCrane is a **self-hosted control plane for governed AI agents**. It gives each
organisation one place to define agents, control their capabilities and inspect every run.

Instead of trusting a long-lived assistant process, OpenCrane admits work as durable
`AgentRun` records. Each attempt executes in a bounded Kubernetes `Job`, while identity,
inputs, approvals, tool calls, cost and events remain under control-plane authority.

## Why teams choose OpenCrane

- **Private by design** — data and execution remain on infrastructure you operate.
- **Deny by default** — agents use only explicitly granted tools, skills, knowledge and models.
- **Auditable runs** — each run freezes its revision and accepted input evidence.
- **Replaceable execution** — runtime Jobs hold no durable product authority.
- **Organisation isolation** — every request and workload stays inside a `ClusterTenant` silo.

## What you'll do here

1. [Install OpenCrane](/guide/getting-started).
2. [Set up your organisation domain](/guide/dns).
3. [Create an agent service](/guide/first-agent).
4. Add [skills](/guide/skills), [tools](/guide/tools) and
   [organisational knowledge](/guide/knowledge).
5. Apply [access rules](/guide/permissions) and [budgets](/guide/budgets).

::: tip
Start with [How OpenCrane works](/guide/how-it-works) for a short tour of the run lifecycle.
:::
