# Obot MCP gateway

OpenCrane runs **Obot** as the in-cluster gateway for MCP (Model Context Protocol)
tools. This page separates Obot's runtime catalogue from OpenCrane's API-first
governance and per-tenant access decisions.

> See also: [Agent workspace and control](/integrators/agent-workspace) (how
> allowed tools appear to an agent), [Control access](/guide/permissions) (the admin
> workflow), and [Identity and connection auth](/security/identity) (human and workload identity).

## What Obot owns

Obot is the upstream [`obot-platform/obot`](https://github.com/obot-platform/obot)
runtime gateway. It holds MCP server connections and starts container-backed MCP
servers in the silo namespace.

Obot loads its default catalogue from the local directory configured by
`mcpGateway.catalog.path`. Operators populate that directory through a deployment
mechanism such as a catalogue volume or git-sync sidecar. When Obot authentication is
enabled, an administrator can also add Git Source URLs through Obot Admin.

Obot does not poll the OpenCrane control plane for catalogue entries. Publishing an
OpenCrane `McpServer` record therefore governs what OpenCrane advertises and entitles;
it does not silently install that server into Obot. Keep the Obot catalogue source and
the OpenCrane governance record aligned as one operator workflow.

```
catalogue volume / Git Source URL ──▶ Obot catalogue ──▶ MCP runtime pods
                                           ▲
                                           │ tool calls
tenant agent ──────────────────────────────┘
     ▲
     │ effective AccessPolicy + grants + TOOLS.md
     │
OpenCrane UI / API ──▶ control-plane governance records
```

## API-first governance

The authenticated OpenCrane API owns the product-facing catalogue, installation and
access workflows:

| Audience | Endpoint | Purpose |
|----------|----------|---------|
| User | `GET /api/v1/mcp/catalog` | List published servers the caller is entitled to see |
| User | `/api/v1/mcp/installed` | Install, remove and inspect the caller's tools |
| User | `/api/v1/mcp/installed/{serverId}/credential` | Connect or clear a write-only credential |
| Org admin | `/api/v1/mcp/servers` | Review, approve, publish, disable and reject servers |
| Org admin | `/api/v1/mcp/servers/{id}/access` | Read or replace server access rules |
| Platform admin | `/api/v1/mcp-servers` | Manage the underlying server registry and scoped grants |
| Org admin | `/api/v1/policies` | Manage AccessPolicies, including MCP allow/deny sets |

The routes are mounted in
[`libs/backend/server/gateways/mcp/main/src/routes`](https://github.com/elewa-git/opencrane/blob/main/libs/backend/server/gateways/mcp/main/src/routes)
and use the same authentication and authorisation gates as the OpenCrane UI. Custom
integrations should use these routes or the generated contracts client rather than
writing control-plane tables directly.

## Per-tenant access

A tenant receives an effective `AccessPolicy` through its explicit `policyRef`, a
matching selector, or the operator default. The control plane combines that policy
with user, group and tenant grants, then exposes the resulting MCP allow/deny decision
in the tenant's effective contract.

The same compiled decision determines which tools are rendered into the
platform-owned `TOOLS.md`. An agent therefore sees only tools that its identity and
policy permit. There is no separate tool-policy field on the Tenant resource.

::: warning Catalogue presence is not entitlement
A server can exist in Obot without being visible to a tenant. Conversely, an
OpenCrane governance record is not usable until the corresponding catalogue entry is
available in Obot. Treat runtime installation and API governance as two required
halves of one change.
:::

## Deployment and network posture

- The Obot app owns its Deployment and Service templates under
  `apps/_infra/obot/helm/templates/`; the silo chart composes that app-owned unit from
  `apps/_infra/deploy-k8s/templates/app-rollups.yaml`.
- `OBOT_SERVER_MCPRUNTIME_BACKEND=kubernetes` makes Obot start MCP servers as pods in
  the silo namespace.
- There is no external Obot ingress. NetworkPolicy admits the gateway only from the
  tenant, control-plane and operator workloads.
- Authentication is disabled by default and must be enabled before using per-user
  credentials or Obot access policies. Enabling it requires the documented one-time
  OIDC bootstrap in the `mcpGateway.auth` Helm values.
- Credential encryption at rest is separately gated by
  `mcpGateway.encryptionAtRest.enabled`; production deployments that store credentials
  should enable it with a dedicated key Secret.

## Operating the catalogue

1. Put a reviewed MCP catalogue entry in the directory mounted at
   `mcpGateway.catalog.path`, or add its Git Source URL in authenticated Obot Admin.
2. Create or update the corresponding OpenCrane governance record through the
   authenticated API.
3. Approve and publish the server, then assign its access rules or grants.
4. Confirm the intended user can see it through `GET /api/v1/mcp/catalog` and that an
   unintended user cannot.
5. Verify the tenant's platform-owned `TOOLS.md` reflects the same decision after the
   effective-contract refresh.

The chart deliberately leaves `mcpGateway.catalog.path` empty unless the operator
provides a catalogue source. An empty source means Obot has no default managed tools;
it is not repaired by a background control-plane sync.
