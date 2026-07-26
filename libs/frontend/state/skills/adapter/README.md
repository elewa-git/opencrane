# @opencrane/state/skills/adapter — governed skill catalogue gateway

> [frontend](../../../README.md) › [state](../../README.md) › [skills](../README.md) › adapter

## What it owns

This package is part of the frontend state layer: the small layer between an Angular screen and the Control Plane HTTP API. It exposes the host-silo's **governed skill catalogue** as a narrow, read-only gateway. A governed skill is a reusable automation instruction that has a server-owned lifecycle and revision history.

A feature injects `SKILL_CATALOGUE_GATEWAY`, requests the safe summaries it needs, and renders them. Before this adapter runs, Angular has already established the browser's cookie session. After it runs, a feature receives only catalogue metadata; server authorities keep source, review evidence, worker details, and all mutations private.

```
 signed-in browser session
          │ feature asks for catalogue entries
          ▼
 ┌─────────────────────────────────────┐
 │ skills/adapter  ◄── HERE              │
 │ port token + live HTTP implementation │
 └─────────────────────────────────────┘
          │ GET /skills (no silo or owner supplied)
          ▼
 Control Plane API → governed skill authority
```

**In this flow:** [gateways](../../gateways/README.md) binds the live implementation; the server-side governed-skill authority decides the caller's host silo and permitted projection.

Invariant: this package can only list browser-safe summaries. It must never add a client-controlled silo coordinate or become a route to skill source, evidence, execution, or mutation.

## Public surface

- `GovernedSkill` — browser-safe catalogue metadata for one governed skill.
- `SkillCatalogueGateway` — the read-only port a feature depends on.
- `SKILL_CATALOGUE_GATEWAY` — Angular injection token for that port.
- `OpenCraneSkillCatalogueGateway` — live cookie-session implementation using the Control Plane API.

## Boundary

Consumed by frontend features through the injection token and composed by [state/gateways](../../gateways/README.md). On an API error it fails closed by rejecting the request; it does not invent a cache, retry policy, or fallback data. It owns no UI, server-side authorization, or skill lifecycle transition.

## Dependency direction

Tagged `scope:web` and `type:state`: it may import frontend core and browser-safe shared contracts, but never an application, UI feature, backend domain, or deployment package. The adapter depends downward on the public API; features depend upward on this port.

## See also

- Parent index: [skills](../README.md)
- Composition root: [gateways](../../gateways/README.md)
- Sibling adapter: [assets/adapter](../../assets/adapter/README.md)
