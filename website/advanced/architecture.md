# Architecture

OpenCrane keeps a **saved company workspace** separate from the temporary computers that help
with the work. People use conversations; the server checks access, coordinates assistants and
saves accepted results.

> See also: [What is OpenCrane?](/guide/introduction) (the product) ·
> [Conversation computers](/integrators/agent-runtime) (execution and recovery contracts) ·
> [Development status](/guide/status) (implemented, tested and live)

## The system at a glance

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
                         │ requests the next step  │
                         │ and holds the workspace │
                         └─────────────────────────┘
```

The arrows show coordination. The server consumes activation requests and authorises a claim
before Agent Sandbox creates compute. KurrentDB stores evidence; it does not make permission
decisions. The computer asks the server for the next step and receives status. Model input and keys
stay on the server.

## One request through the system

1. **Save the request.** A participant posts a message in an authorised conversation. A personal
   assistant request, or an explicit company-assistant request from a group, can start assistant work.
2. **Set its limits.** The server checks current membership and grants, then records the assistant's
   configuration, conversation input, model, permitted tools and budget for that task.
3. **Prepare a computer.** Agent Sandbox starts or replaces the temporary computer admitted for the
   conversation. Its current lease prevents a replaced computer from submitting new work.
4. **Ask the model.** The server records each request before calling the configured model. The
   current continuation can use one permitted tool that needs no approval and return its checked
   result to one final model request.
5. **Save the answer.** The server stores the answer before posting its history entry. A restart can
   finish that same saved answer. If a paid response was lost before it could be saved, OpenCrane
   keeps the request pending instead of silently sending it again.
6. **Return to the work.** The browser reads the authorised history and recent personal activity.
   Tool phase and overall work status are separate; a received tool result is not a completed answer.

This describes implemented responsibilities. It does not establish that every step has been
installed and proved against a real integration; the [status page](/guide/status) records that boundary.

## What each part owns

| Part | Responsibility and source owner |
|---|---|
| Web workspace | Conversations, input, saved history and review, in `apps/opencrane-ui` and `libs/frontend`. |
| Product server | Current access checks and coordination of work, composed by `apps/opencrane` from backend libraries. |
| PostgreSQL | Current memberships, groups, grants, assistant configuration, transactional records and conversation read projections. Private message content is stored separately from immutable history. |
| KurrentDB | Ordered conversation history, computer lifecycle evidence, private turn decisions and durable activation delivery. History references encrypted message content. |
| Conversation compute | `apps/conversation-computer` requests server-owned steps and provides workspace review. `apps/_infra/agent-sandbox` supplies the admitted profile; the upstream Agent Sandbox controller owns Pod lifecycle. |
| Models | LiteLLM routes requests to the organisation's configured providers and brokers scoped credentials. Providers may be external. |
| Tools | The MCP catalogue, server-side action authority and `apps/mcp-executor` own tool definitions, permission checks and isolated execution. Accepted proposals and executor work commit together in PostgreSQL. |
| Memory | `apps/memory-gateway` fronts Cognee; OpenCrane owns metadata and permission decisions. The complete personal-memory journey remains unfinished. |
| Files | The artifact catalogue, `apps/artifact-service`, scanner and preprocessor own stored files and processing. Computer workspace checkpoints use ArtifactStore. |

The [repository map](https://github.com/elewa-git/opencrane/blob/main/README.md#repository-map)
links these source locations. The [runtime guide](/integrators/agent-runtime) explains the exact
request reservations, result acknowledgement and restart rules.

## Personal and shared work

A personal assistant uses the employee's approved settings and the current conversation. Personal
memory is explicitly unavailable until dataset provisioning and recall are complete.

A **company assistant** is a shared assistant with its own published configuration and permissions.
A person selects **Ask company assistant** on one of their group messages. OpenCrane creates a linked
assistant conversation with a fixed audience; ordinary group messages do not start the assistant.
The requester must retain access to the conversation, while the assistant must hold its own model
and tool permissions. An administrator can assign company tools through the API.

Members need current access to both the group and linked conversation before reading the work.
The person sharing a result reviews and edits it, then posts it back under their own name.
Rejoining a group does not reveal older linked requests beyond the participant's access boundary.
Scheduled work and autonomous delegation between assistants remain planned.

## Why work survives a computer

The conversation and its logical computer have durable identities. A Kubernetes Pod is temporary;
its lease identifies the one generation currently allowed to work. The browser and Pod can disappear
without becoming the only copy of the conversation. Checkpoint and restore preserve workspace bytes
across computer replacement.

PostgreSQL remains the only current authorisation authority. A saved grant decision or historical
membership is evidence of the past, not permission to act now. Models and computers cannot grant
themselves extra access.

Each organisation has its own installation boundary. Its identity, databases, storage and network
controls restrict access within and across installations. An external model or integration can
receive the data required by an authorised request; self-hosting OpenCrane does not make that
provider local.

## Architecture and qualification

[ADR 0016](https://github.com/elewa-git/opencrane/blob/main/docs/adr/0016-conversation-history-and-computers.md)
is the architecture of record for the fresh 0.11 baseline. KurrentDB owns conversation history and
Agent Sandbox owns Pod lifecycle; there is no parallel OpenCrane Pod controller.

The [status page](/guide/status) holds the current test and installation evidence, including the
remaining tool-retrieval, approval, memory, file-output and recovery journeys. Deployment procedures
belong in [deployment configuration](/operators/deployment-configuration) and the
[operator runbook](/operators/runbook).
