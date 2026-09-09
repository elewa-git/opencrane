# Conversation computers

OpenCrane gives each Agent chat one logical **ConversationComputer**. Its durable state lives in
KurrentDB; a Kubernetes Pod is only the temporary machine that realises one active lease.

The 0.11 review baseline implements personal and explicit company-child text turns, computer
inspection, activation recovery and workspace checkpoint/restore. The current text model-step source
moves model requests and answer storage to the server. It does not yet invoke governed tools or
continue from their results; managed-agent scheduling and autonomous delegation remain unfinished. See
[development status](/guide/status) for implementation and live-qualification boundaries.

> See also: [Central authorization authority](/integrators/authorization-authority) (product action
> admission), [OCI MCP runtime](/integrators/oci-mcp-runtime) (tool execution), and
> [Identity and runtime authentication](/security/identity) (workload proof).

## Activation sequence

```text
participant message
      │ immutable entry + activation command
      ▼
KurrentDB persistent subscription
      │ generation-fenced claim
      ▼
Agent Sandbox SandboxClaim
      │ projected Pod token
      ▼
conversation-computer
      │ private bootstrap status + model-step request
      ▼
OpenCrane server
      │ reserve one request → LiteLLM → save exact answer
      ▼
assistant entry appended through the bound writer
```

The server validates the activation command against the conversation stream and logical computer
history before it creates or observes an Agent Sandbox claim. The claimed Pod exchanges its
projected service-account token for bootstrap status. The server fixes the silo, conversation,
computer id, generation, lease, AgentIdentity and model route; the Pod receives only `bootstrapId`
and `ready`, `pending` or `response_unavailable`. It requests ordinal 1 through the private
`/api/internal/conversation-computer/model-step` route. No prompt or model key enters the Pod.

## Authority boundaries

| Component | Owns | Does not own |
|---|---|---|
| OpenCrane server | immutable entries, private payloads, activation admission, model request and output, computer history and lease fencing | provider-internal execution or Kubernetes reconciliation |
| Agent Sandbox | claim-to-Pod reconciliation for the selected template and pool | users, conversations, grants or model policy |
| Conversation computer | model-step request, status polling and workspace review | durable history, model credentials, output admission, policy or a second conversation |

The computer has no database credentials or Kubernetes mutation rights. Its private gateway is
reachable through the server's authorised review proxy, not public ingress. Its scratch workspace
can be checkpointed before cooling and restored when a later generation starts. Model work calls the
private OpenCrane server; NetworkPolicy denies direct LiteLLM access. New output appends recheck the
active lease, while retries recognise an already accepted, identical event.

The server reserves one request within the original run's call, token and authority limits before
dispatch. Model-step returns `completed`, `pending`, `response_unavailable` or `authority_ended`.
An uncertain response keeps its reservation, with no paid redispatch on restart. The adapter accepts
completed text only and rejects tool responses. LiteLLM and provider-internal retries have not been
qualified as exactly-once execution.

## Review surface

The server proxies participant review calls to the computer's private gateway with a credential it
derives under a server-only keyring key from the current lease. The computer receives that secret
once, over its TokenReviewed bootstrap channel, and its gateway refuses every call until then; the
lease id on the Pod label is only a name. When the server calls the gateway it presents one
credential per key still in the keyring, newest first, and the computer accepts any match, so
rotating the keyring while a lease is alive does not lock the server out of its own computer. A key
retired from the keyring ends access to computers that were granted under it, so retire a key only
after those leases have ended.

What a participant can do in 0.11:

| Route | Product action | What it returns |
|---|---|---|
| files, diff | `Read` | one workspace file (1 MiB ceiling) or a `git diff` of one path |
| browser version, targets | `Read` | headless Chromium metadata and its open preview targets |
| browser pages, screenshots | `Use` | denied pending concrete effect admission; the gateway can open or render an allow-listed localhost preview |
| previews | `Use` | denied pending concrete effect admission; the gateway supports a GET-only localhost proxy |
| commands | `Use` | denied pending concrete effect admission; the gateway supports bounded argv commands |

Current `Read` checks protect file, diff and browser discovery. The effect routes above remain
closed until their arguments are bound to recorded admission. Not in 0.11: an interactive browser or desktop view, noVNC, a
terminal, artifact routes, and durable CodeProject, Git, build or PreviewApp publication. Review gives a participant a fenced view of that computer; it never grants a product action or publishes an application.

## Recovery and qualification

Activation delivery supports competing consumers, reconnect backoff and parked-message replay.
Lease renewal and loss handling prevent replaced compute from retaining authority. Checkpoint and
restore code preserves workspace bytes while conversation history remains in KurrentDB.

The current text path also saves the exact prepared answer before history append. A restarted
server finishes that saved event and run bookkeeping before admitting another turn. A reservation
without a saved answer becomes `response_unavailable` after its fixed deadline and leaves the run
pending. The worker remains degraded without resubmitting that model step; user-facing recovery
controls are still planned.

The text model-step source awaits its own CI and live qualification and is not installed on testv5.
The preceding atomic tool handoff has passed full CI, while the completed file-copy restore and
remaining snapshot-restore drill are recorded in [development status](/guide/status). Follow the
[operator runbook](/operators/runbook) for those procedures and the
[architecture map](/advanced/architecture) for the store and controller owners.

## Source

- [`apps/conversation-computer`](https://github.com/elewa-git/opencrane/blob/main/apps/conversation-computer/README.md)
- [`apps/_infra/agent-sandbox`](https://github.com/elewa-git/opencrane/blob/main/apps/_infra/agent-sandbox/README.md)
- [`libs/backend/server/conversations`](https://github.com/elewa-git/opencrane/blob/main/libs/backend/server/conversations/main/README.md)
