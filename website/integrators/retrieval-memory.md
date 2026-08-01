# Retrieval and memory

OpenCrane keeps **durable memory content in Cognee** and **governance metadata in its own
authority**. A runtime can request memory actions only through the control plane.

> See also: [Silo IAM](/integrators/silo-iam) (scope and grants),
> [Governed agent runtime](/integrators/agent-runtime) (action custody), and
> [MCP gateway](/integrators/mcp-gateway) (external tools).

## Responsibility split

| Component | Responsibility |
|---|---|
| Cognee | Durable memory content and retrieval |
| OpenCrane agent-memory catalogue | Dataset identity, digest, provenance, consent and sensitivity metadata |
| Personal-memory selector | Selects a verified user's dataset and explicit preference-fact coordinates |
| Runtime | Proposes a memory action; never selects another user's dataset |

OpenCrane does not duplicate fact text in its product database. The catalogue can record a content
digest and exact provenance only after Cognee has durably accepted the content.

## Personal dataset binding

A personal memory dataset resolves from the verified `(silo, organisation, subject)` tuple.
The browser and runtime cannot supply a different dataset id. Organisation and shared datasets
are filtered through the same membership and grant authority used at run admission.

## Recording a fact

```text
authorised memory action
       │
       ▼
Cognee accepts content
       │  external id + digest + provenance
       ▼
OpenCrane commits catalogue row + outbox event
```

Exactly one provenance source is required: an artifact revision, a conversation message or an
explicit user statement. Explicit statements must identify the same authenticated author as
the target personal dataset.

::: info Current composition status
The catalogue/outbox and personal-dataset selection boundaries are implemented, but personal run
admission does not compose them yet. The current external-action composition also injects an
unavailable memory-gateway client, so runtime Cognee reads and writes fail closed until an
authenticated transport and personal-admission composition are mounted.
:::

::: tip
The catalogue and its event commit atomically. OpenCrane cannot claim that a fact exists when
its governance record was not accepted.
:::

## Retrieval during a run

The control plane freezes the memory query policy and selected memory facts in the
`RunInputSnapshot`. Further memory reads or writes appear as governed external actions and are
subject to the same approval, receipt and audit boundaries as other tools.

## Failure posture

- An unresolved personal dataset is denied.
- Missing or ambiguous provenance is denied.
- A retired dataset or conflicting correction is denied.
- An unavailable memory transport does not fabricate a result.
- Runtime-local scratch is never promoted to durable memory implicitly.

Source: [`libs/backend/agents/memory/main`](https://github.com/elewa-git/opencrane/blob/main/libs/backend/agents/memory/main/README.md),
[`libs/backend/agents/personal/memory/main`](https://github.com/elewa-git/opencrane/blob/main/libs/backend/agents/personal/memory/main/README.md),
and [`libs/server/_infra/memory-gateway-client`](https://github.com/elewa-git/opencrane/blob/main/libs/server/_infra/memory-gateway-client/README.md).
