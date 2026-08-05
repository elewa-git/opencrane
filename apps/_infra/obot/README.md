# obot — vendored MCP tool gateway

> [apps](../../README.md) › [_infra](../README.md) › obot

<!-- A vendored-infra app: a pinned third-party product we run and wrap in Helm. No import
     alias — the deliverable is a Helm named-template library. Named by `project.json` (`obot`). -->

## What it owns

A **vendored infra app** is a third-party product OpenCrane runs as-is and wraps in a Helm chart we own.
This one wraps [Obot](https://github.com/obot-platform/obot), an **MCP gateway** — MCP is the Model
Context Protocol, the standard way agents connect to external tools, and the gateway is the single
governed door through which those tool connections pass.

**Why we run it.** In a **silo** (one customer's isolated slice) the assistants must reach tools only
through one auditable, access-controlled gateway rather than each pod dialling tools directly. Obot is
that gateway: it keeps custody of integration credentials, and after a server-side approval a runtime
Job invokes the tool against Obot's MCP proxy directly with an attempt-scoped API key — tool payloads
never transit the OpenCrane server. This app owns the release-local Obot `Deployment`,
`ServiceAccount`, RBAC (Role and binding), `Service`, and `NetworkPolicy` as named Helm templates,
composed by the silo umbrella chart ([`deploy-k8s`](../deploy-k8s/README.md)).

The ingress policy admits three caller classes to the gateway port: tenant pods, the opencrane-server
(management: custody provisioning + attempt-key minting with the mounted service credential named by
`mcpGateway.serviceTokenExistingSecret`), and — when the agent controller is enabled — the two
isolated runtime namespaces (`component: agent-runtime` pods) for direct approved tool invocation.
Network reach is only the floor; Obot authorises each data-plane call with the attempt-scoped key.

## Public surface

`Entrypoint:` the Helm named-template library under `helm/` (deployment/service/rbac/networkpolicy
templates), included by the umbrella chart. No importable code.

## Boundary

OpenCrane owns *how* Obot is deployed, permissioned, and networked; the vendor owns the gateway's own
MCP behaviour and custom resources (`*.obot.obot.ai`). **Shared mode**
(`opencrane.mcpGatewayShared`) renders none of the managed resources and points the silo at a configured
shared gateway URL instead.

## Dependency direction

An app entrypoint (`type:app`, `scope:obot`); composed by the silo chart, imported by no package.

## Runtime & config

- **Pinned image:** `ghcr.io/obot-platform/obot:v0.23.1` (bump deliberately).
- `mcpGateway.enabled` / `opencrane.mcpGatewayShared` — render an in-cluster workload, or use a shared URL.
- `mcpGateway.replicas`, `mcpGateway.image.*`, `.podAnnotations` — scale, image, and restart controls.
- `mcpGateway.encryptionAtRest.enabled` (+ `secretName`/`secretKey`) — an init container replicates
  Obot's encryption-at-rest setup with a custom provider key; the container refuses to start if the
  provider is `custom` and no key is supplied.
- `mcpGateway.serviceTokenExistingSecret` (+ `mcpGateway.serverTimeoutSeconds`) — names the
  pre-provisioned Secret (key `token`) carrying the Obot service credential the opencrane-server
  uses for custody and attempt-key management. Empty (default) leaves the transport off and the
  server fail-closed. Live-shape qualification against Obot v0.23.1 remains gated on issue #337.

## See also

- Parent index: [_infra](../README.md)
- Silo chart that composes it: [deploy-k8s](../deploy-k8s/README.md)
- Sibling infra: [cognee](../cognee/README.md) · [litellm](../litellm/README.md)
