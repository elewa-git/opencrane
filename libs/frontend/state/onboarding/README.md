# @opencrane/state/onboarding — server-backed onboarding orchestration

> [frontend](../../README.md) › [state](../README.md) › onboarding

## What it owns

This package owns the transport-neutral persona gateway port, validated owner projection, and
component-scoped browser store, plus the first-chat gateway port, validated projection, and thin
generated-client adapter. Every durable fact remains on the server. Persona commands adopt the
complete owner snapshot; first-chat commands consume the complete projection returned by the same
server authority.

```
 features/onboarding
       │ survey choices · approval · first-chat answers
       ▼
 ┌───────────────────────────────┐
 │ state/onboarding  ◄── HERE    │  ports · models · validate · orchestrate
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

The model-adjacent runtime validators strip unknown response extensions and reject invalid lifecycle,
question, score, revision, transcript, source, or completion evidence before feature state can
consume it.

## Public surface

- `PersonaOnboardingService` — read, start, answer, complete, resolve, `ensureDraft`, approve, and restart
  application commands over the narrow persona gateway.
- `PersonaOnboardingStore` — read resources, single-flight command and ready-route admission,
  bounded errors, and authoritative projection adoption for one mounted onboarding shell.
- `PERSONA_GATEWAY` and `PersonaGateway` — transport-neutral dependency-injection port.
- `_ParsePersonaOnboardingSnapshot` plus persona lifecycle models — bounded response validation and
  the feature-facing projection.
- `PersonaFirstChatService` and `PERSONA_FIRST_CHAT_GATEWAY` — read and explicit start, answer, and
  guarded-conclusion operations over a package-internal narrow port.
- `PersonaFirstChatStore` — component-scoped read resource, typed command phases and admission,
  retry coordinates, conflict adoption, controlled draft, and authoritative projection state.
- `OpenCranePersonaFirstChatGateway` — thin generated-client adapter for the signed-in owner's
  onboarding and first-chat endpoints.
- Package-internal adapter validators fail closed on routing, provenance, transcript order, and
  completion eligibility; only the feature-consumed route, snapshot, transcript, and current-question
  projections plus finite lifecycle enums are exported.

## Boundary

Consumed by the onboarding feature; the persona port is implemented by the persona adapter, while
the bounded first-chat adapter stays beside its model and validator in this cohesive state package.
It holds no browser-storage completion flag or durable transcript, performs no score calculation or
model execution, and cannot assert that an answer, draft, approval, or conclusion succeeded.

## Dependency direction

Tagged `scope:persona-onboarding`, `type:lib`, `layer:frontend`, and `frontend-role:state`. Its role
constraint permits only frontend core and lower dependency-neutral model, contract, or utility
layers. The persona adapter depends inward on this port and model; state cannot import a feature, an
app, or backend source. Its first-chat HTTP adapter depends only on the generated client in core and
the model-adjacent validators in this package.

## See also

- Parent index: [state](../README.md)
- Adapter: [persona/adapter](../persona/adapter/README.md)
- Feature: [features/onboarding](../../features/onboarding/README.md)
