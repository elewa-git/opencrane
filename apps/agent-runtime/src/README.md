# Agent runtime source architecture

> [agent-runtime](../README.md) › source

This directory contains the process-local implementation of one isolated agent-run attempt. The
OpenCrane server admits the run, freezes its input, authorises external actions, and stores the
durable event history. This process runs the ephemeral model loop, proposes candidates back to that
authority, and — once the server approves a proposed integration tool call — executes that exact
call directly against Obot's MCP proxy with an attempt-scoped key, reporting only a result digest.

## Component map

```text
runtime.py  process lifecycle and bounded reconnects
│
├── bootstrap/ ───────────────────────┐
│   proof evidence + one-use exchange │
│                                     ▼
└── transport/ ◄──────────────── control-plane HTTP/SSE
    command stream                     │
            │                          │ candidates
            ▼                          │
        attempts/ ─────────────────────┘
        command orchestration
        │                 │
        ▼                 ▼
    model_loop/       protocol/
    Pydantic adapter  candidate projection
        │                 │
        │             tools/ (obot_mcp: approved direct MCP invocation)
        │
        └── encrypted local checkpoint

config.py · constants.py · observability.py support the components above.
```

| Component | Consumes | Produces | Must never own |
| --- | --- | --- | --- |
| `runtime.py` | Mounted settings and projected identity files | One bootstrapped outbound stream | Run selection or durable state |
| `bootstrap/` | Bootstrap reference, projected token, generated public key evidence | One accepted proof-key binding | Retry after permanent refusal |
| `transport/` | Authenticated server-sent events and candidate dictionaries | Dispatched commands and bounded HTTP requests | An inbound listener or local queue |
| `attempts/` | Fenced start, resume, and cancel commands | Ordered runtime candidates, executed approved calls, and safe run evidence | Approval or canonical cancellation |
| `tools/` | Approved call coordinates, Obot addressing, mounted attempt key | One bounded MCP `initialize` + `tools/call` exchange | Unapproved execution or the Obot service credential |
| `model_loop/` | Compiled input, attempt-scoped LiteLLM key, authorised resume results | Framework-neutral model events | Direct tool execution or implicit retries |
| `protocol/` | Neutral events and compiled tool grants | Stable event or external-action candidates | Trusting a model-selected tool revision |

## Runtime sequence

1. `runtime.py` reads the mounted settings, generates public proof-key binding evidence, and asks
   `bootstrap/` to bind it exactly once.
2. `transport/stream.py` opens the sole outbound command stream with the projected workload token.
3. A `start_attempt` command creates a cancellation signal and terminal gate, then runs
   `attempts/execution.py` on a worker thread so the stream can still receive cancellation.
4. `model_loop/driver.py` calls LiteLLM through Pydantic AI with every implicit retry path disabled.
   It translates framework events into small dictionaries; framework objects never cross the seam.
5. `protocol/candidates.py` binds each event to the accepted command coordinates. Tool calls become
   `external_action` candidates only after resolving the exact revision from the compiled grant set.
6. `transport/http.py` delivers each stable candidate. It retries only the control plane's explicit
   pre-reservation response and preserves the same candidate identifier across that retry.
7. A `resume_attempt` names WHICH proposed calls were approved. `attempts/deferred_results.py` maps
   each approved `toolInvocationId` back to the pending call recorded at proposal time
   (`attempts/pending_tools.py`), re-checks the compiled allow-list and Obot addressing, executes it
   through `tools/obot_mcp.py`, emits a digest-only `tool.completed` candidate, and feeds the
   framework the per-call results (a denial feeds a refusal; failures are typed loop errors).
   Starting or resuming
   supersedes any prior local worker; a `cancel_attempt` signals the current worker, while dropped
   transport cancels every registered worker and suppresses late runtime output.

## Authority and failure rules

- The control plane owns `Thread -> AgentRun -> ordered RunEvent`, approval, budgets, cancellation,
  tool execution, and durable terminal state. The runtime proposes; it does not author authority.
- Every candidate echoes the runtime instance, command, run, attempt, and fence that admitted it.
- The local checkpoint is encrypted, replaceable, and bound to run coordinates. Missing, corrupt,
  foreign, or stale checkpoint data is discarded; it never overrides server state.
- Bootstrap refusal is permanent. Exceptional and clean-close transport loss reconnect with bounded
  jitter. Non-terminal candidate replay requires an explicit pre-reservation response from the
  server. A terminal candidate may also replay unchanged after an ambiguous network loss; an
  explicit HTTP refusal is permanent.
- Secrets are read at their point of use and never included in logs, spans, candidates, checkpoints,
  command-line arguments, or environment-derived error messages.

## Dependency direction

Dependencies flow from process composition towards narrower mechanisms:

```text
runtime → bootstrap / transport → attempts → model_loop / protocol / tools
                                      │
                                      └── terminal

all components may depend on config, constants, or observability.
No lower component imports runtime.py.
```

This code remains app-local because every module is inseparable from this single outbound process
boundary. If another deployable needs one of these contracts, move that contract into a properly
tagged library instead of importing this application's source.

## See also

- Parent package: [agent-runtime](../README.md)
- Identity bootstrap: [bootstrap](bootstrap/README.md)
- Model adapter: [model loop](model_loop/README.md)
- Candidate seam: [protocol](protocol/README.md)
- Command lifecycle: [attempts](attempts/README.md)
- Network boundary: [transport](transport/README.md)
