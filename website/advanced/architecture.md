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
                         │ workspace preparation   │
                         │ and private review      │
                         └─────────────────────────┘

KurrentDB activation ──► activation transaction ──► Absurd task
                                                      │ durable progression and waits
                                                      └──► OpenCrane server authority
```

The arrows show responsibility and coordination. The server consumes the activation queue and
authorises a claim before Agent Sandbox creates compute; KurrentDB does not make permission
decisions. Publishing an active lease atomically admits the existing Absurd conversation-turn task.
Absurd owns durable progression, waits and restart recovery; the server keeps the prompt and model
key, reserves each request, calls LiteLLM and saves accepted content. Current continuation
implementation also connects one permitted tool result to a final answer. The Pod prepares the
lease-fenced workspace and review surface only; [development status](/guide/status) separates
qualified checkpoints from work under review.

## What each part owns

| Part | Current owner and responsibility |
|---|---|
| Web workspace | `apps/opencrane-ui` and `libs/frontend`: conversations, input, history and computer review. |
| Product server | `apps/opencrane` composes the backend libraries. They check current access, admit work and persist protected changes. |
| PostgreSQL | Current memberships, groups, grants, agent configuration, transactional product records and rebuildable conversation directory/read projections. Private message payloads are stored separately from immutable history. |
| KurrentDB | Ordered `conversation-{id}` history, computer lifecycle evidence and durable activation delivery. History entries reference encrypted message payloads. |
| Workflow progression | The existing Absurd control-plane task selects the next saved turn step, owns durable deadlines and tool-result waits, and resumes after restart. The server retains every model, budget, tool and output decision. |
| Conversation compute | `apps/conversation-computer` prepares its lease-fenced workspace and provides a private workspace-review gateway. `apps/_infra/agent-sandbox` owns the admitted profile; the upstream Agent Sandbox controller owns Pod lifecycle. |
| Models | LiteLLM routes requests to configured providers and brokers scoped model credentials. Providers may be external to the organisation. |
| Tools | The MCP catalogue, server-side action authority and `apps/mcp-executor` govern immutable tool packages and isolated execution. The atomic handoff saves a permitted conversation proposal and its executor work together, with claims bounded by the original run and current access. The continuation implementation connects one permitted model-selected tool and its result to a final answer; qualification, approvals and visible progress remain open. |
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

For a personal text turn, admission resolves the employee's verified internal identity to the
sign-in identity used during onboarding, then freezes their approved persona, ordered conversation
history and model choice. Personal memory is explicitly unavailable in this baseline: provisioning
a dataset and recalling its content remain separate product work. This does not prevent a person
from using their approved instructions and the current conversation.

Admission also freezes a 4,096-token output cap for each text response. The server takes the
smaller of that limit and the run's token budget, so a generous aggregate budget does not become
an oversized request for one answer. Provider capability discovery remains separate from this
product response limit.

Before each model request, the server records a reservation in the existing private turn stream.
Only the live handler that wins a fresh reservation may dispatch. The original call allowance,
token ceilings and run/lease authority remain binding across restart. Absurd addresses the saved
turn by its admitted activation receipt and waits durably when a request or tool result is pending.
The Pod receives no prompt, model key, turn status or outcome and has no direct LiteLLM network path
or private tool-proposal/output route.

The continuation implementation lets the first request select at most one unambiguous tool from the
frozen set that requires no approval, when the original allowance permits two model calls. The server
encrypts the original declaration before recording its selection. It then admits the existing MCP
executor work, checks current authority and the exact terminal result, and encrypts the original
assistant declaration paired with that result. The second reservation must commit before result
delivery is acknowledged.

| Private turn revision | Recorded decision |
| --- | --- |
| 0 | Freeze the original input and conversation head. |
| 1 | Reserve the first model request. |
| 2 | Select the encrypted tool declaration, or accept a direct text answer. |
| 3 | Reserve the final model request against the saved assistant/tool pair. |
| 4 | Accept the final answer after the tool result. |

The final request offers no tools. It uses the original key, matching its saved digest and actual
expiry, and subtracts the whole first token reservation from the original allowance. Key cleanup
retains a non-secret spent marker; missing, expired or uncertain custody cannot reset the budget.
Each HTTP request remains at most 25 seconds and cannot outlive the key or current authority.
Intermediate tool progress is not appended to participant history, so the compiled conversation
head stays unchanged until the final answer.

The server saves the encrypted answer and full prepared history event before appending it. Recovery
finishes that same answer before recompiling current history, which may already contain it. A saved
tool declaration can resume admission without repeating the first request. If a reserved model
response never reached durable storage, its request becomes unavailable after the fixed deadline,
without paid redispatch. The run remains pending for future recovery controls. This bounds
OpenCrane's admitted gateway requests without claiming exactly-once execution inside LiteLLM or a
provider.

The requester and executor are distinct roles. The human must own the input message and retain
access to the conversation. A company assistant executes with its own identity and resource
permissions. Retrying the same request preserves both identities and the original frozen input.

## Shared work from a group

A group remains a conversation between people. Selecting **Ask company assistant** creates one
linked assistant conversation from an explicitly chosen, caller-authored group request.

```text
Group message
    │ explicit request, selected company assistant, fixed audience
    ▼
PostgreSQL admission + durable creation task
    │ recoverable, idempotent work across the two stores
    ▼
Kurrent child history + cold computer → activation → bounded model answer
    │ a participant reviews and edits the result
    ▼
New parent message, authored by the person who shares it
```

The transaction saves the immutable command and its workflow task together. A worker creates the
child history and computer, then the current product projections and first request. Retries reuse
the same identifiers; no transaction is claimed across PostgreSQL, KurrentDB and Kubernetes.

The company assistant has an Internal Principal and a managed identity. It uses its own published
revision and model grant. The human requester supplies separate, current membership and Invoke
evidence. Personal configuration, private memory and tools are not copied to the company assistant.

The child's audience is frozen at admission. Current membership and both parent and child access
are checked before metadata, plaintext or execution is released. Rejoining the parent cannot
reveal a request from before the participant's join boundary. Returning text to the group is an
explicit human write bound to the source child; there is no generic upward-delivery engine.

## Isolation and external actions

Each organisation has its own installation boundary. Identity, database, storage and network
controls restrict access within and across those boundaries. An assistant cannot grant itself
additional tools or read another person's private work just because it shares infrastructure.

Tool execution is a separate governed service. The continuation implementation connects a single
model-selected tool that needs no approval; it still needs qualification with a permitted retrieval
fixture. Company revisions do not support tool assignments yet. Approved actions, visible tool
progress and recovery controls remain unfinished, as do shared-agent scheduling and autonomous
delegation between assistants.

## Baseline and evidence

[ADR 0016](https://github.com/elewa-git/opencrane/blob/main/docs/adr/0016-conversation-history-and-computers.md)
is the architecture of record for 0.11. It supersedes the run-owned warm-Pod lifecycle and
PostgreSQL transcript. OpenCrane does not add another Kubernetes Pod controller beside Agent Sandbox.

Implemented recovery and backup machinery still needs the live drills listed in
[development status](/guide/status). Operator inputs and procedures belong in
[deployment configuration](/operators/deployment-configuration) and the [runbook](/operators/runbook).

Text checkpoint `378a755b6` has passed full CI, including all seven fresh PostgreSQL targets and
24 real KurrentDB cases. The later continuation implementation and its Absurd orchestration
follow-up await live qualification. Neither replacement is installed on testv5, which has no
integration installed for the retrieval proof. T1 remains in progress, and approved actions and
user-facing recovery retain their separate completion criteria.
