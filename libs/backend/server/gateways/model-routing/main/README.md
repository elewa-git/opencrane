# @opencrane/backend/server/gateways/model-routing — model routing defaults

> [backend](../../../../README.md) › [server](../../../README.md) › [gateways](../../README.md) › model-routing

## What it owns

This package is part of the **gateway-governance plane** — the side of OpenCrane that governs the
external models agents may use. Model calls do not go straight to a provider; they go through
**LiteLLM**, a self-hosted proxy that presents many providers behind one interface. This package
decides *which* model each request should use and keeps LiteLLM's catalogue in step.

It sits between the provider gateway (which registers a tenant's models into LiteLLM) and the agent
runtime (which calls LiteLLM). Its core job is resolving the *effective* model for a request:
a skill may pin a model, or ask for `auto`, or defer — and the default is resolved by scope, with a
ClusterTenant (one customer's tenancy) default taking precedence over the platform-wide Global one.
It also holds per-tenant model allowlists and the maths for evaluating candidate routing policies.

```
 provider BYOK (bring-your-own-key) key set   →   models registered in LiteLLM
        │
        ▼
 ┌────────────────────────────────────┐
 │  model-routing  ◄── HERE            │  resolve effective model (skill pin → auto → scope default:
 │                                     │  ClusterTenant then Global) · per-tenant allowlist
 │                                     │  · shadow-router maths (off-policy eval, savings)
 └────────────────────────────────────┘
        │  the model id for this request  (+ routing defaults API)
        ▼
 agent runtime calls LiteLLM with the resolved model
```

**In this flow:** [providers](../../providers/main/README.md) *(registers keys + models)* · LiteLLM [(vendored app)](../../../../../../apps/_infra/litellm/README.md)

Invariant: `_ResolveSkillModel` is a *pure* function over already-fetched rows — it performs no I/O
and never calls LiteLLM; an empty ClusterTenant default never shadows a usable Global one, and when
nothing resolves it returns `null` so the pod falls back to its own configured default. The
off-policy-evaluation (OPE) and savings helpers are likewise pure estimators used to decide, in
shadow mode, whether a cheaper candidate model would hold quality before it ever routes live
traffic. The BYOK (bring-your-own-key) model catalogue (`_BYOK_PROVIDER_CATALOG`) is data, tuned as providers ship models.

## Public surface

- `modelRoutingDefaultsRouter`, `_RegisterInternalTenantModels` — the
  routers, mounted at `/api/v1/model-routing/*` and `/api/internal/tenant-models`.
- `_ResolveSkillModel` — resolve a skill's effective model by the locked precedence chain.
- `_ProvisionByokKey`, `_DeprovisionByokKey`, `_RegisterLiteLlmModel`, `_UpsertLiteLlmCredential`,
  `_DeleteLiteLlmCredential` — the LiteLLM provisioning helpers reused by the provider gateway.
- `_EstimateSavings`, `_ReplayEstimate`, `_DoublyRobustEstimate`, `_OpeEstimateWithCi` — the pure
  shadow-router estimators. `_BYOK_PROVIDER_CATALOG` — the per-provider default model catalogue.
- `_IssueAttemptLiteLlmKey` — mint one short-lived, alias- and budget-bound LiteLLM virtual key for a
  single agent-run attempt (fails hard; the master key never leaves the control plane), with its
  request/result shapes `AttemptLiteLlmKeyRequest` and `AttemptLiteLlmKey`.

## Boundary

The application layer mounts the routers and supplies a `PrismaClient`; the provider gateway imports
the provisioning helpers. This package sets and resolves routing policy — it does not itself execute
model calls or hold provider secrets (LiteLLM and the provider gateway do).

## Dependency direction

Tagged `scope:model-routing`: it may depend only on `scope:auth`, `scope:cluster-tenants`,
`scope:model-routing`, and `scope:shared` — never on apps or other server domains.

## Data & persistence

Owns `ModelRoutingDefault` in `apps/opencrane/prisma/schema/model-routing.prisma`. Per-tenant model
rows and provider credentials are owned by the [providers](../../providers/main/README.md) domain.
An `AgentRevision` stores the provider domain's stable `ModelDefinition` identifier, rather than an
unverified alias; this package's catalogue is therefore the allowlist source for executable models.

## See also

- Parent index: [gateways](../../README.md)
- Siblings: [providers](../../providers/main/README.md) · [mcp](../../mcp/main/README.md) · [integrations](../../integrations/main/README.md)
