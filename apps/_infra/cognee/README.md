# cognee — vendored organisational-memory service

> [apps](../../README.md) › [_infra](../README.md) › cognee

<!-- A vendored-infra app: a pinned third-party product we run and wrap in Helm. No import
     alias — the deliverable is a Helm named-template library. Named by `project.json` (`cognee`). -->

## What it owns

A **vendored infra app** is a third-party product OpenCrane runs as-is and wraps in a Helm chart we own,
rather than software we write. This one wraps [Cognee](https://github.com/topoteretes/cognee), a
graph-RAG memory service — it stores organisational context as a graph and lets agents retrieve relevant
facts (RAG = retrieval-augmented generation, feeding stored knowledge into a model's prompt).

**Why we run it.** Cognee is the durable memory store OpenCrane's assistants query for org context.
It is a **required** per-silo service: each
customer slice (**silo** = one customer's isolated namespace and pods) gets its own dedicated Cognee so
two silos never share memory. This app owns the release-local Cognee `Deployment`, `Service`, storage,
and network-policy resources as named Helm templates; the silo umbrella chart
([`deploy-k8s`](../deploy-k8s/README.md)) only composes them into the parent release.

## Public surface

`Entrypoint:` the Helm named-template library under `helm/` (`opencrane.cognee.resources`), included by
the umbrella chart. No importable code.

## Boundary

OpenCrane owns *how* Cognee is deployed and reached (release-prefixed `Service`, persistence, network
policy, explicit disabling of Cognee's user-login middleware, and the endpoint helper the memory
gateway reads); the vendor owns Cognee's own behaviour and data model. Only the release-local
[memory gateway](../../memory-gateway/README.md) may connect to
this Service. **TODO:** authenticated BYO/non-private Cognee is deliberately not implemented; setting
`clustertenantManager.cognee.install: false` fails the render instead of exposing a direct endpoint.
Cognee itself can egress only to the release-local LiteLLM proxy, cluster DNS, and the optional local
telemetry collector. Shared LiteLLM is rejected for this private path because a standard Kubernetes
NetworkPolicy cannot safely name an external endpoint.

## Dependency direction

An app entrypoint (`type:app`, `scope:cognee`); composed by the silo chart, imported by no package.

## Runtime & config

- **Pinned image:** `cognee/cognee:1.2.1` (bump deliberately).
- `clustertenantManager.cognee.install` — must remain `true` for the private deployment design.
- `clustertenantManager.cognee.service.port` — the port the memory gateway's endpoint helper derives (default `8000`).
- `clustertenantManager.cognee.persistence.enabled` — mount a PVC; when on, Cognee's relational/identity
  DB, graph store, and vector store are pointed at `/cognee-data` so they survive pod restarts.
- `clustertenantManager.cognee.image.*`, `.podAnnotations` — image override and restart annotations.
- `sharedPlatform.litellm.mode` — must remain `instance` while private Cognee is installed.
- `ENABLE_BACKEND_ACCESS_CONTROL=false` and `REQUIRE_AUTHENTICATION=false` are fixed Deployment
  settings, not operator switches; the authenticated gateway and NetworkPolicy own this private
  service's access boundary.

## See also

- Parent index: [_infra](../README.md)
- Silo chart that composes it: [deploy-k8s](../deploy-k8s/README.md)
- Sibling infra: [litellm](../litellm/README.md) · [obot](../obot/README.md)
