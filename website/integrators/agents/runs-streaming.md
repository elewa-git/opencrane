# Runs & streaming

Yes: the `AgentLoopDriver` streams messages and progress while it executes. The UI does not wait for
a long model turn, MCP call, sandbox job or subagent to finish before showing activity.

> See also: [Agents overview](/integrators/agents/),
> [API overview](/reference/api-overview), and
> [Telemetry & logging](/operators/telemetry-logging).

::: info Implementation status
The canonical event vocabulary and persist-before-publish rule are accepted. The Postgres writer,
live SSE projection and selected streaming driver are 🔶 planned across Phases D and E.
:::

## One durable stream

```
model/tool/sandbox callback
            │
            ▼
AgentLoopDriver adapter
            │ proof-bound candidate + fence + stable candidate ID
            ▼
OpenCrane internal run-ingest API
            │ validate and commit through the sole Postgres writer
            ▼
canonical RunEvent
            │ commit first
            ├──────────────▶ SSE wake-up ──▶ responsive UI
            │
            └──────────────▶ cursor replay after reconnect
```

The runtime never connects to Postgres. The toolkit stream is an input and the authenticated
OpenCrane run-ingest API is the sole writer. `RunEvent` is the product stream. Every visible model,
tool, approval, artifact, usage, progress and terminal update receives the next ordered sequence and
is committed before a live subscriber can receive it.

## Driver contract

The bounded driver receives an immutable `RunInputSnapshot`, an event sink, a shell-owned steering
source and an `AbortSignal`. It emits model, tool-request, usage and model-derived terminal candidates
while the producing step is still running. Controller callbacks add governed tool and sandbox progress.
OpenCrane normalizes both into the public vocabulary:

```text
run.accepted
run.started
message.started
message.delta
message.completed
tool.requested
tool.approval_required
tool.started
tool.progress
tool.completed
context.compaction_started
context.compaction_completed
steering.queued
steering.absorbed
steering.deferred
run.usage
run.completed | run.failed | run.cancelled
```

A driver that buffers the whole turn and emits only a final answer fails conformance. Deliberately
slow tools must emit bounded progress or heartbeat events so the UI can show the active tool,
elapsed time and latest safe status.

The driver does not emit `run.accepted`, approval decisions, or `steering.*`. Those canonical events
come only from OpenCrane's send, policy, boundary-claim, and terminal transactions. The steering
source binds run proof, attempt, fence, cursor and input generation inside the runtime shell; the
toolkit adapter supplies only a neutral boundary ID.

## Responsive without losing correctness

- High-frequency raw token callbacks may be coalesced into one canonical `message.delta` within a
  small bounded latency/size window **before** the RunEvent append. A whole turn or tool execution
  may not be buffered, and a persisted event is never re-shaped for live delivery.
- SSE is one-way delivery. Send, abort and approval decisions remain authenticated, idempotent HTTP
  commands.
- Notifications only wake subscribers. Postgres is the authority, so a crash after commit but before
  notification changes latency, not correctness.
- Candidate submission is idempotent by `(runId, attempt, candidateId)`. A timeout is retried with
  the same ID and returns the same canonical sequence; it cannot append a duplicate event.
- Model output and model-derived completion/ordinary-failure candidates name the input generation
  used by their request. A stale model-derived terminal returns continue and appends no terminal
  event.
- Delivery is at-least-once. Clients fold by `(runId, sequence)` and reconnect from the last applied
  cursor, preventing gaps or duplicate rendering.
- Slow clients do not backpressure the model or tool. They are disconnected and resume by cursor;
  canonical events remain intact.
- A unique terminal event closes the run. Later output is rejected or reconciled as late upstream
  noise rather than appended to the transcript.

## Mid-run messages

Sending another message does not abort a long model, MCP, or sandbox step. The authenticated send
endpoint first stores one canonical user Message and emits `steering.queued`. At the next safe
model-decision boundary—after the current result is durable and before the next model request—the
runtime presents a stable boundary ID to OpenCrane.

OpenCrane's sole writer resolves the outcome transactionally:

1. If the active run still owns the boundary, it claims the queued Messages in thread order, emits
   `steering.absorbed`, and returns the same immutable batch on a retry.
2. If the run's terminal transition wins first, it emits `steering.deferred` and creates or reuses
   the idempotent next run.

Send, claim and termination share the same row-locked active-run serialization. If a send races with
termination, it either queues on the still-active run or starts/reuses the next run—never a closed
run. Each absorption advances a canonical input generation. A model-derived terminal from an older
generation returns continue, so claim-first input cannot be skipped by a stale final response.

Abort, deadline, budget, security/policy revocation and lease loss are different: they are
authoritative stops and terminate once regardless of input generation. They launch no extra
model/tool work. Unclaimed input remains durably pending and must pass normal admission before a
later run; already absorbed input stays attached to the stopped run and is not silently replayed.
The UI shows that the stop occurred before further model work and can offer an explicit authorized
retry.

The events contain stable message, boundary, absorption, and next-run IDs—not duplicate message
content. The UI can therefore show “will influence this run” or “started the next run,” and reconnect
to the same answer after a browser or Pod restart. A message queued while approval is pending does
not modify the pending tool call or its arguments. Use the explicit reject or abort command to stop
an action; steering is considered only before the next model decision.

## Queueing and recovery

Interactive event delivery does not traverse the background work queue. The run writer commits
events directly and SSE tails that log. Mid-run input uses a small ordered Postgres steering inbox,
claimed at model-decision boundaries; it is canonical control-plane state, not a worker queue.
Postgres-backed outbox/worker queues handle provisioning, indexing and other asynchronous side
effects where replay is useful.

If a runtime dies, the run lease and fencing token prevent a second writer from interleaving events.
OpenCrane either resumes from a safe persisted checkpoint or records one deterministic terminal
failure. It never blindly retries after visible output or a tool dispatch that could duplicate a
side effect.

These RunEvents are durable business evidence, distinct from OpenTelemetry traces, logs and metrics.
Operators use both: the Run ledger explains product state; [Telemetry & logging](/operators/telemetry-logging)
explains service behaviour.
