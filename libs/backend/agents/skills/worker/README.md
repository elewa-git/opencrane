# Governed skill worker bootstrap client

> [backend](../../../../../README.md) › [agents](../../../../README.md) › [skills](../../../README.md) › worker

## What it owns

This dependency-free Python package is the bootstrap step for the governed skill-worker image
build. A released authoring or tool-runner Pod reads an opaque bootstrap reference and an
audience-bound projected token from read-only files, then acknowledges that one reference to its
same-silo OpenCrane Service. A *silo* is one customer's isolated OpenCrane deployment.

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

The client does not execute skill code, read artifacts, or hold Kubernetes, database, or object-store
access. If a value is missing, malformed, redirected, or answered with anything other than the
minimal positive receipt, it stops without retrying or exposing a secret.

## Public surface

- `acknowledge` — sends one fail-closed bootstrap acknowledgement using projected files.
- `main` — reads the three deployment-owned environment variables and returns a process exit code.

## Boundary

The worker validates only the fixed in-cluster endpoint and sends only the opaque reference. The
OpenCrane server, not this package, validates the Kubernetes TokenReview result against the canonical
worker Pod and consumes the reference exactly once.

## Dependency direction

Tagged `scope:skills`: the package uses only Python's standard library and has no app, database, or
Kubernetes-client dependency.

The client rejects redirects, malformed projected values, non-minimal replies, and every authority
outside the deployment-owned in-cluster endpoint. The server remains responsible for matching the
TokenReview result to the canonical worker Pod and consuming the reference exactly once.

## See also

- Parent group: [skills](../README.md)
- Job contract: [k8s launcher](../k8s-launcher/README.md)
