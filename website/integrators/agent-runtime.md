# Conversation computers

OpenCrane gives each Agent chat one logical **ConversationComputer**. Its durable state lives in
KurrentDB; a Kubernetes Pod is only the temporary machine that realises one active lease.

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
      │ bounded bootstrap + LiteLLM call
      ▼
assistant entry appended through the bound writer
```

The server validates the activation command against the conversation stream and logical computer
history before it creates or observes an Agent Sandbox claim. The claimed Pod exchanges its
projected service-account token for a bounded bootstrap. The bootstrap fixes the silo,
conversation, computer id, generation, lease, AgentIdentity and model route; the Pod cannot select
different authority coordinates.

## Authority boundaries

| Component | Owns | Does not own |
|---|---|---|
| OpenCrane server | immutable entries, private payloads, activation admission, computer history and lease fencing | model execution or Kubernetes reconciliation |
| Agent Sandbox | claim-to-Pod reconciliation for the selected template and pool | users, conversations, grants or model policy |
| Conversation computer | one bounded model turn and output proposal | durable history, credentials, policy or a second conversation |

The computer has no database credentials, Kubernetes mutation rights, Service or Ingress. It uses
ephemeral scratch and can call only the bootstrap-provided OpenCrane and LiteLLM routes. Every output
append rechecks the active lease generation.

## Review surface

The server may issue a short-lived, generation-bound review ticket for the current computer. The
ticket gives a participant a fenced view of that computer; it never grants a product action or
publishes an application. Durable CodeProject, Git, build and PreviewApp publication belong to the
next phase.

## Source

- [`apps/conversation-computer`](https://github.com/elewa-git/opencrane/blob/main/apps/conversation-computer/README.md)
- [`apps/_infra/agent-sandbox`](https://github.com/elewa-git/opencrane/blob/main/apps/_infra/agent-sandbox/README.md)
- [`libs/backend/server/conversations`](https://github.com/elewa-git/opencrane/blob/main/libs/backend/server/conversations/main/README.md)
