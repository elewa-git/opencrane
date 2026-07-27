# How OpenCrane works

OpenCrane separates **durable control** from **replaceable execution**. The control plane
decides what may run; bounded runtime Jobs perform only the admitted work.

## The big picture

```text
person or schedule
       │
       ▼
OpenCrane control plane
       │  admit and freeze
       ▼
AgentRun + RunInputSnapshot
       │  assign one attempt
       ▼
bounded runtime Job ──► ordered events and governed actions
```

## The words you'll see

### Agent service

A governed agent definition. Its immutable revisions bind the persona, model posture,
skills and other configuration used by a run. → [Create one](/guide/first-agent)

### Agent run

The durable record of one invocation. It carries its state, attempt number, frozen input
digest, lineage, cost and terminal reason. A retry creates another attempt on the same run.

### Skill

A reusable, versioned capability published through the skill catalogue.
→ [Manage skills](/guide/skills)

### Tool

An external action exposed through MCP or another governed executor. The runtime proposes
the action; the control plane authorises and records it. → [Manage tools](/guide/tools)

### Organisational knowledge

Information retrieved from organisation-scoped and personal memory datasets, with provenance
and access policy applied by the control plane. → [Connect knowledge](/guide/knowledge)

### ClusterTenant

The customer organisation and isolation boundary. It is not an individual assistant or user.
→ [Organisation boundary](/operators/organisation-boundary)

## What happens when work starts

1. OpenCrane authenticates the caller and resolves the organisation.
2. It checks membership, grants, model posture and budget.
3. It freezes accepted evidence into a `RunInputSnapshot`.
4. The controller creates and releases the exact runtime Job for that attempt.
5. The runtime streams normalised candidates back to OpenCrane.
6. OpenCrane persists events before delivery and keeps tool execution under its own authority.
7. A terminal outcome closes the run; the Job can disappear without losing the record.

Ready? → [Install OpenCrane](/guide/getting-started)
