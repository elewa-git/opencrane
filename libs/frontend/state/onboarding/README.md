# @opencrane/state/onboarding — server-backed onboarding orchestration

> [frontend](../../README.md) › [state](../README.md) › onboarding

## What it owns

This package owns the transport-neutral persona and first-chat gateway ports, component-scoped
browser stores, command orchestration, route-only validation, and the thin generated-client adapter.
Every durable fact remains on the server. First-chat commands consume the shared validated
projection from [`models/user-onboarding`](../../../models/user-onboarding/main/README.md).

```
 features/onboarding
       │ survey choices · approval · first-chat answers
       ▼
 ┌───────────────────────────────┐
 │ state/onboarding  ◄── HERE    │  ports · commands · orchestrate
 └───────────────────────────────┘
       │ PersonaGateway
       ▼
 persona/adapter ............... typed control-plane API
```

**In this flow:** [features/onboarding](../../features/onboarding/README.md) ·
[persona/adapter](../persona/adapter/README.md)

The orchestrator creates a draft only after the completed snapshot proves no tie remains. An
explicit prepare-draft command resumes an interrupted durable review transition. A failed mutation
returns no optimistic state, so the current durable screen stays retryable. The first-chat
store is component-scoped: its resource performs only the authoritative read, while explicit
single-flight entry, answer, conclusion, and retry commands adopt complete server projections. It
keeps retry identity outside durable browser storage, resets controlled input when the authoritative
question changes, and asks the server to conclude only when its latest projection says all three
answers are present.

The shared model validators strip unknown persona and first-chat response extensions and reject
invalid lifecycle, scoring, transcript, source, or completion evidence before this state can consume
it. This package separately validates the route-only response and documented conflict envelope.

## Public surface

- `PersonaOnboardingService` — read, start, answer, complete, resolve, `ensureDraft`, approve, and restart
  application commands over the narrow persona gateway.
- `PersonaOnboardingStore` — read resources, single-flight command and ready-route admission,
  bounded errors, and authoritative projection adoption for one mounted onboarding shell.
- `PERSONA_GATEWAY` and `PersonaGateway` — transport-neutral dependency-injection port.
- `PersonaFirstChatService` and `PERSONA_FIRST_CHAT_GATEWAY` — read and explicit start, answer, and
  guarded-conclusion operations over a package-internal narrow port.
- `PersonaFirstChatStore` — component-scoped read resource, typed command phases and admission,
  retry coordinates, conflict adoption, controlled draft, and authoritative projection state.
- `OpenCranePersonaFirstChatGateway` — thin generated-client adapter for the signed-in owner's
  onboarding and first-chat endpoints.
- [`projection`](./projection/README.md) — the narrow frontend-facing onboarding vocabulary consumed
  by the onboarding feature without exposing stores, gateways, or commands.
- Route and conflict-envelope validators fail closed before handing first-chat evidence to the
  shared model validator.

## Boundary

Consumed by the onboarding feature; the persona port is implemented by the persona adapter, while
the bounded first-chat adapter stays beside its route and conflict validators in this cohesive state package.
It holds no browser-storage completion flag or durable transcript, performs no score calculation or
model execution, and cannot assert that an answer, draft, approval, or conclusion succeeded.

## Dependency direction

Tagged `scope:persona-onboarding`, `type:lib`, `layer:frontend`, and `frontend-role:state`. It depends
on frontend core and the dependency-bottom `scope:user-onboarding` projection model. It cannot import
a feature, app, backend source, or conversation workspace. Its first-chat HTTP adapter validates
persona and first-chat responses through the model package before adopting them.

## See also

- Parent index: [state](../README.md)
- Projection facade: [onboarding/projection](./projection/README.md)
- Adapter: [persona/adapter](../persona/adapter/README.md)
- Feature: [features/onboarding](../../features/onboarding/README.md)
