# Conversation computers

OpenCrane gives each Agent chat one logical **ConversationComputer**. Its durable state lives in
KurrentDB; a Kubernetes Pod is only the temporary machine that realises one active lease.

The 0.11 review baseline implements bounded personal model turns with approved persona instructions,
computer inspection, activation recovery and workspace checkpoint/restore. The model loop does not yet invoke governed tools;
managed-agent execution and group `@agent` child conversations remain unfinished. See
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

The computer has no database credentials or Kubernetes mutation rights. Its private gateway is
reachable through the server's authorised review proxy, not public ingress. Its scratch workspace
can be checkpointed before cooling and restored when a later generation starts. Model work calls
the bootstrap-provided OpenCrane and LiteLLM routes; every output append rechecks the active lease.

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
| browser pages, screenshots | `Use` | opens or renders one allow-listed `127.0.0.1` preview port as a bounded PNG |
| previews | `Use` | GET-only proxy to the same allow-listed localhost ports |
| commands | `Use` | one argv-only command from the release allowlist (`git`, `node`, `npm`, `npx`, `python3`); no shell |

Every participant with `Use` on the conversation gets every surface above; 0.11 has no
per-participant surface selection. Not in 0.11: an interactive browser or desktop view, noVNC, a
terminal, artifact routes, and durable CodeProject, Git, build or PreviewApp publication. Review gives a participant a fenced view of that computer; it never grants a product action or publishes an application.

## Recovery and qualification

Activation delivery supports competing consumers, reconnect backoff and parked-message replay.
Lease renewal and loss handling prevent replaced compute from retaining authority. Checkpoint and
restore code preserves workspace bytes while conversation history remains in KurrentDB.

These paths are implemented in the review baseline. The secure live installation, complete human
review journey and KurrentDB backup/restore drill remain qualification work. Follow the
[operator runbook](/operators/runbook) for those procedures and the
[architecture map](/advanced/architecture) for the store and controller owners.

## Source

- [`apps/conversation-computer`](https://github.com/elewa-git/opencrane/blob/main/apps/conversation-computer/README.md)
- [`apps/_infra/agent-sandbox`](https://github.com/elewa-git/opencrane/blob/main/apps/_infra/agent-sandbox/README.md)
- [`libs/backend/server/conversations`](https://github.com/elewa-git/opencrane/blob/main/libs/backend/server/conversations/main/README.md)
