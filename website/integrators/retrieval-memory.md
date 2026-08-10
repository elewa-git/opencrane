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
| Personal-memory selector | Selects a verified user's dataset and gateway-selected fact references for one run snapshot |
| Runtime | Proposes a memory action; never selects another user's dataset |

OpenCrane does not duplicate fact text in its product database. The catalogue records a content
digest and exact provenance only after Cognee has durably accepted the content.

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
Reads are live through the authenticated private gateway: admission freezes gateway-selected fact
references (fact id and `sha256:` content digest, never fact text) into the run snapshot, and the
compile step re-resolves each reference and verifies it against the frozen digest before inlining —
a mismatch or missing fact fails the compile closed rather than producing a partial prompt. Mid-run
memory actions still have no attempt-fenced ephemeral result channel and remain fail closed, and no
write transport is implemented.
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

Source: [`libs/backend/agents/memory/main`](https://github.com/elewa-git/opencrane/blob/main/libs/backend/agents/memory/main/README.md),
[`libs/backend/agents/personal/memory/main`](https://github.com/elewa-git/opencrane/blob/main/libs/backend/agents/personal/memory/main/README.md),
and [`libs/backend/server/infra/memory-gateway-client`](https://github.com/elewa-git/opencrane/blob/main/libs/backend/server/infra/memory-gateway-client/README.md).
