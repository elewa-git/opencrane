# @opencrane/backend/agents/runtime/workloads/controller-transport — controller HTTP transport

> [backend](../../../../README.md) › [agents](../../../README.md) › [runtime](../../README.md) › [workloads](../README.md) › controller-transport

## What it owns

This package is the one transport every controller-hosted workflow uses to call its private server
routes. A controller authority describes each route (path, method, body, conflict sentinel, strict
response parser); this package owns everything below that description: the rotating projected-token
read, the pinned in-cluster server origin, the request timeout and shutdown signal, the 16 KiB
response bound, and the shared 409-means-stale rule.

```text
workflow handler (Absurd task on the controller)
        │ route + body + conflict sentinel + parser
        ▼
┌────────────────────────────────────┐
│ controller transport  ◄── HERE     │  token, origin, bound, 409 → sentinel
└────────────────────────────────────┘
        │ authenticated JSON exchange
        ▼
private agent-controller server routes
```

**In this flow:** the skill-authoring, artifact-preprocessing, and AgentRun workflow HTTP
authorities each wrap this exchange with their own routes and validators. Domain semantics —
trace names, outcome vocabularies, and response shapes — stay in those authorities.

Invariant: a controller request either reaches the exact configured
`<service>.<namespace>.svc.cluster.local` origin with a freshly read projected token, or it does
not leave the process. A 409 always maps to the caller's conflict sentinel so a stale delivery
cannot continue as if it were current.
