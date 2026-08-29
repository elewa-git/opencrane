# Memory write, manage and read

OpenCrane separates **session history**, **run context**, **long-term semantic memory** and the
**authority ledger** that governs them. This page follows the boundaries around the loop so an
integrator can see what a running agent may receive, what it may propose, and what remains
server-owned.

> See also: [Governed agent runtime](/integrators/agent-runtime) (runtime and action custody),
> [OCI MCP runtime](/integrators/oci-mcp-runtime) (tool execution),
> [Long-term memory, Cognee and dreaming](/integrators/long-term-memory-cognee) (datasets and
> consolidation), and [Silo IAM](/integrators/silo-iam) (scope and grants).

## Four kinds of information

These terms are deliberately not interchangeable. A transcript is not long-term memory, and a
runtime's context is not a permission to retain what it saw.

Status markers on this page mean ✅ live and 🔶 partially implemented or scaffold-only.

| Kind | What it is | Current owner | What reaches the runtime |
|---|---|---|---|
| Session history ✅ | Ordered conversation messages and run events for an authorised conversation | OpenCrane conversation authority | The sealed snapshot selects message identifiers; the compiler expands the authorised non-memory content for the attempt. |
| Run context ✅ | Bounded, disposable model input compiled for one attempt from an immutable `RunInputSnapshot` | OpenCrane run admission | Selected message content, instructions, tool definitions, model route and budgets. The runtime cannot amend it. |
| Long-term semantic memory 🔶 | Durable fact content and semantic search in Cognee | Cognee behind the private memory gateway | Admission currently freezes verified dataset coordinates only. Recalled fact content is not yet delivered to the model. |
| Authority ledger ✅ / 🔶 | Scope, consent, provenance, approval, receipt, event and terminal-outcome evidence | OpenCrane PostgreSQL authorities | No raw ledger access. The runtime receives only the command or saved result that the control plane accepts. Generic memory catalogue writes are foundation-only. |

Here, **authority ledger** is a descriptive term for the product's durable records and decisions;
it is not a second fact-text store. The memory catalogue records identifiers, digests, consent,
sensitivity and provenance, while Cognee is the intended holder of fact content.

::: tip
Keep the four layers separate in an integration. Put conversational material in the conversation
authority, freeze the inputs for one attempt, retrieve durable knowledge only through the gateway,
and record decisions and evidence in the relevant OpenCrane authority.
:::

## The write–manage–read loop

The loop is a control-plane concern, not a property of the model. **Write** proposes what may become
durable. **Manage** validates, scopes, classifies and records it. **Read** assembles only the material
authorised for one attempt. The result of read is **context**: a bounded, disposable input to the
runtime, not another store.

```text
                                      outside the loop
                  participant answers / provider results / child status (scaffold)
                                               │
                                               ▼
┌───────────────┐    candidates     ┌───────────────────────┐
│ runtime turn  │ ────────────────► │ WRITE                 │
│ bounded Job   │                   │ messages, events,     │
└───────▲───────┘                   │ actions, memory facts │
        │                           └───────────┬───────────┘
        │ context                               │ proposals only
        │                                       ▼
┌───────┴────────────────┐          ┌───────────────────────┐
│ READ                   │ ◄─────── │ MANAGE                │
│ authorise + select +   │          │ validate + consent +  │
│ compile one attempt    │          │ deduplicate + retain  │
└───────▲────────────────┘          └─────┬────────┬────────┘
        │                                 │        │
        │                 ┌───────────────┘        └───────────────┐
        │                 ▼                                        ▼
┌───────┴──────────┐  ┌──────────────────┐               ┌─────────────────┐
│ session history │  │ semantic memory  │               │ authority ledger│
│ messages/events │  │ fact content     │               │ scope, approval,│
│ OpenCrane       │  │ Cognee (target)  │               │ receipts/outcome│
└──────────────────┘  └──────────────────┘               └─────────────────┘
```

The stores have different retention and authority. Session history supports replay and continuity.
Semantic memory is intended for useful facts across conversations. The authority ledger proves why
an input or action was allowed. Read may draw from all three, but it must not collapse them into one
unbounded transcript.

### Session read is currently the inefficient part

✅ Conversation writes are durable and ordered. 🔶 At admission, however, OpenCrane currently selects
**every completed message** in the conversation, and the prompt compiler expands every selected
message into the model input. `ConversationContextRevision` provides a schema for compacted context,
but no production writer or reader uses it yet.

