# Governed AI agents on your infrastructure

OpenCrane is a **self-hosted Kubernetes control plane** for defining agents, admitting
their work and keeping identity, tools, approvals, cost and evidence under your authority.

## Durable control, bounded execution

```text
define an agent
      │
      ▼
admit an AgentRun
      │
      ▼
execute one bounded Job attempt
      │
      ▼
inspect ordered events, actions and outcome
```

OpenCrane keeps the durable run record in the control plane. Runtime Jobs are isolated,
short-lived execution details with no direct tool credentials or persistent user volume.

## Build useful agents

- Publish reusable [skills](/guide/skills).
- Connect governed [tools](/guide/tools).
- Add [organisational knowledge](/guide/knowledge).
- Apply [access rules](/guide/permissions).
- Set [budgets](/guide/budgets) and review [audit evidence](/guide/audit).

## Start

→ [See how OpenCrane works](/guide/how-it-works) ·
[Install OpenCrane](/guide/getting-started) ·
[Create your first agent](/guide/first-agent)
