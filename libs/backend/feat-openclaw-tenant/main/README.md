# @opencrane/backend/feat-openclaw-tenant — legacy OpenClaw tenant reconciler

> [backend](../../README.md) › feat-openclaw-tenant › main

## Status

**Frozen blue platform — a deletion boundary.** This package is the "blue" (legacy) OpenClaw tenant
runtime. It is maintained only for bug-fixes and live-cluster upkeep until the "green" personal-agent
product replaces it, at which point this whole package is deleted — there is no long-term contract
here and no new features should be added. If you are building new capability, build it in the
personal-agent domains under [`agents/personal`](../../agents/personal), not here.

## What it owns

A **reconciler** is a control loop: it watches Kubernetes custom resources and continuously makes the
real cluster match the desired spec. This package owns the reconciler for the legacy OpenClaw agent
gateway. Each `Tenant` custom resource is a **UserTenant** — one per-user OpenClaw gateway — and its
workloads run inside the namespace of the owning **ClusterTenant** (the customer / isolation unit),
fenced by that ClusterTenant's quota and isolation tier.

```
 Tenant (UserTenant) custom resource changes in a watched namespace
          │
          ▼
 ┌────────────────────────────────────────────┐
 │   feat-openclaw-tenant  ◄── HERE              │
 │   TenantOperator reconcile loop               │
 │   → ServiceAccount · ConfigMap · Deployment   │
 │     · Service · Ingress · quota               │
 │   IdleChecker suspends idle tenants           │
 │   Cognee identity + LiteLLM key heal loops    │
 └────────────────────────────────────────────┘
          │  Kubernetes objects in the ClusterTenant namespace
          ▼
 running OpenClaw gateway  at  <name>.<ingress.domain>
```

**In this flow:** `apps/opencrane` *(composition root that constructs `OpenClawTenantLifecycle`)* ·
the deep sub-doc [`reconcilers/tenants/README.md`](./src/reconcilers/tenants/README.md) *(per-resource builder detail)*

`OpenClawTenantLifecycle` is the entry the app root starts: it loads config, provisions an optional
bootstrap provider key, seeds standalone ClusterTenant / default-workspace resources, ensures the
singleton Cognee (the memory service) identity and its LiteLLM (the model-router) key, starts the idle-suspension and policy loops, optionally
starts an in-process channel proxy, and then runs the tenant watch loop. Boot is deliberately
fail-soft: if bootstrap throws, the silo API stays up but logs that the tenant runtime is not
reconciling.

Invariant while it lives: one UserTenant reconciles to one consistent set of namespaced workloads
under its ClusterTenant, and idle tenants are auto-suspended. The richer per-resource contract stays
in the sub-doc at `src/reconcilers/tenants/README.md`; this file is the package-root front door.

## Public surface

- `OpenClawTenantLifecycle` — the runtime lifecycle the app root starts and stops.
- `TenantOperator` / `_CreateTenantOperator` — the reconcile loop and its wiring factory.
- `IdleChecker` — periodic auto-suspension of tenants idle past the timeout.
- `CogneeLiteLlmKey` / `CogneeSiloTenant` — the singleton Cognee identity and credential heal helpers.
- `_OperatorConfigChecksum` and the `operator-config` / `runtime-lifecycle` config types.

## Boundary

Consumed only by the `apps/opencrane` silo composition root. It reconciles Kubernetes objects and
provisions Cognee/LiteLLM identities; it is not the product API and gains no new surface. As blue
maintenance code it must not be extended — changes should be limited to keeping existing clusters
alive.

## Dependency direction

Tagged `scope:feat-openclaw-tenant` (`layer:backend`): it may not depend on frontend or entrypoint
layers. In practice it wires several server domains (cluster-tenants, model-routing, IAM policies) and
the channel-proxy infra lib through the app root.

## Runtime & config

Driven by the app-owned operator environment (`OpenClawTenantOperatorConfig`): watch namespace,
deployment mode (standalone vs fleet-managed), standalone seed identity, Cognee endpoint, and the
optional in-process gateway proxy (`GATEWAY_PROXY_ENABLED`). It never accepts or provisions an
upstream provider key at boot.

## See also

- Parent index: [backend](../../README.md)
- Sub-doc: [reconcilers/tenants](./src/reconcilers/tenants/README.md)
- Replacement: [agents/personal](../../agents/personal)
