# Skill-authoring worker bootstrap client

> [backend](../../../../../README.md) › [agents](../../../../README.md) › [skills](../../../README.md) › worker

## What it owns

This dependency-free Python package supplies the bootstrap step for the skill-authoring validation worker.
A released Pod reads an opaque bootstrap reference and an audience-bound projected token from
read-only files, then acknowledges that one reference to its same-silo OpenCrane Service. A *silo*
is one customer's isolated OpenCrane deployment.

```
 released worker Pod
        │ projected token + opaque reference
        ▼
 ┌───────────────────────────┐
 │ worker bootstrap ◄── HERE  │ validates endpoint and sends one acknowledgement
 └─────────────┬─────────────┘
               │ token-authenticated acknowledgement
               ▼
 OpenCrane server ──► TokenReview + exact-Pod check + one-time consume
```

**In this flow:** [Job contract](../k8s-launcher/README.md) ·
[agent controller](../../../../../../apps/agent-controller/README.md)

The client does not run candidate skill code as a tenant tool, read artifacts directly, or hold Kubernetes, database, or object-store
access. If a value is missing, malformed, redirected, or answered with anything other than the
minimal positive receipt, it stops without exposing a secret. A 409 response can mean the Job was
released just before the controller saved its first Pod, so the authoring acknowledgement retries
that response for at most five minutes.

## Public surface

- `acknowledge_authoring_validation` — retries only the short race between authoring Job release and
  the controller saving its first Pod, for at most five minutes.

## Boundary

The worker validates only the fixed in-cluster endpoint and sends only the opaque reference. The
OpenCrane server, not this package, validates the Kubernetes TokenReview result against the canonical
worker Pod and consumes the reference exactly once.

## Dependency direction

Tagged `scope:skills`: the package uses only Python's standard library and has no app, database, or
Kubernetes-client dependency.

## See also

- Parent group: [skills](../README.md)
- Job contract: [k8s launcher](../k8s-launcher/README.md)
