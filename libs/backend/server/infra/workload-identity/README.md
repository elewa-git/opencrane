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
 computer / controller / worker router
```

**In this flow:** [conversations](../../conversations/main/README.md) ·
[execution runs](../../../agents/execution/runs/main/README.md)

It owns fixed-account reviewers for the agent controller, artifact preprocessor, artifact scanner,
and memory-gateway server; and Pod-bound reviewers for the MCP executor, conversation computer,
and skill-validation worker. Invariant: an unauthenticated review, wrong
audience, unexpected namespace or ServiceAccount, missing bound Pod UID, or ambiguous runtime
audience returns no identity. The raw token and full Kubernetes response never leave this package.

## Public surface

- `_CreateAgentControllerTokenReviewer` — binds controller dispatch to one namespace, audience, and
  ServiceAccount.
- `_CreateMcpExecutorTokenReviewer` — returns an OCI MCP companion identity only when Kubernetes
  confirms its namespace, zero-RBAC ServiceAccount, audience, and bound Pod UID.
- `_CreateSkillAuthoringValidationTokenReviewer` — binds the Python validation Job to its fixed
  audience, namespace, ServiceAccount, and saved Pod UID.
- `_CreateArtifactPreprocessorTokenReviewer` — binds preprocessing to its isolated worker namespace.
- `_CreateConversationComputerTokenReviewer` — binds a computer to the release-selected namespace,
  ServiceAccount, audience, and Kubernetes-confirmed Pod UID.
- `_CreateArtifactScannerTokenReviewer` and `_CreateMemoryGatewayServerTokenReviewer` — bind the
  scanner and memory-gateway caller to their fixed deployment identities.
- `_ValidateIsolatedWorkloadNamespace` — fails startup when a worker shares the server namespace or
  its configured Kubernetes name is malformed.
- `RuntimeTokenReviewer`, `RuntimeWorkloadIdentity`, and the fixed/skill reviewer types — narrow
  credential-free ports consumed by transports and backend routers.

## Boundary

`configuration/` validates namespace configuration. `token-review/` owns the Kubernetes review,
subject parsing, and credential-free types. `reviewers/` binds those operations to fixed-account
or Pod-bound callers. All reviewers share the same audience check and subject parser; splitting
their composition does not add another authentication authority.

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
- Siblings: [agent-sandbox](../agent-sandbox/README.md) · [auth](../auth/README.md) · [api](../api/README.md)
