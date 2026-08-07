# Governed AI agents on your infrastructure

OpenCrane is a **self-hosted platform for AI agents**, running on your own Kubernetes cluster, that
keeps identity, tools, approvals, cost and evidence under your authority — not a vendor's.

## Personal assistants and managed agents

- **Your personal assistant** works for you alone — only your granted tools, files and knowledge,
  only acting as you. → [Set up your personal assistant](/guide/persona)
- **A managed agent** is a shared worker your organisation configures for bounded, scheduled or
  triggered work, under its own narrow identity — never inheriting anyone's personal access.
  → [Create a managed agent](/guide/first-agent)

## Disposable execution, durable record

```text
define an agent (personal or managed)
      │
      ▼
admit a run — freeze exactly what it may use
      │
      ▼
execute in one disposable, bounded Job
      │
      ▼
inspect the ordered events, actions and outcome
```

The container that runs your agent's work can be replaced or disappear; the record of what it was
allowed to use and what it did stays with OpenCrane.

## Build useful agents

- Publish reusable [skills](/guide/skills).
- Connect governed [tools](/guide/tools).
- Add [organisational knowledge](/guide/knowledge).
- Apply [access rules](/guide/permissions).
- Set [budgets](/guide/budgets) and review [audit evidence](/guide/audit).

## Start

→ [See how OpenCrane works](/guide/how-it-works) ·
[Install OpenCrane](/guide/getting-started) ·
[Set up your personal assistant](/guide/persona)