The target read path is therefore:

```text
active context revision + recent uncompacted message tail
                         + authorised artifact/skill summaries
                         + approved transient semantic-memory recall
                                      │
                                      ▼
                         bounded context for one attempt
```

Compaction should write a new immutable context revision with provenance through a specific message;
it should not rewrite or delete the transcript. The recent tail remains verbatim, while the revision
carries forward only the decisions, commitments and unresolved state needed for the next turn.

## The current loop

Run admission commits one immutable snapshot with the run. For a personal run, the snapshot may
name only the active Cognee dataset selected from the verified `(silo, organisation, subject)`
tuple. It does not call Cognee, select a query, freeze fact references, or place fact text in the
prompt. The model can subsequently propose `memory_recall`; that proposal follows the same
server-owned external-action lifecycle as a tool call.

```text
authorised conversation history + current grants
                         │
                         ▼
┌──────────────────────────────────────────────────────┐
│ OpenCrane admission                                   │
│ seals RunInputSnapshot: messages, identity, policies, │
│ tool revisions and verified dataset coordinates       │
└───────────────────────┬──────────────────────────────┘
                        │ compiled non-memory context
                        ▼
                ┌───────────────┐
                │ claimed Pod   │
                │ bounded loop  │
                └───────┬───────┘
                        │ proposes memory_recall
                        ▼
┌──────────────────────────────────────────────────────┐
│ server external-action authority                      │
│ creates invocation → asks exact participant → checks  │
│ one-use receipt and current claim                     │
└───────────────────────┬──────────────────────────────┘
                        │
                        ▼
      `safe_delivery_required` — no Cognee call, no fact content
```

The repository contains an authenticated client capable of a bounded Cognee search for a frozen
dataset UUID, and a deployable private gateway. Neither is composed into the production recall
worker. The action stops before the gateway until OpenCrane has an ephemeral, attempt-fenced delivery
channel that cannot leak recalled content into durable tool results, events, logs, Activity or A2UI.

::: warning
Do not treat a successful memory-permission response as a read. Today it only authorises the exact
invocation; the action then returns `safe_delivery_required` before Cognee is contacted.
:::

## Write, manage and read status

| Loop stage | Current behaviour | Target behaviour |
|---|---|---|
| Write | 🔶 The schema, provenance validation, content-free catalogue command and outbox contract exist, but no production writer or outbox dispatcher is composed. Gateway writes fail closed. | Cognee accepts content first; OpenCrane then atomically records its external id, digest, consent, provenance and outbox intent. |
| Manage | ✅ Personal dataset selection is identity-bound at admission. Dataset and fact metadata have active, correction and forgetting states, but generic record/correct/forget execution is not composed. | Governance changes retain an explainable metadata trail without duplicating fact text. |
| Read | 🔶 The private gateway accepts only authenticated, bounded search. A personal run can propose an approval-required recall, but its content delivery is blocked before the gateway. | The server delivers gateway-originated results transiently to the exact active attempt, then resumes the paused loop. |
| Audit | ✅ Run snapshots, action invocations, approvals, receipts, ordered events and terminal outcomes are durable authorities. | Memory actions join the same evidence chain once safe delivery and writing are enabled. |

Exactly one provenance source is required for a future fact record: an artifact revision, a
conversation message or an explicit user statement. An explicit statement must name the same
authenticated author as the target personal dataset. Missing or ambiguous provenance, an inactive
dataset, and a conflicting correction must fail closed.

## Outbound and return boundaries

The runtime has an outbound stream to OpenCrane, not direct access to people, external integration
providers, child agents or durable storage. The separately fenced model-provider call is shown as
its own boundary. Each outgoing path reaches a different server authority, and only an accepted,
saved result may return to the same active attempt.

```text
                                model provider
                                  ▲       │
        attempt-scoped LiteLLM request    │ model output
                                  │       ▼
                              claimed runtime Pod
                                        │
      ┌──────────────┬──────────────────┼─────────────────┬────────────────┐
      │              │                  │                 │                │
      ▼              ▼                  ▼                 ▼                ▼
 elicitation    external-action    artifact output   parent delivery  terminal report
 proposal       candidate          bytes + ticket    bounded status   complete / fail
      │              │                  │                 │                │
      ▼              ▼                  ▼                 ▼                ▼
 exact person   server worker      ArtifactStore +   parent thread    run authority
 + purpose      + approval         quarantine scan   authority        fences attempt
      │              │                  │                 │                │
      ▼              ▼                  ▼                 ▼                ├──► durable outcome
 saved result   OCI MCP executor   verified receipt  saved display-   ├──► release / cleanup
      │         or fail-closed      + ready/failed    safe delivery    └──► ordered event
      │         memory/sandbox      state
      │              │
      └──────┬───────┘
             ▼
       saved resume_attempt ───────────────────────────────► same active Job

 server-side authorities ───────► durable audit evidence where instrumented
 processes ─────────────────────► redacted logs and optional OTLP traces
                                  (operational output; no return into context)
```

