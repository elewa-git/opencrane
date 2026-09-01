# Agent runtime source architecture

> [agent-runtime](../README.md) › source

This directory contains the process-local implementation of one isolated agent-run attempt. The
OpenCrane server admits the run, freezes its input, authorises external actions, and stores the
durable event history. This process runs the ephemeral model loop and proposes candidates back to
that authority. External calls execute in the control plane; this runtime receives only exact saved
results and therefore cannot repeat a provider action after reconnecting.

## Component map

```text
runtime.py  warm binding, process lifecycle, and bounded reconnects
development_runtime.py  explicit Tier 2 model-strategy composition
│
├── bootstrap/ ───────────────────────┐
│   proof evidence + one-use binding  │
│                                     ▼
└── transport/ ◄──────────────── control-plane HTTP/SSE
    command stream + output bytes      │
            │                          │ candidates
            ▼                          │
        attempts/ ─────────────────────┘
        command orchestration
        │                 │
        ▼                 ▼
    model_loop/       protocol/
    Pydantic adapter  candidate projection
        │
        └── bounded continuation saved by the server

config.py · constants.py · observability.py support the components above.
```

| Component | Consumes | Produces | Must never own |
| --- | --- | --- | --- |
| `runtime.py` | Warm settings, projected identity, and generated proof evidence | One bound outbound stream | Run selection or durable state |
| `development_runtime.py` | An explicit Tier 2 Agent profile | The same bound stream with real or deterministic model handlers | Production composition or durable candidate writes |
| `development/` | Accepted compiled input and authorised resume results | Deterministic neutral events for simulated development | Model network, provider keys, tool execution, or database writes |
| `warm_runtime.py` | Pod UID and fixed claimed profile | Local readiness responses | Run identity or credentials |
| `bootstrap/` | Projected token and generated public key evidence | One accepted proof-key binding and in-memory model key | Retry after permanent refusal |
| `transport/` | Authenticated server-sent events and candidate dictionaries | Dispatched commands and bounded HTTP requests | An inbound listener or local queue |
| `attempts/` | Fenced start, resume, and cancel commands | Ordered candidates, exact saved tool and elicitation results, and safe run evidence | Tool execution, participant selection, approval, or canonical cancellation |
| `model_loop/` | Compiled input, attempt-scoped LiteLLM key, authorised resume results | Framework-neutral model events | Direct tool execution, participant authority, or implicit retries |
| `protocol/` | Neutral events and compiled tool grants | Stable event, external-action, or elicitation candidates | Trusting a model-selected authority coordinate |

## Runtime sequence

1. `runtime.py` starts the local readiness server and generates public proof-key evidence.
2. `bootstrap/` asks the server to bind this reviewed Pod to its saved reservation. The returned
   attempt model key stays in process memory.
3. `transport/stream.py` opens the sole outbound command stream with the projected workload token.
4. A `start_attempt` command creates a cancellation signal and terminal gate, then runs
   `attempts/execution.py` on a worker thread so the stream can still receive cancellation.
5. `model_loop/driver.py` calls LiteLLM through Pydantic AI with every implicit retry path disabled.
   It translates framework events into small dictionaries; framework objects never cross the seam.
6. `protocol/candidates.py` binds each event to the accepted command coordinates. Tool calls become
   `external_action` candidates only after resolving the exact revision from the compiled grant set.
   `protocol/elicitation.py` admits one strictly bounded ordinary-input or A2UI-action request,
   computes its canonical digest, and carries no participant or absolute-expiry coordinate.
7. `transport/http.py` delivers each non-terminal candidate once. A neutral `output_asset` starts
   the assistant message when needed, then `transport/output.py` reserves and uploads exact bytes
   through the private control-plane broker. The runtime sends its message id, never a database
   sequence, storage lease, or receipt. Terminal delivery alone may reuse
   its stable identifier after an ambiguous network loss.
8. A `resume_attempt` carries exact saved tool and participant-input results. `attempts/tool_results.py` maps each
   `toolInvocationId` back to the pending call recorded in the attempt continuation and feeds the
   framework that saved result.
   `attempts/elicitation_results.py` rejects unknown fields and invalid terminal shapes before any
   pending tool result is consumed. Ordinary answers enter the next model boundary exactly;
   declined, expired, cancelled, failed, and protected redacted answers enter as terminal markers.
   Neither path contacts a provider or creates a second completion.
   Starting or resuming
   supersedes any prior local worker; a `cancel_attempt` signals the current worker, while dropped
   transport cancels every registered worker and suppresses late runtime output.

For local development, `development_runtime.py` preserves bootstrap, command admission, event
projection, resume correlation, and candidate delivery. The `litellm` strategy uses the normal model
driver for Alternatives A and B. The `simulated` strategy replaces only the model request with
`development/deterministic_model.py`, which emits neutral events into the same projector. The
simulated profile returns deterministic text and usage events for chat messages. It does not
propose or execute tools because Tier 2 does not start the server-owned external-action worker.

## Authority and failure rules

- The control plane owns the conditional `Conversation (agent_session) -> AgentRun -> ordered RunEvent`
  relationship, approval, budgets, cancellation, tool execution, and durable terminal state. The
  runtime proposes; it does not author authority.
- Every candidate echoes the runtime instance, command, run, attempt, and fence that admitted it.
- The process keeps one serializable working aggregate for model history and pending call
  correlations. Before waiting it sends the bounded plaintext over the authenticated internal
  connection; the server encrypts and stores it. A resume restores only a digest-checked continuation
  whose run, attempt, input generation, revision, and command sequence match.
- Public proof evidence is saved in the Pod's temporary scratch before the first bind. A container
  restart on the same Pod reuses that public evidence and receives a fresh model key in memory. No
  private proof key or model key is written to disk.
- Binding refusal is permanent. Exceptional and clean-close transport loss reconnect with bounded
  jitter. Non-terminal candidates are not replayed after ambiguous delivery. A terminal candidate
  may replay unchanged after an ambiguous network loss; an explicit HTTP refusal is permanent.
- Secrets are read at their point of use and never included in logs, spans, candidates, checkpoints,
  command-line arguments, or environment-derived error messages.

## Dependency direction

Dependencies flow from process composition towards narrower mechanisms:

```text
runtime → bootstrap / transport → attempts → model_loop / protocol
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
