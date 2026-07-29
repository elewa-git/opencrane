# cognee — vendored organisational-memory service

> [apps](../../README.md) › [_infra](../README.md) › cognee

<!-- A vendored-infra app: a pinned third-party product we run and wrap in Helm. No import
     alias — the deliverable is a Helm named-template library. Named by `project.json` (`cognee`). -->

## What it owns

A **vendored infra app** is a third-party product OpenCrane runs as-is and wraps in a Helm chart we own,
rather than software we write. This one wraps [Cognee](https://github.com/topoteretes/cognee), a
graph-RAG memory service — it stores organisational context as a graph and lets agents retrieve relevant
facts (RAG = retrieval-augmented generation, feeding stored knowledge into a model's prompt).

**Why we run it.** Cognee is the memory OpenCrane's assistants query for org context, and the store the
admin UI syncs awareness grants and permissions into. It is a **required** per-silo service: each
customer slice (**silo** = one customer's isolated namespace and pods) gets its own dedicated Cognee so
two silos never share memory. This app owns the release-local Cognee `Deployment`, `Service`, storage,
and network-policy resources as named Helm templates; the silo umbrella chart
([`deploy-k8s`](../deploy-k8s/README.md)) only composes them into the parent release.

## Public surface

`Entrypoint:` the Helm named-template library under `helm/` (`opencrane.cognee.resources`), included by
the umbrella chart. No importable code.

## Boundary

OpenCrane owns *how* Cognee is deployed and reached (release-prefixed `Service`, persistence, network
policy, and the endpoint helper the server reads); the vendor owns Cognee's own behaviour and data
model. Set `clustertenantManager.cognee.install: false` to bring your own external/shared Cognee — then
no workload is rendered and the server talks to the configured endpoint instead.

## Dependency direction

An app entrypoint (`type:app`, `scope:cognee`); composed by the silo chart, imported by no package.

## Runtime & config

- **Pinned image:** `cognee/cognee:1.2.1` (bump deliberately).
- `clustertenantManager.cognee.install` — render the in-cluster workload (default) or BYO an external one.
- `clustertenantManager.cognee.service.port` — the port the server's endpoint helper derives (default `8000`).
- `clustertenantManager.cognee.persistence.enabled` — mount a PVC; when on, Cognee's relational/identity
  DB, graph store, and vector store are pointed at `/cognee-data` so they survive pod restarts.
- `clustertenantManager.cognee.image.*`, `.podAnnotations` — image override and restart annotations.

## See also

- Parent index: [_infra](../README.md)
- Silo chart that composes it: [deploy-k8s](../deploy-k8s/README.md)
- Sibling infra: [litellm](../litellm/README.md) · [obot](../obot/README.md)
