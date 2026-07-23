# @opencrane/server/_infra/agent-runtime-stream — runtime-initiated transport

> [server](../../README.md) › [_infra](../README.md) › agent-runtime-stream

## What it owns

This package is the OpenCrane server's narrow transport for agent runtimes. Its current
`_CreateRuntimeTokenReviewer` factory is deliberately bounded to personal runtime Pods; a managed
runtime needs its own audience and ServiceAccount-specific reviewer before it can use this transport.
The transport turns an outbound request from a runtime Pod into an authenticated stream with bounded
inbound requests, without becoming an authority over runs, commands, or agent output.

The transport first asks an injected TokenReview adapter which Kubernetes Pod presented the
credential. It then validates the stream opening frame, emits only commands supplied by an injected
domain authority, and forwards runtime candidates back to that authority for acceptance or refusal.
After an accepted candidate it wakes local idle streams to re-check the durable authority. A bounded
recovery wait re-checks even if that disposable wake-up signal is lost. Heartbeats keep the
connection alive without inventing work.

```text
 agent-runtime Pod
       │ projected identity + validated HTTP/SSE exchange
       ▼
 ┌──────────────────────────────────────┐
 │ agent-runtime-stream  ◄── HERE        │  authenticate and frame only
 └───────────────┬──────────────────────┘
                 │ verified identity + parsed command/candidate
                 ▼
 agent run authority ................. decides and persists
```

**In this flow:** [agent-runtime](../../../../apps/agent-runtime/README.md) ·
[runtime authority](../../../backend/agents/execution/protocol/README.md) ·
[wire contracts](../../../contracts/README.md)

Invariant: transport syntax never becomes business authority. A token/Pod mismatch, malformed input,
non-monotonic command, oversized request body, or unavailable injected authority fails closed. When
the connection drops it signals the loss to the injected authority through a port call — never an
import of the backend authority package — so a lost stream can release its runtime-instance binding.
The package does not repair identity, choose a run, mint a command, or persist a candidate.

## Public surface

- `_RegisterInternalAgentRuntimeStream(options)` — builds the internal Express router for the
  authenticated stream and candidate endpoints.
- `_CreateRuntimeTokenReviewer` — fail-closed Kubernetes TokenReview adapter for the fixed runtime
  audience, namespace, ServiceAccount grammar, and bound Pod UID.
- `RuntimeTokenReviewer` — identity-review port used by the stream transport.
- `RuntimeCommandStreamAuthority` — port through which the agent run authority supplies commands,
  admits candidate output, and (optionally) is told when a stream was lost so it can release its
  runtime-instance binding.
- `RuntimeCommandWakeup` — process-local hint fan-out for waking idle streams; it stores no command
  and never authorizes work.
- `RuntimeStreamTransportOptions` — fixed body, heartbeat, recovery, and wake-up limits plus the
  two authority ports.

## Boundary

This is server-owned infrastructure, not an agent-product specialization. It owns HTTP parsing,
server-sent-event framing, heartbeats, credential extraction, TokenReview delegation, and tracing.
It owns no Prisma client, assignment lookup, lease, command ordering source, candidate persistence,
runtime process, or Kubernetes mutation.

The OpenCrane composition injects the Prisma-backed durable dispatch authority, so an authenticated
runtime now receives its fenced `start_attempt` command and has its lifecycle candidates admitted or
refused by that authority. This transport still owns none of that decision: minting, ordering,
candidate persistence, and the model/tool executor all live behind the injected ports.

## Dependency direction

Tagged `scope:agent-runtime-stream` and `layer:infra`. It may import shared contracts and
observability, while the `apps/opencrane` entrypoint injects business-authority adapters. It must not
import apps, Prisma, or backend persistence implementations.

## Runtime & config

The composing app supplies maximum request bytes, heartbeat interval, recovery interval, runtime
namespace, and command/candidate authority. The recovery interval is deliberately much slower than
the old one-second poll: accepted candidates wake streams promptly, while the durable recovery read
keeps a lost local signal from losing a command. This library reads no environment variables and
opens no listener by itself.

## See also

- Parent index: [_infra](../README.md)
- Runtime process: [agent-runtime](../../../../apps/agent-runtime/README.md)
- Runtime authority: [backend/agents/runtime](../../../backend/agents/execution/protocol/README.md)
- Shared protocol: [contracts](../../../contracts/README.md)
