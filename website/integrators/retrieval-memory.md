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
| OpenCrane memory catalogue | Dataset identity, digest, provenance, consent and sensitivity metadata |
| Run input compiler | Selects authorised memory evidence for one run snapshot |
| Runtime | Proposes a memory action; never selects another user's dataset |

OpenCrane does not duplicate fact text in its product database. Its planned write contract records a
content digest and exact provenance only after Cognee has durably accepted the content.

## Personal dataset binding

A personal memory dataset resolves from the verified `(silo, organisation, subject)` tuple.
The browser and runtime cannot supply a different dataset id. Organisation and shared datasets
are filtered through the same membership and grant authority used at run admission.

## Planned recording contract

The target write sequence is:

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

::: info Current transport status
The catalogue, dataset resolver and provenance rules are implemented. An authenticated private
gateway and read-only Cognee client are also built, but the production external-action composition
does not use them: runtime recall has no attempt-fenced ephemeral result channel. Reads and writes
therefore remain fail closed, and no write transport is implemented.
:::

::: tip
The catalogue and its event commit atomically. OpenCrane cannot claim that a fact exists when
its governance record was not accepted.
:::

## Retrieval during a run

The control plane freezes the memory query policy and selected memory facts in the
`RunInputSnapshot`. When runtime recall is connected, further memory reads or writes must remain
governed external actions subject to the same approval, receipt and audit boundaries as other tools.

## Failure posture

- An unresolved personal dataset is denied.
- Missing or ambiguous provenance is denied.
- A retired dataset or conflicting correction is denied.
- An unavailable memory transport does not fabricate a result.
- Runtime-local scratch is never promoted to durable memory implicitly.

Source: [`libs/backend/agents/personal/memory/main`](https://github.com/italanta/opencrane/blob/main/libs/backend/agents/personal/memory/main/README.md)
and [`libs/backend/_server/memory-gateway-client`](https://github.com/italanta/opencrane/blob/main/libs/backend/_server/memory-gateway-client/README.md).