### Model provider

✅ The control plane dispatches immutable compiled input and an attempt-scoped LiteLLM credential.
The runtime uses that credential to call the selected model and returns neutral protocol events over
its authenticated stream. The model provider does not receive OpenCrane database authority, and its
output does not bypass the run and event authorities.

### Participant elicitation

✅ A runtime may propose a bounded question, choice, approval-required action or protected
memory-permission request. The server chooses one exact participant, binds the request to its run,
attempt, expiry and purpose, and validates the response before saving the result used to resume that
attempt. Ordinary elicitation may return answer content. Protected-purpose responses, including
personal-memory permission, return an outcome or receipt instead of recalled fact content.

### External tool and provider execution

✅ A runtime's `external_action` candidate becomes a durable `ToolInvocation` before any provider
I/O. The server reconstructs the frozen context, rechecks arguments and policy, obtains an
approval where required, and issues a claim for the selected executor class. OCI MCP calls run in a
one-use Job whose fixed companion returns one checked result. The runtime receives only the saved,
validated result on resume. The sandbox executor and memory-recall transport currently fail closed.
An unclear provider outcome enters visible recovery rather than being repeated blindly.

### Parent delivery and child runs

✅ A user-created Agent thread can deliver bounded, display-safe status to its immediate parent
conversation. The parent receives a kind, label, detail and optional asset reference—not the child
transcript—and the server verifies live assignment, ownership and idempotency before saving it.

🔶 Model-created child runs are different. Reservation and completion-ledger infrastructure exists,
including terminal child events and explicit suppression when a parent cannot receive them, but no
production caller currently lets the runtime spawn such a child.

### Generated artifacts

✅ Where artifact scanning is enabled, a runtime reserves an output ticket and streams exact bytes
through the server to `ArtifactStore`. The server persists a verified receipt and quarantined
revision; only a successful scan makes the asset ready for browser access. Without the scanner,
reservation and publishing fail closed. Artifact bytes do not become memory implicitly.

### Terminal outcomes, audit and observability

✅ Only the control plane finalises a run as `completed`, `failed` or `cancelled`, with a terminal
reason. The authenticated runtime can report only protocol-fenced completion or failure for its
current attempt; it cannot cancel itself. Completion waits for pending tool results. User-requested
cancellation revokes assignment authority, emits cleanup work and reaches `cancelled` only after the
server-owned lifecycle finalises it.

Ordered conversation events provide authorised replay. Instrumented authorities append durable
audit evidence, while processes emit structured, redacted logs and optional OTLP traces. Audit and
telemetry are not memory and are not automatically injected into later context. Provider bodies,
credentials, raw tool arguments and raw tool results are not projected into the conversation stream.

## Failure posture

- A request cannot choose a personal dataset by identifier; verified admission coordinates choose it.
- Runtime-local scratch and checkpoint data never become durable memory implicitly.
- A gateway failure never becomes an empty, fabricated recall result.
- A rejected, expired or unavailable participant response does not dispatch a provider action.
- A stale attempt, mismatched snapshot, cancelled run or ambiguous provider outcome does not
  produce a successful result.
- Durable semantic memory remains unavailable to the model until the safe return path exists.

## Source

- [`Run input assembly`](https://github.com/elewa-git/opencrane/blob/main/libs/backend/agents/execution/inputs/main/README.md)
- [`Runtime protocol and external-action worker`](https://github.com/elewa-git/opencrane/blob/main/libs/backend/agents/execution/protocol/README.md)
- [`Personal memory selection`](https://github.com/elewa-git/opencrane/blob/main/libs/backend/agents/personal/memory/main/README.md)
- [`Memory gateway client`](https://github.com/elewa-git/opencrane/blob/main/libs/backend/server/infra/memory-gateway-client/README.md)
- [`Memory and run schema`](https://github.com/elewa-git/opencrane/blob/main/apps/opencrane/prisma/schema/memory.prisma)
