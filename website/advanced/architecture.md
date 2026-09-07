# Architecture

OpenCrane separates the **saved company workspace** from the computers that execute assistant work.
This page maps the current 0.11 owners; [the introduction](/guide/introduction) explains the product
without implementation detail.

> See also: [Conversation computers](/integrators/agent-runtime) (execution and review) ·
> [Central authorisation](/integrators/authorization-authority) (permission checks) ·
> [Development status](/guide/status) (implementation and qualification)

## The current system

```text
                       ┌────────────────────────────┐
                       │ Web workspace              │
                       │ conversations and review   │
                       └──────────────┬─────────────┘
                                      │ authenticated requests
                       ┌──────────────▼─────────────┐
                       │ OpenCrane server           │
                       │ checks access, admits work │
                       │ and saves accepted results │
                       └──────────────┬─────────────┘
                                      │
           ┌──────────────────────────┼──────────────────────────┐
           │                          │                          │
┌──────────▼───────────┐  ┌───────────▼────────────┐  ┌──────────▼───────────┐
│ PostgreSQL           │  │ KurrentDB              │  │ Shared services     │
│ membership, grants   │  │ conversation/computer  │  │ models, tools,      │
│ and product records  │  │ history and activation │  │ memory and files    │
└──────────────────────┘  └───────────┬────────────┘  └──────────────────────┘
                                      │ server admits a claim
                         ┌────────────▼────────────┐
                         │ Agent Sandbox           │
                         │ starts/replaces compute │
                         └────────────┬────────────┘
                                      │
                         ┌────────────▼────────────┐
                         │ Conversation computer   │
                         │ model turn, workspace   │
                         │ and private review      │
                         └─────────────────────────┘
```

The arrows show responsibility and coordination. The server consumes the activation queue and
authorises a claim before Agent Sandbox creates compute; KurrentDB does not make permission
decisions. The conversation computer calls the model through LiteLLM and returns proposed output
to the server.

## What each part owns

| Part | Current owner and responsibility |
|---|---|
| Web workspace | `apps/opencrane-ui` and `libs/frontend`: conversations, input, history and computer review. |
| Product server | `apps/opencrane` composes the backend libraries. They check current access, admit work and persist protected changes. |
| PostgreSQL | Current memberships, groups, grants, agent configuration, transactional product records and rebuildable conversation directory/read projections. Private message payloads are stored separately from immutable history. |
| KurrentDB | Ordered `conversation-{id}` history, computer lifecycle evidence and durable activation delivery. History entries reference encrypted message payloads. |
| Conversation compute | `apps/conversation-computer` performs bounded model work and provides a private workspace-review gateway. `apps/_infra/agent-sandbox` owns the admitted profile; the upstream Agent Sandbox controller owns Pod lifecycle. |
| Models | LiteLLM routes requests to configured providers and brokers scoped model credentials. Providers may be external to the organisation. |
| Tools | The MCP catalogue, server-side action authority and `apps/mcp-executor` govern immutable tool packages and isolated execution. Connecting them to the conversation model loop remains product work. |
| Memory | `apps/memory-gateway` fronts Cognee; OpenCrane owns the metadata and permission decisions. Complete personal-memory journeys remain unfinished. |
| Files | The artifact catalogue, `apps/artifact-service`, scanner and preprocessor own stored files, validation and processing. Computer workspace checkpoints use ArtifactStore. |

Source paths are relative to the repository root. The
[repository map](https://github.com/elewa-git/opencrane/blob/main/README.md#repository-map)
links the applications and libraries.

## One conversation, recoverable compute

Every conversation has ordered history. An assistant conversation also has one logical computer.
Its temporary Pod may be idle, active or absent. A lease identifies the one currently admitted
computer generation, so a replaced Pod cannot continue submitting work as its successor.

The server checks current membership and grants in PostgreSQL before protected operations.
KurrentDB records history and lifecycle evidence. A historical permission decision is not current
permission.

Checkpoint and restore preserve the computer's workspace across cooling and replacement.
Conversation history does not depend on the Pod or browser surviving. Ordinary direct and group
messages do not activate an assistant computer.

## Isolation and external actions

Each organisation has its own installation boundary. Identity, database, storage and network
controls restrict access within and across those boundaries. An assistant cannot grant itself
additional tools or read another person's private work just because it shares infrastructure.

Tool execution is a separate governed service. The intended model loop proposes actions for the
server to check and execute; that loop is not yet connected in the current personal-conversation
runtime. Shared-agent scheduling and group `@agent` child conversations are also unfinished.

## Baseline and evidence

[ADR 0016](https://github.com/elewa-git/opencrane/blob/main/docs/adr/0016-conversation-history-and-computers.md)
is the architecture of record for 0.11. It supersedes the run-owned warm-Pod lifecycle and
PostgreSQL transcript. OpenCrane does not add another Kubernetes Pod controller beside Agent Sandbox.

Implemented recovery and backup machinery still needs the live drills listed in
[development status](/guide/status). Operator inputs and procedures belong in
[deployment configuration](/operators/deployment-configuration) and the [runbook](/operators/runbook).
