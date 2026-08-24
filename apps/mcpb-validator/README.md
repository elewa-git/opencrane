# mcpb-validator — isolated MCP bundle worker foundation

> [apps](../README.md) › mcpb-validator

## What it owns

This app owns the future worker image and Kubernetes namespace for checking and running accepted
MCP bundles. An MCP bundle is a packaged MCP server. The worker has its own empty namespace and a
service account with no Kubernetes permissions.

```
 saved MCP bundle check
          │ future controller creates one Job
          ▼
 ┌─────────────────────────────────┐
 │ mcpb-validator  ◄── HERE         │
 │ no database or Kubernetes access │
 └─────────────────────────────────┘
```

**In this flow:** [OpenCrane server](../opencrane/README.md) · the future MCPB controller.

The image currently refuses to run because the server assignment protocol does not exist yet. This
is deliberate: creating the image and namespace must not accidentally make third-party bundle code
executable.

## Public surface

- `src/mcpb_validator.py` — fail-closed one-shot worker entrypoint.
- `deploy/Dockerfile` — digest-pinned worker image build.
- Helm chart — restricted namespace, zero-RBAC service account, quota, and default-deny network.

## Boundary

The image accepts no command, artifact URL, database credential, registry credential, or Kubernetes
credential. It has no running Job or network exception until the later controller and server route
are reviewed together.

## Dependency direction

Tagged `scope:mcpb-validator`, this app owns only its deployment contract and imports no application
or library source.

## Runtime & config

The chart creates a namespace but no Pod. Its only settings are the namespace, the fixed service
account name, and resource quota. A future release must publish the worker image by digest before a
controller can create a Job.

## See also

- Parent index: [apps](../README.md)
- MCP governance: [MCP package](../../libs/backend/server/gateways/mcp/main/README.md)
