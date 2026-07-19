# Run lifecycle

How a run — one execution of an agent — moves from request to completion, and why
you can trust what you see of it. This page is the architecture half of the
chapter: it assembles the capabilities, identities, boundaries, and data
guarantees of the previous pages into the thing they exist for.

## The shape of the system, briefly

Two structural rules govern the codebase behind everything on this page:

- **Apps own deployables; libraries own logic.** Everything that runs in the
  cluster is owned by exactly one directory under `apps/` — its process, chart,
  identity, and policies. The behaviour lives in `libs/`, imported by the app.
  No workload exists without a named owner.
- **Dependencies point one way.** Apps depend on libraries; libraries never
  import apps; domain libraries depend on models and contracts, not on each
  other's internals. The boundary rules are machine-enforced in CI.

That is why each trust boundary of this chapter maps one-to-one onto an app —
and why this page can describe the run lifecycle as a pipeline of small,
separately-owned steps.

## A run's life

A **run** is one attempt-tracked execution of an agent revision in a
**thread** — a conversation's ordered history of messages. Its state machine is
short, and (as the
[data authority page](/security-architecture/data-authority) explained) each
transition is trigger-guarded in Postgres:

```
 accepted ──▶ queued ──▶ assigned ──▶ running ──▶ completed
                │            │           │  ▲          or failed
                │            │           ▼  │          or cancelled
                └────────────┴──── waiting_for_approval
```

1. **Accepted.** The server admits the run: membership verified, grants
   evaluated, the agent revision published and active. The run row and its
   outbox event commit atomically.
2. **Queued.** The controller claims the derived desired Job over its
   authenticated API.
3. **Assigned.** The controller created the (suspended) Job; the server durably
   recorded its UID and issued the one-time bootstrap.
4. **Running.** The workload consumed its bootstrap, registered its per-attempt
   proof key, and the Job was unsuspended.
5. **Terminal.** Exactly one of `completed`, `failed`, `cancelled` — recorded
   once, immutable afterwards. A retry increments the run's `attempt` counter
   and starts the cycle again; every fencing guard is keyed on that number, so
   nothing from attempt *n* can act on attempt *n + 1*.

## The snapshot: a run's inputs, frozen

Before anything executes, the run's inputs are compiled into a
**`RunInputSnapshot`** — one immutable record of everything the runtime will be
given: the agent revision, the thread messages in the prompt, the approved
persona revision, artifact and skill revisions, scoped memory facts, tool
grants, model route, budgets, and the capability set — plus a digest of the
whole canonical snapshot.

The digest is the point. The run stores it; the snapshot row is immutable by
trigger; so what the runtime saw is permanently auditable, and two runs given
the same inputs are provably given the same inputs. Steering (below) never
edits the snapshot — mid-run input arrives as an append-only supplement.

::: info Status
The snapshot's schema, immutability, and digest binding are live. The single
assembler that compiles it — one named flow with persona loading as an explicit
step — is specified and scheduled for the runtime phase.
:::

## Events: committed before streamed

Everything a run does that you can see — text, tool calls, approvals, progress,
usage — is a **RunEvent**: a numbered row in Postgres, appended in strict
sequence per run.

The delivery rule that makes the transcript trustworthy is
**commit-before-SSE**: an event is durably committed *before* any client is
notified over the event stream (SSE — server-sent events, the one-way HTTP
stream the channel proxy relays). The stream is a projection of the database,
never the authority; a stream wake-up that gets lost loses nothing, because the
row is already there.

Delivery is resumable by **cursor**: a client that disconnects sends the last
sequence number it applied and receives everything after it — replayed from
Postgres, identical to the first delivery — before rejoining the live tail.
Database triggers enforce the other half: sequences must be contiguous, nothing
appends after a terminal event, and a terminal event must match the run
authority's actual terminal state.

```
 runtime callback ──▶ ingest (fenced, idempotent) ──▶ RunEvent row COMMITTED
                                                            │
                                              ┌─────────────┴─────────────┐
                                              ▼                           ▼
                                        SSE live tail            cursor replay after
                                        (a hint, not truth)      disconnect — same rows
```

::: info Status
The event store, sequencing, and terminal fencing are enforced in the database
today; the workload-authenticated ingest route and the SSE endpoint are the
next slices of the current build phase.
:::

## Steering: input while the run is busy

