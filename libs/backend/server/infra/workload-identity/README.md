# @opencrane/backend/server/infra/workload-identity — projected workload identity

> [backend](../../../README.md) › [server](../../README.md) › [infra](../README.md) › workload-identity

## What it owns

This package is the server's narrow Kubernetes identity adapter. A projected ServiceAccount token is
a short-lived credential mounted into a Pod; Kubernetes TokenReview verifies it without giving that
Pod permission to inspect the cluster. This package submits the credential, requires the
server-selected audience, and turns the authenticated subject into a bounded, credential-free
identity for the next transport or backend authority.

```
 workload Pod
      │ projected token + expected audience
      ▼
 ┌────────────────────────────────┐
 │ workload-identity  ◄── HERE     │  TokenReview + exact subject parsing
 └───────────────┬────────────────┘
                 │ reviewed namespace · ServiceAccount · Pod UID
                 ▼
 runtime stream / controller / worker router
```

**In this flow:** [agent-runtime-stream](../agent-runtime-stream/README.md) ·
[execution runs](../../../agents/execution/runs/main/README.md) ·
[skill execution](../../../agents/skills/execution/main/README.md)

It owns the fixed agent-controller, OCI MCP executor, artifact-preprocessor, artifact-scanner,
memory-gateway server, and channel-proxy adapters; the skill-worker adapter whose exact coordinates
are checked by durable bootstrap authority; and the mutually exclusive personal/managed runtime
adapters. Invariant: an unauthenticated review, wrong
audience, unexpected namespace or ServiceAccount, missing bound Pod UID, or ambiguous runtime
audience returns no identity. The raw token and full Kubernetes response never leave this package.

## Public surface

- `_CreateAgentControllerTokenReviewer` — binds controller dispatch to one namespace, audience, and
  ServiceAccount.
- `_CreateMcpExecutorTokenReviewer` — returns an OCI MCP companion identity only when Kubernetes
  confirms its namespace, zero-RBAC ServiceAccount, audience, and bound Pod UID.
- `_CreateArtifactPreprocessorTokenReviewer` — binds preprocessing to its isolated worker namespace.
- `_CreateChannelProxyTokenReviewer` — binds channel resolution to one deployment-selected audience,
  namespace, and ServiceAccount without duplicating Kubernetes TokenReview in the application root.
- `_CreateSkillWorkloadTokenReviewer` — verifies a server-selected audience and returns the bound
  worker coordinates for later bootstrap checks.
- `_CreateRuntimeTokenReviewer` — separates personal and managed runtime audience, namespace, and
  ServiceAccount grammars.
- `_ValidateRuntimeIdentityNamespaces`, `_ValidateIsolatedWorkloadNamespace` — fail startup when
  trusted and untrusted workload identity planes overlap or use malformed Kubernetes names.
- `RuntimeTokenReviewer`, `RuntimeWorkloadIdentity`, and the fixed/skill reviewer types — narrow
  credential-free ports consumed by transports and backend routers.

## Boundary

This library authenticates Kubernetes workload identity only. It does not look up a run, assignment,
organisation, grant, approval, or artifact, and it never authorizes an action from a token alone.
The consuming backend authority must bind the reviewed coordinates to durable product state.

## Dependency direction

Tagged `scope:workload-identity` (`layer:infra`): it may import shared contracts and observability
only. It must not import an app, Prisma, a backend authority, or another transport package.

## Runtime & config

The composing process supplies the Kubernetes authentication client and deployment-owned
namespaces. Audiences and fixed ServiceAccount names come from shared wire contracts; this package
reads no environment variables and opens no listener.

## See also

- Parent index: [infra](../README.md)
- Siblings: [agent-runtime-stream](../agent-runtime-stream/README.md) · [auth](../auth/README.md) · [api](../api/README.md)
