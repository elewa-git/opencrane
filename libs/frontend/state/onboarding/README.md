# @opencrane/state/onboarding — server-backed persona journey orchestration

> [frontend](../../README.md) › [state](../README.md) › onboarding

## What it owns

This package owns the transport-neutral persona gateway port, validated owner projection, and
component-scoped browser store while keeping every durable fact on the server. After each explicit
command it adopts or reloads the complete owner snapshot so the feature advances only from confirmed
state.

```
 features/onboarding
       │ start · answer · resolve · approve
       ▼
 ┌───────────────────────────────┐
 │ state/onboarding  ◄── HERE    │  port · model · validate · orchestrate
 └───────────────────────────────┘
       │ PersonaGateway
       ▼
 persona/adapter ............... typed control-plane API
```

**In this flow:** [features/onboarding](../../features/onboarding/README.md) ·
[persona/adapter](../persona/adapter/README.md)

The orchestrator creates a draft only after the completed snapshot proves no tie remains. An
explicit prepare-draft command resumes an interrupted durable review transition. A failed mutation
returns no optimistic state, so the current durable screen stays retryable.

The model-adjacent runtime validator strips unknown response extensions and rejects invalid lifecycle,
question, score, revision, or tie evidence before feature state can consume it.

## Public surface

- `PersonaOnboardingService` — read, start, answer, complete, resolve, `ensureDraft`, approve, and restart
  application commands over the narrow persona gateway.
- `PersonaOnboardingStore` — read resource, single-flight command admission, bounded errors, and
  authoritative projection adoption for one mounted onboarding shell.
- `PERSONA_GATEWAY` and `PersonaGateway` — transport-neutral dependency-injection port.
- `_ParsePersonaOnboardingSnapshot` plus persona lifecycle models — bounded response validation and
  the feature-facing projection.

## Boundary

Consumed by the onboarding feature and implemented by the persona adapter. It holds no browser-storage
completion flag, owns no HTTP transport or score calculation, and cannot assert that an answer,
draft, or approval succeeded.

## Dependency direction

Tagged `scope:persona-onboarding`, `type:lib`, `layer:frontend`, and `frontend-role:state`. Its role
constraint permits only frontend core and lower dependency-neutral model, contract, or utility
layers. The persona adapter depends inward on this port and model; state cannot import the adapter,
a feature, an app, or backend source.

## See also

- Parent index: [state](../README.md)
- Adapter: [persona/adapter](../persona/adapter/README.md)
- Feature: [features/onboarding](../../features/onboarding/README.md)