Send a message while your agent is mid-run and two things are simultaneously
true: the message must be durable *immediately*, and the run must not be
corrupted by it. OpenCrane resolves this with a **steering inbox** and one rule
about timing. The outcome, in one sentence: your message is either absorbed at
a safe point or visibly deferred to the next run — never dropped, and never
injected mid-tool.

The message is persisted at once (with a `steering.queued` event). It is
considered for absorption only at a **model-decision boundary** — the moment
after the current model response, tool results, or approval outcome is durably
recorded and *before the next model request*. At that boundary the server
atomically claims all eligible queued messages, appends `steering.absorbed`, and
the next model request includes them. A message can never interrupt a tool
mid-flight or alter an already-approved call.

The interesting case is the race with completion. Each absorption increments the
run's **input generation**; a model-derived completion carries the generation
its model request used. If steering was absorbed after that request, the
completion is from a stale generation — and it is *refused*: the run must
continue and address the new input rather than close over it. If instead
termination wins the race, the message is visibly recorded as
`steering.deferred` and an idempotent next run is created in the same
transaction to carry it. One outcome or the other is always durable — absorbed
or deferred, never silently dropped.

Authoritative stops are exempt from the generation guard: an abort, deadline,
budget exhaustion, or security revocation fences and terminates regardless —
with every queued message still receiving a durable disposition.

::: info Status
The steering contracts and events are fully designed (and the terminal-race
semantics fixed); the inbox and boundary-claim implementation is a named
remaining slice of the current build phase.
:::

## Sandboxed execution: OpenSandbox

Some work must not run in the conversational runtime at all — tenant-authored
Python, code execution, document generation. That work goes to a **sandbox
Job** on OpenSandbox, an execution substrate adopted behind a deliberately
narrow OpenCrane boundary (ADR 0009):

- Only the agent controller may call the OpenSandbox lifecycle API — it has no
  public ingress and is unreachable from agent and sandbox workloads alike.
- Each sandbox receives an **attenuated, attempt-scoped delegation**. It starts
  from the same user-∩-agent intersection as any capability, narrowed to the
  exact approved action and argument digest, then clipped by the sandbox
  profile's ceiling. The result is proof-bound to that one sandbox's workload
  identity and expiry — it can never exceed what the agent had, and no agent or
  provider credential is copied in.
- Egress policy is rendered from the approved capability *before* the sandbox
  is created; the sandbox cannot reach the lifecycle API or edit its own policy.
- Sandbox output becomes durable only through an authorised artifact-store
  finalisation; a retry is always a new attempt with a new proof — an execution
  with ambiguous side effects is never silently reused.

Production sandboxes require a hardened container runtime (gVisor or Kata —
runtimes that add a kernel-isolation layer between the sandbox and the host)
and fail closed when it is unavailable.

::: info Status
ADR 0009 is accepted; the OpenSandbox app boundary, its adapter contract, and
its negative tests are scheduled in the current build phase, with full
conformance testing in the runtime phase that follows.
:::

## The whole picture

```
 user message
   │  channel-proxy (edge: origin, identity, rate)
   ▼
 opencrane server ── grants ∩ membership ──▶ run accepted + snapshot digest
   │        ▲                                   │ (outbox, atomic)
   │        │ RunEvents (commit-before-SSE)     ▼
   │        │                            agent-controller ──▶ suspended Job
   │   run-ingest (fenced)                      │ ack UIDs ──▶ unsuspend
   │        │                                   ▼
   ▼        │                            agent-runtime (inert)
 SSE + cursor replay                            │ per-action capability + proof
   to the client                                ▼
                                     tools · artifact leases · sandbox Jobs
```

Every arrow is one of the chapter's mechanisms: an identity to verify, a
capability to prove, a boundary to cross, a row to commit. Remove any one of
them and the run still fails closed — which is the property the whole
architecture was chosen for.

> **See also:** [ADR 0008](https://github.com/italanta/opencrane/blob/main/docs/adr/0008-target-agent-contracts-and-workload-identity.md)
> and [ADR 0009](https://github.com/italanta/opencrane/blob/main/docs/adr/0009-opensandbox-sandbox-job-substrate.md)
> for the accepted decisions behind this page, and the
> [agent-loop replacement plan](https://github.com/italanta/opencrane/blob/main/docs/design/openclaw-agent-loop-replacement-plan.md)
> for the full event vocabulary and steering semantics.
